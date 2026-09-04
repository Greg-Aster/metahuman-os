/**
 * Text-to-Speech (TTS) Composable
 * Handles all TTS functionality including voice synthesis, audio playback, and voice model management
 * Supports both batch (full text) and streaming (sentence-by-sentence) modes
 */

import { writable, get } from 'svelte/store';
import { apiFetch } from '../api-config';

// Types
interface VoiceModelsCache {
  multiVoice: boolean;
  models?: string[];
}

interface VoiceProviderCache {
  provider?: string;
}

interface AudioChunk {
  index: number;
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  scheduled: boolean;
  played: boolean;
}

export type TTSPlaybackOutcome = 'completed' | 'interrupted' | 'suppressed' | 'failed';
export type TTSStopReason = 'interrupted' | 'disabled' | 'superseded' | 'cleanup';

export interface TTSPlaybackRequestHandle {
  readonly requestId?: string;
}

export function createTTSPlaybackRequestTracker() {
  let activeRequest: TTSPlaybackRequestHandle | null = null;

  return {
    begin(requestId?: string): TTSPlaybackRequestHandle {
      const request = { requestId };
      activeRequest = request;
      return request;
    },
    owns(requestId: string): boolean {
      return Boolean(requestId) && activeRequest?.requestId === requestId;
    },
    isActive(request: TTSPlaybackRequestHandle): boolean {
      return activeRequest === request;
    },
    interrupt(requestId: string): boolean {
      if (!requestId || activeRequest?.requestId !== requestId) return false;
      activeRequest = null;
      return true;
    },
    interruptActive(): void {
      activeRequest = null;
    },
    finish(request: TTSPlaybackRequestHandle): void {
      if (activeRequest === request) activeRequest = null;
    },
  };
}

// Constants
const VOICE_MODELS_CACHE_TTL = 60_000; // 1 minute
const VOICE_PROVIDER_CACHE_TTL = 30_000; // 30 seconds

/**
 * Report TTS speaking state to the server (for Active Operator pause management)
 * This is fire-and-forget - errors are logged but don't affect TTS playback
 */
async function reportTTSState(speaking: boolean): Promise<void> {
  try {
    await apiFetch('/api/pause-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'setTTS', speaking }),
    });
    console.log(`[useTTS] Reported TTS state to server: speaking=${speaking}`);
  } catch (e) {
    // Non-critical - just log it
    console.warn('[useTTS] Failed to report TTS state:', e);
  }
}

/**
 * Check if native voice mode is enabled via localStorage
 */
function isNativeVoiceModeEnabled(): boolean {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return false;
  return localStorage.getItem('mh-native-voice-mode') === 'true';
}

/**
 * Check if native TTS (SpeechSynthesis) is available
 */
function isNativeTTSAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

/**
 * Normalize text for speech synthesis
 * Removes markdown formatting, code blocks, thinking blocks, and other non-speakable content
 */
export function normalizeTextForSpeech(text: string): string {
  if (!text) return '';
  let output = text;

  // Remove <think>...</think> blocks (model reasoning - should not be spoken)
  output = output.replace(/<think>[\s\S]*?<\/think>/gi, ' ');

  // Remove code blocks entirely
  output = output.replace(/```[\s\S]*?```/g, ' ');
  // Inline code: keep content
  output = output.replace(/`([^`]+)`/g, '$1');
  // Image markdown
  output = output.replace(/!\[[^\]]*\]\([^)]+\)/g, ' ');
  // Links: keep the readable label
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  // Remove emphasis markers like **bold**, _italic_
  output = output.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1');
  // Strip remaining markdown bullets and headings
  output = output.replace(/^#{1,6}\s*/gm, '');
  output = output.replace(/^\s*[-+*]\s+/gm, '');
  // Remove HTML tags
  output = output.replace(/<\/?[^>]+>/g, ' ');
  // Replace multiple punctuation markers such as asterisks or slashes used decoratively
  output = output.replace(/[*/]{2,}/g, ' ');
  // Preserve paragraph boundaries for low-latency phrase synthesis.
  output = output
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return output;
}

/**
 * TTS Composable
 * Provides reactive state and methods for text-to-speech functionality
 */
function createTTS() {
  // State
  const playbackRequests = createTTSPlaybackRequestTracker();
  let audioCtx: AudioContext | null = null;
  let currentTtsAbort: AbortController | null = null;
  let ttsPlaybackToken = 0;
  const livePlaybackTokens = new Set<number>();
  const playbackStopReasons = new Map<number, TTSStopReason>();
  let audioUnlocked = false;
  let webAudioSource: AudioBufferSourceNode | null = null; // Web Audio API (doesn't steal media session)

  // Cache
  let voiceModelsCache: VoiceModelsCache | null = null;
  let voiceModelsCacheTime = 0;
  let voiceProviderCache: VoiceProviderCache | null = null;
  let voiceProviderCacheTime = 0;

  // Svelte stores for reactive state
  const isPlaying = writable(false);
  const isLoading = writable(false);
  const isStreaming = writable(false);
  const streamProgress = writable({ current: 0, total: 0 });

  // Streaming state
  let audioQueue: AudioChunk[] = [];
  let currentChunkIndex = 0;
  let streamAbortController: AbortController | null = null;
  const streamSources = new Set<AudioBufferSourceNode>();
  let streamNextStartTime = 0;
  let streamStartedAt = 0;
  let streamReportedSpeaking = false;
  let streamComplete = false; // Track if all chunks have been received
  let streamPlaybackFailed = false;

  function markPlaybackStopped(reason: TTSStopReason): void {
    if (livePlaybackTokens.has(ttsPlaybackToken) && !playbackStopReasons.has(ttsPlaybackToken)) {
      playbackStopReasons.set(ttsPlaybackToken, reason);
    }
  }

  function finishPlayback(token: number, completed: boolean): TTSPlaybackOutcome {
    const reason = playbackStopReasons.get(token);
    playbackStopReasons.delete(token);
    livePlaybackTokens.delete(token);
    if (reason === 'disabled') return 'suppressed';
    if (reason === 'interrupted' || reason === 'superseded') return 'interrupted';
    return completed ? 'completed' : 'failed';
  }

  function playbackWasStopped(token: number): boolean {
    return token !== ttsPlaybackToken || playbackStopReasons.has(token);
  }

  /**
   * Stop active audio playback
   */
  function stopActiveAudio(reason: TTSStopReason = 'interrupted') {
    markPlaybackStopped(reason);
    // Check if we were playing before stopping
    const wasPlaying = get(isPlaying);

    // Stop batch Web Audio API source.
    if (webAudioSource) {
      try {
        webAudioSource.stop();
      } catch {}
      webAudioSource = null;
    }

    isPlaying.set(false);

    // Report to server if we were playing
    if (wasPlaying) {
      reportTTSState(false);
    }

    // Also stop streaming if active
    stopStreaming();
    stopNativeTTS(reason);
  }

  /**
   * Stop streaming TTS playback
   */
  function stopStreaming() {
    // Abort the SSE connection
    if (streamAbortController) {
      streamAbortController.abort();
      streamAbortController = null;
    }

    // Stop every scheduled Web Audio source.
    for (const source of streamSources) {
      try {
        source.stop();
      } catch {}
    }
    streamSources.clear();

    if (streamReportedSpeaking && get(isPlaying)) {
      reportTTSState(false);
    }
    streamReportedSpeaking = false;
    isPlaying.set(false);

    // Reset streaming state
    audioQueue = [];
    currentChunkIndex = 0;
    streamNextStartTime = 0;
    streamStartedAt = 0;
    streamComplete = false;
    streamPlaybackFailed = false;
    isStreaming.set(false);
    streamProgress.set({ current: 0, total: 0 });
  }

  /**
   * Cancel in-flight TTS request
   */
  function cancelInFlightTts(reason: TTSStopReason = 'interrupted') {
    markPlaybackStopped(reason);
    if (currentTtsAbort) {
      currentTtsAbort.abort();
      currentTtsAbort = null;
    }
    isLoading.set(false);
  }

  function interruptPlayback(reason: TTSStopReason = 'interrupted'): void {
    playbackRequests.interruptActive();
    stopActiveAudio(reason);
    cancelInFlightTts(reason);
  }

  function interruptPlaybackRequest(
    requestId: string,
    reason: TTSStopReason = 'interrupted',
  ): boolean {
    if (!playbackRequests.interrupt(requestId)) return false;
    stopActiveAudio(reason);
    cancelInFlightTts(reason);
    return true;
  }

  /**
   * Ensure audio is unlocked (required by browser autoplay policies)
   */
  async function ensureAudioUnlocked(): Promise<void> {
    if (audioUnlocked) return;
    try {
      // Create a short silent buffer to satisfy autoplay policies
      audioCtx = audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
      const buffer = audioCtx.createBuffer(1, 1, 22050);
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      source.start(0);
      await audioCtx.resume();
      audioUnlocked = true;
    } catch (e) {
      console.warn('[useTTS] Failed to unlock audio:', e);
    }
  }

  /**
   * Fetch voice models from API (with caching)
   */
  async function fetchVoiceModels(): Promise<VoiceModelsCache> {
    const now = Date.now();
    if (voiceModelsCache && now - voiceModelsCacheTime < VOICE_MODELS_CACHE_TTL) {
      return voiceModelsCache;
    }

    try {
      const voiceModelsRes = await apiFetch('/api/voice-models');
      if (voiceModelsRes.ok) {
        const voiceData = await voiceModelsRes.json();
        const result: VoiceModelsCache = {
          multiVoice: !!voiceData.multiVoice && Array.isArray(voiceData.models) && voiceData.models.length > 1,
          models: Array.isArray(voiceData.models) ? voiceData.models : undefined,
        };
        voiceModelsCache = result;
        voiceModelsCacheTime = now;
        return result;
      }
    } catch (error) {
      console.warn('[useTTS] Failed to fetch voice models:', error);
    }

    return { multiVoice: false };
  }

  /**
   * Fetch voice provider from API (with caching)
   */
  async function fetchVoiceProvider(): Promise<string | undefined> {
    const now = Date.now();
    if (voiceProviderCache && now - voiceProviderCacheTime < VOICE_PROVIDER_CACHE_TTL) {
      return voiceProviderCache.provider;
    }

    try {
      const settingsRes = await apiFetch('/api/voice-settings');
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        voiceProviderCache = {
          provider: settings.provider,
        };
        voiceProviderCacheTime = now;
        return settings.provider;
      }
    } catch (error) {
      console.warn('[useTTS] Failed to fetch voice provider:', error);
    }

    return undefined;
  }

  function refreshVoiceSettings(): void {
    voiceProviderCache = null;
    voiceProviderCacheTime = 0;
    void fetchVoiceProvider();
  }

  /**
   * Prefetch voice resources (models and provider) for faster TTS
   */
  function prefetchVoiceResources(): void {
    Promise.all([fetchVoiceModels(), fetchVoiceProvider()]).catch(err => {
      console.warn('[useTTS] Voice prefetch failed:', err);
    });
  }

  /**
   * Speak text using server-side TTS (Piper)
   * Uses Web Audio API instead of Audio elements to avoid stealing media session
   * Automatically routes to native TTS if native voice mode is enabled
   */
  async function speakText(text: string): Promise<TTSPlaybackOutcome> {
    // Check if native voice mode is enabled - route to native TTS
    if (isNativeVoiceModeEnabled() && isNativeTTSAvailable()) {
      console.log('[useTTS] Native voice mode enabled - routing to native TTS');
      return speakTextNative(text);
    }

    console.log('[useTTS] 🔊 speakText called (WEB AUDIO API VERSION - no session steal)');
    console.log('[useTTS] speakText called with text length:', text.length);
    const speechText = normalizeTextForSpeech(text);
    console.log('[useTTS] normalized text length:', speechText?.length || 0);
    if (!speechText) {
      console.log('[useTTS] No speech text after normalization, aborting');
      return 'failed';
    }

    stopActiveAudio('superseded');
    cancelInFlightTts('superseded');
    const token = ++ttsPlaybackToken;
    livePlaybackTokens.add(token);

    const controller = new AbortController();
    currentTtsAbort = controller;
    isLoading.set(true);

    try {
      // Fetch voice metadata for current session/profile
      console.log('[useTTS] Fetching voice metadata...');
      const [{ multiVoice, models: voiceModels }, provider] = await Promise.all([
        fetchVoiceModels(),
        fetchVoiceProvider(),
      ]);
      if (multiVoice && voiceModels) {
        console.log(`[useTTS] Multi-voice mode active with ${voiceModels.length} voices`);
      }

      console.log('[useTTS] Fetching TTS from /api/tts...');

      const ttsBody: any = { text: speechText };

      // Include provider if available
      if (provider) {
        ttsBody.provider = provider;
      }

      // If multi-voice, use models array; otherwise use default single voice
      if (multiVoice && voiceModels) {
        ttsBody.models = voiceModels;
      }

      const ttsRes = await apiFetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ttsBody),
        signal: controller.signal
      });

      if (playbackWasStopped(token)) return finishPlayback(token, false);
      currentTtsAbort = null;
      isLoading.set(false);

      if (!ttsRes.ok) {
        console.warn('[useTTS] TTS request failed:', ttsRes.status);
        return finishPlayback(token, false);
      }

      // Use Web Audio API instead of Audio element
      // This plays audio WITHOUT claiming the media session!
      const arrayBuffer = await ttsRes.arrayBuffer();
      if (playbackWasStopped(token)) return finishPlayback(token, false);

      // Create/resume AudioContext
      audioCtx = audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      // Decode the audio
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      if (playbackWasStopped(token)) return finishPlayback(token, false);

      // Create source node and play
      const source = audioCtx.createBufferSource();
      webAudioSource = source;
      source.buffer = audioBuffer;
      source.connect(audioCtx.destination);

      isPlaying.set(true);
      reportTTSState(true); // Tell server we're speaking
      console.log('[useTTS] Playing via Web Audio API (no media session steal)');

      await new Promise<void>((resolve) => {
        source.onended = () => {
          if (!playbackWasStopped(token)) {
            console.log('[useTTS] Web Audio playback ended');
            isPlaying.set(false);
            reportTTSState(false); // Tell server we're done speaking
          }
          if (webAudioSource === source) webAudioSource = null;
          resolve();
        };
        source.start(0);
      });
      return finishPlayback(token, true);

    } catch (e) {
      if (controller.signal.aborted) {
        return finishPlayback(token, false);
      }
      console.warn('[useTTS] speakText failed:', e);
      isPlaying.set(false);
      return finishPlayback(token, false);
    } finally {
      if (currentTtsAbort === controller) {
        currentTtsAbort = null;
      }
      isLoading.set(false);
    }
  }

  /**
   * Speak text using streaming TTS (paragraph-level)
   * Each paragraph is synthesized as one continuous audio chunk
   * Pauses occur ONLY at real paragraph boundaries (double newlines)
   *
   * @param text - Text to speak
   * @param options - Optional parameters for voice control
   */
  async function speakTextStreaming(text: string, options?: {
    pitchShift?: number;  // RVC pitch shift (-12 to +12)
    speed?: number;       // Speaking rate (0.5-2.0)
    source?: string;
    requestId?: string;
  }): Promise<TTSPlaybackOutcome> {
    console.log('[useTTS] speakTextStreaming called with text length:', text.length);
    const speechText = normalizeTextForSpeech(text);
    console.log('[useTTS] normalized text length:', speechText?.length || 0);
    if (!speechText) {
      console.log('[useTTS] No speech text after normalization, aborting');
      return 'failed';
    }

    // Stop any existing playback
    stopActiveAudio('superseded');
    cancelInFlightTts('superseded');
    const token = ++ttsPlaybackToken;
    livePlaybackTokens.add(token);

    // Initialize streaming state
    audioQueue = [];
    currentChunkIndex = 0;
    streamSources.clear();
    streamNextStartTime = 0;
    streamStartedAt = performance.now();
    streamReportedSpeaking = false;
    streamComplete = false;
    streamPlaybackFailed = false;
    const controller = new AbortController();
    streamAbortController = controller;

    isStreaming.set(true);
    isLoading.set(true);

    try {
      // Fetch voice provider to determine streaming endpoint
      const provider = await fetchVoiceProvider();
      console.log('[useTTS] Streaming with provider:', provider);

      // Build request body with provider-specific parameters
      const requestBody: Record<string, unknown> = {
        text: speechText,
        provider: provider,
        source: options?.source,
        requestId: options?.requestId,
      };

      // Add optional parameters
      if (options?.pitchShift !== undefined) {
        requestBody.pitchShift = options.pitchShift;
      }
      if (options?.speed !== undefined) {
        requestBody.speed = options.speed;
      }

      // Start SSE connection to streaming endpoint
      const response = await apiFetch('/api/tts-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Streaming TTS request failed: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body for streaming');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      console.log('[useTTS] SSE stream started');

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log('[useTTS] SSE stream ended');
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events
        const events = buffer.split('\n\n');
        buffer = events.pop() || ''; // Keep incomplete event in buffer

        for (const event of events) {
          if (!event.startsWith('data: ')) continue;

          let data: Record<string, any>;
          try {
            data = JSON.parse(event.slice(6));
          } catch (parseError) {
            console.warn('[useTTS] Failed to parse SSE event:', parseError);
            streamPlaybackFailed = true;
            throw new Error('TTS stream returned an invalid event');
          }

          if (data.event === 'complete') {
            console.log('[useTTS] Stream complete:', data.total_chunks, 'chunks');
            streamComplete = true;
            isLoading.set(false);
            finishStreamingPlaybackIfComplete(token);
            continue;
          }

          if (data.event === 'error') {
            streamPlaybackFailed = true;
            streamComplete = true;
            throw new Error(String(data.error || 'TTS stream failed'));
          }

          if (typeof data.audio_base64 === 'string') {
            const chunkIndex = Number(data.chunk_index);
            const totalChunks = Number(data.total_sentences);
            if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || !Number.isInteger(totalChunks)) {
              throw new Error('TTS stream returned invalid chunk metadata');
            }
            console.log(`[useTTS] Received chunk ${chunkIndex + 1}/${totalChunks}`);
            streamProgress.set({ current: chunkIndex + 1, total: totalChunks });

            const binaryString = atob(data.audio_base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }

            audioCtx = audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
            if (audioCtx.state === 'suspended') await audioCtx.resume();
            const decoded = await audioCtx.decodeAudioData(bytes.buffer);
            if (playbackWasStopped(token)) return finishPlayback(token, false);

            if (audioQueue.length === 0) {
              console.log(
                `[useTTS] First audio received after ${Math.round(performance.now() - streamStartedAt)}ms`,
              );
            }
            audioQueue.push({
              index: chunkIndex,
              buffer: decoded,
              source: null,
              scheduled: false,
              played: false,
            });
            scheduleStreamingChunks(token);
          }
        }
      }

      if (!streamComplete) {
        console.warn('[useTTS] TTS stream ended before its completion event');
        streamPlaybackFailed = true;
        streamComplete = true;
        finishStreamingPlaybackIfComplete(token);
      }

      // Wait for all chunks to finish playing
      await waitForPlaybackComplete(token);
      return finishPlayback(token, !streamPlaybackFailed);

    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        console.log('[useTTS] Streaming aborted');
        return finishPlayback(token, false);
      }
      console.warn('[useTTS] Streaming failed:', e);
      streamPlaybackFailed = true;
      stopStreaming();
      return finishPlayback(token, false);
    } finally {
      if (streamAbortController === controller) streamAbortController = null;
      isLoading.set(false);
      isStreaming.set(false);
    }
  }

  function finishStreamingPlaybackIfComplete(token: number): void {
    const allPlayed = audioQueue.length === 0 || audioQueue.every(chunk => chunk.played);
    if (!streamComplete || !allPlayed || streamSources.size > 0) return;
    if (!playbackWasStopped(token)) {
      isPlaying.set(false);
      if (streamReportedSpeaking) reportTTSState(false);
    }
    streamReportedSpeaking = false;
  }

  /**
   * Decode and schedule each ordered phrase as soon as it arrives. Web Audio's
   * clock keeps already-buffered phrases contiguous without delaying the first.
   */
  function scheduleStreamingChunks(token: number): void {
    if (!audioCtx || playbackWasStopped(token)) return;

    while (true) {
      const chunk = audioQueue.find(candidate => (
        candidate.index === currentChunkIndex && !candidate.scheduled
      ));
      if (!chunk) break;

      const source = audioCtx.createBufferSource();
      source.buffer = chunk.buffer;
      source.connect(audioCtx.destination);
      chunk.source = source;
      chunk.scheduled = true;
      currentChunkIndex += 1;

      const startAt = Math.max(audioCtx.currentTime + 0.02, streamNextStartTime);
      streamNextStartTime = startAt + chunk.buffer.duration;
      streamSources.add(source);
      source.onended = () => {
        chunk.played = true;
        streamSources.delete(source);
        console.log(`[useTTS] Chunk ${chunk.index} finished`);
        finishStreamingPlaybackIfComplete(token);
      };
      source.start(startAt);

      if (!streamReportedSpeaking) {
        streamReportedSpeaking = true;
        isLoading.set(false);
        isPlaying.set(true);
        reportTTSState(true);
        console.log(
          `[useTTS] First playback scheduled after ${Math.round(performance.now() - streamStartedAt)}ms`,
        );
      }
    }
  }

  /**
   * Wait for all audio chunks to finish playing
   */
  function waitForPlaybackComplete(token: number): Promise<void> {
    return new Promise((resolve) => {
      const checkComplete = () => {
        if (playbackWasStopped(token)) {
          resolve();
          return;
        }
        const allPlayed = audioQueue.length === 0 || audioQueue.every(c => c.played);
        if (allPlayed && streamSources.size === 0 && streamComplete) {
          isPlaying.set(false);
          resolve();
        } else {
          setTimeout(checkComplete, 50);
        }
      };
      checkComplete();
    });
  }

  /**
   * Cleanup function to call on component unmount
   */
  function cleanup() {
    cancelInFlightTts('cleanup');
    stopActiveAudio('cleanup');
    stopStreaming();
    stopNativeTTS('cleanup');
    if (audioCtx) {
      try { audioCtx.close(); } catch {}
      audioCtx = null;
    }
  }

  // Native TTS state
  let nativeUtterance: SpeechSynthesisUtterance | null = null;
  let finishNativePlayback: (() => void) | null = null;

  /**
   * Stop native TTS playback
   */
  function stopNativeTTS(reason: TTSStopReason = 'interrupted') {
    markPlaybackStopped(reason);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    finishNativePlayback?.();
    finishNativePlayback = null;
    nativeUtterance = null;
  }

  /**
   * Speak text using native device TTS (Web Speech API)
   */
  async function speakTextNative(text: string): Promise<TTSPlaybackOutcome> {
    const speechText = normalizeTextForSpeech(text);
    if (!speechText) {
      console.log('[useTTS] No speech text after normalization, aborting');
      return 'failed';
    }

    // Stop any existing playback
    stopActiveAudio('superseded');
    const token = ++ttsPlaybackToken;
    livePlaybackTokens.add(token);

    // Use Web Speech API
    console.log('[useTTS] 🔊 Using Web Speech API');
    return new Promise((resolve) => {
      let settled = false;
      const settle = (completed: boolean) => {
        if (settled) return;
        settled = true;
        if (finishNativePlayback === interruptNativePlayback) finishNativePlayback = null;
        resolve(finishPlayback(token, completed));
      };
      const interruptNativePlayback = () => settle(false);
      finishNativePlayback = interruptNativePlayback;
      try {
        nativeUtterance = new SpeechSynthesisUtterance(speechText);

        // Configure voice settings
        nativeUtterance.rate = 1.0;
        nativeUtterance.pitch = 1.0;
        nativeUtterance.volume = 1.0;

        // Try to get a good voice (prefer English voices)
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          const preferredVoice = voices.find(v =>
            v.name.includes('Google') && v.lang.startsWith('en')
          ) || voices.find(v =>
            v.lang.startsWith('en')
          ) || voices[0];

          if (preferredVoice) {
            nativeUtterance.voice = preferredVoice;
            console.log('[useTTS] Using voice:', preferredVoice.name);
          }
        }

        nativeUtterance.onstart = () => {
          console.log('[useTTS] Native TTS started');
          isPlaying.set(true);
          reportTTSState(true); // Tell server we're speaking
        };

        nativeUtterance.onend = () => {
          console.log('[useTTS] Native TTS ended');
          isPlaying.set(false);
          reportTTSState(false); // Tell server we're done speaking
          nativeUtterance = null;
          settle(true);
        };

        nativeUtterance.onerror = (event) => {
          console.warn('[useTTS] Native TTS error:', event.error);
          isPlaying.set(false);
          reportTTSState(false); // Tell server we're done (error case)
          nativeUtterance = null;
          settle(false);
        };

        window.speechSynthesis.speak(nativeUtterance);

      } catch (e) {
        console.error('[useTTS] Native TTS failed:', e);
        isPlaying.set(false);
        settle(false);
      }
    });
  }

  /**
   * Smart speak - uses native TTS if enabled, otherwise server TTS
   * Auto-selects streaming mode for slow providers (RVC) to reduce latency
   */
  async function speak(text: string, options?: {
    streaming?: boolean;
    pitchShift?: number;
    speed?: number;
    source?: string;
    requestId?: string;
  }): Promise<TTSPlaybackOutcome> {
    const playbackRequest = playbackRequests.begin(options?.requestId);
    try {
      // Check if native voice mode is enabled
      if (
        isNativeVoiceModeEnabled()
        && isNativeTTSAvailable()
      ) {
        console.log('[useTTS] Native voice mode enabled - using device TTS');
        return await speakTextNative(text);
      }

      // Use server TTS - auto-select streaming for slow providers
      let useStreaming = options?.streaming;
      // If streaming not explicitly set, auto-detect based on provider
      if (useStreaming === undefined) {
        const provider = await fetchVoiceProvider();
        if (!playbackRequests.isActive(playbackRequest)) return 'interrupted';
        // RVC is slow (especially on CPU) - always use streaming for lower latency
        // Kokoro has native streaming support, also benefits from streaming mode
        useStreaming = provider === 'rvc' || provider === 'kokoro';
        if (useStreaming) {
          console.log(`[useTTS] Auto-selecting streaming mode for ${provider} provider`);
        }
      }

      if (!playbackRequests.isActive(playbackRequest)) return 'interrupted';
      if (useStreaming) {
        return await speakTextStreaming(text, {
          pitchShift: options?.pitchShift,
          speed: options?.speed,
          source: options?.source,
          requestId: options?.requestId,
        });
      }
      return await speakText(text);
    } finally {
      playbackRequests.finish(playbackRequest);
    }
  }

  return {
    // Stores
    isPlaying,
    isLoading,
    isStreaming,
    streamProgress,

    // Methods
    speak,              // Smart speak - auto-selects native vs server
    speakText,          // Force server TTS (batch)
    speakTextStreaming, // Force server TTS (streaming)
    speakTextNative,    // Force native device TTS
    stopActiveAudio,
    stopNativeTTS,
    stopStreaming,
    cancelInFlightTts,
    interruptPlayback,
    interruptPlaybackRequest,
    ensureAudioUnlocked,
    prefetchVoiceResources,
    refreshVoiceSettings,
    cleanup,
  };
}

// Speech is one application-level audio channel. Chat controls and the
// app-level admitted queue consumer must share playback state, AudioContext,
// cancellation, and the browser gesture used to unlock audio.
const sharedTTSApi = createTTS();

export function useTTS() {
  return sharedTTSApi;
}
