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

interface StreamingSpeechOptions {
  provider?: string;
  voice?: string;
  langCode?: string;
  pitchShift?: number;
  speed?: number;
  source?: string;
  requestId?: string;
  prepared?: PreparedSpeech;
}

export interface PreparedSpeech {
  readonly requestId?: string;
  readonly text: string;
  readonly result: Promise<{ native: boolean; streaming: boolean; provider?: string; response?: Response }>;
  readonly finished: Promise<void>;
  readonly signal: AbortSignal;
  cancel(): void;
}

export type TTSPlaybackOutcome = 'completed' | 'interrupted' | 'suppressed' | 'failed';
export type TTSStopReason = 'interrupted' | 'disabled' | 'superseded' | 'cleanup';

export interface TTSPlaybackRequestHandle {
  readonly requestId?: string;
}

const AUDIO_UNLOCK_TIMEOUT_MS = 500;

export async function resumeAudioContextWithTimeout(
  context: Pick<AudioContext, 'state' | 'resume'>,
  timeoutMs = AUDIO_UNLOCK_TIMEOUT_MS,
): Promise<boolean> {
  const isRunning = () => context.state === 'running';
  if (isRunning()) return true;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      context.resume().then(() => 'resumed' as const),
      new Promise<'timed-out'>((resolve) => {
        timeout = setTimeout(() => resolve('timed-out'), timeoutMs);
      }),
    ]);
    return outcome === 'resumed' && isRunning();
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
  let streamPlaybackCompletion: { token: number; resolve: (completed: boolean) => void } | null = null;

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
    streamPlaybackCompletion?.resolve(false);
    streamPlaybackCompletion = null;
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
  async function ensureAudioUnlocked(): Promise<boolean> {
    if (audioUnlocked && audioCtx?.state === 'running') return true;
    try {
      // Create a short silent buffer to satisfy autoplay policies
      audioCtx = audioCtx || new (window.AudioContext || (window as any).webkitAudioContext)();
      const buffer = audioCtx.createBuffer(1, 1, 22050);
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      source.start(0);
      audioUnlocked = await resumeAudioContextWithTimeout(audioCtx);
      if (!audioUnlocked) {
        console.info('[useTTS] Browser audio is waiting for a user gesture');
      }
      return audioUnlocked;
    } catch (e) {
      audioUnlocked = false;
      console.warn('[useTTS] Failed to unlock audio:', e);
      return false;
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

  /** Request batch audio using the current profile's voice configuration. */
  async function requestBatchSpeech(speechText: string, signal: AbortSignal): Promise<Response> {
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

    return apiFetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ttsBody),
      signal,
    });
  }

  async function requestStreamingSpeech(text: string, options: StreamingSpeechOptions, signal: AbortSignal): Promise<Response> {
    const provider = options.provider ?? await fetchVoiceProvider();
    signal.throwIfAborted();
    return apiFetch('/api/tts-stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ text, provider, source: options.source, requestId: options.requestId,
        voice: options.voice, langCode: options.langCode, pitchShift: options.pitchShift, speed: options.speed }),
    });
  }

  // Network preparation is independent of playback. Drain each response while
  // it is produced so its HTTP connection is released before playback ends.
  // Preparation follows admission order; the server still owns playback leases.
  let preparationTail = Promise.resolve();
  function prepareSpeech(text: string, options: StreamingSpeechOptions = {}): PreparedSpeech {
    const controller = new AbortController();
    let resolve!: (value: Awaited<PreparedSpeech['result']>) => void;
    let reject!: (error: unknown) => void;
    const result = new Promise<Awaited<PreparedSpeech['result']>>((yes, no) => { resolve = yes; reject = no; });
    // Preparation can fail before its playback lease arrives. Retain that error
    // for the consumer without producing an unhandled rejection in the meantime.
    void result.catch(() => undefined);
    const finished = preparationTail.then(async () => {
      let sink: ReadableStreamDefaultController<Uint8Array> | undefined;
      let closed = false;
      const abort = () => {
        if (sink && !closed) { closed = true; sink.error(controller.signal.reason); }
      };
      controller.signal.addEventListener('abort', abort, { once: true });
      try {
        controller.signal.throwIfAborted();
        if (!options.provider && isNativeVoiceModeEnabled() && isNativeTTSAvailable()) {
          resolve({ native: true, streaming: false });
          return;
        }
        const provider = options.provider ?? await fetchVoiceProvider();
        controller.signal.throwIfAborted();
        const streaming = provider === 'rvc' || provider === 'kokoro' || provider === 'kitten';
        const speechText = normalizeTextForSpeech(text);
        const response = streaming
          ? await requestStreamingSpeech(speechText, { ...options, provider }, controller.signal)
          : await requestBatchSpeech(speechText, controller.signal);
        controller.signal.throwIfAborted();
        const reader = response.body?.getReader();
        const body = reader ? new ReadableStream<Uint8Array>({
          start(value) { sink = value; },
          cancel() { controller.abort(); },
        }) : null;
        resolve({ native: false, streaming, provider, response: new Response(body, {
          status: response.status, statusText: response.statusText, headers: response.headers,
        }) });
        if (reader) {
          try {
            while (true) {
              const next = await reader.read();
              controller.signal.throwIfAborted();
              if (next.done) break;
              sink!.enqueue(next.value);
            }
            closed = true;
            sink!.close();
          } finally { reader.releaseLock(); }
        }
      } catch (error) {
        reject(error);
        if (sink && !closed) { closed = true; sink.error(error); }
      } finally { controller.signal.removeEventListener('abort', abort); }
    });
    preparationTail = finished;
    return { requestId: options.requestId, text, result, finished, signal: controller.signal,
      cancel: () => controller.abort() };
  }

  async function speakText(text: string, prepared?: PreparedSpeech): Promise<TTSPlaybackOutcome> {
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
      if (prepared) controller.signal.addEventListener('abort', prepared.cancel, { once: true });
      const ttsRes = prepared
        ? (await prepared.result).response!
        : await requestBatchSpeech(speechText, controller.signal);

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
   * Play each server-owned speech phrase as it arrives, buffering subsequent
   * phrases on the same Web Audio timeline while synthesis continues.
   *
   * @param text - Text to speak
   * @param options - Optional parameters for voice control
   */
  async function speakTextStreaming(text: string, options?: StreamingSpeechOptions): Promise<TTSPlaybackOutcome> {
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
    const playbackComplete = new Promise<boolean>((resolve) => {
      streamPlaybackCompletion = { token, resolve };
    });

    isStreaming.set(true);
    isLoading.set(true);

    try {
      if (options?.prepared) controller.signal.addEventListener('abort', options.prepared.cancel, { once: true });
      const response = options?.prepared
        ? (await options.prepared.result).response!
        : await requestStreamingSpeech(speechText, options ?? {}, controller.signal);
      if (playbackWasStopped(token)) return finishPlayback(token, false);

      if (!response.ok) {
        throw new Error(`Streaming TTS request failed: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body for streaming');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let expectedChunks: number | undefined;

      console.log('[useTTS] SSE stream started');

      while (true) {
        const { done, value } = await reader.read();
        if (playbackWasStopped(token)) return finishPlayback(token, false);

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
            if (data.total_chunks !== audioQueue.length
              || (expectedChunks !== undefined && expectedChunks !== audioQueue.length)) {
              throw new Error('TTS stream completed with missing audio chunks');
            }
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
            if (streamComplete || !Number.isInteger(chunkIndex) || chunkIndex !== audioQueue.length
              || !Number.isInteger(totalChunks) || totalChunks < 1 || chunkIndex >= totalChunks
              || (expectedChunks !== undefined && expectedChunks !== totalChunks)) {
              throw new Error('TTS stream returned invalid chunk metadata');
            }
            expectedChunks = totalChunks;
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
        throw new Error('TTS stream ended before its completion event');
      }

      // Wait for all chunks to finish playing
      return finishPlayback(token, await playbackComplete);

    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        console.log('[useTTS] Streaming aborted');
        return finishPlayback(token, false);
      }
      console.warn('[useTTS] Streaming failed:', e);
      if (!playbackWasStopped(token)) {
        streamPlaybackFailed = true;
        stopStreaming();
      }
      return finishPlayback(token, false);
    } finally {
      if (streamAbortController === controller) streamAbortController = null;
      if (token === ttsPlaybackToken) {
        isLoading.set(false);
        isStreaming.set(false);
      }
    }
  }

  function finishStreamingPlaybackIfComplete(token: number): void {
    if (playbackWasStopped(token)) return;
    const allPlayed = audioQueue.length === 0 || audioQueue.every(chunk => chunk.played);
    if (!streamComplete || !allPlayed || streamSources.size > 0) return;
    isPlaying.set(false);
    if (streamReportedSpeaking) reportTTSState(false);
    streamReportedSpeaking = false;
    if (streamPlaybackCompletion?.token === token) {
      streamPlaybackCompletion.resolve(!streamPlaybackFailed);
      streamPlaybackCompletion = null;
    }
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
    audioUnlocked = false;
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
  async function speak(text: string, options?: StreamingSpeechOptions & {
    streaming?: boolean;
  }): Promise<TTSPlaybackOutcome> {
    const playbackRequest = playbackRequests.begin(options?.requestId);
    try {
      if (options?.prepared) {
        options.prepared.signal.throwIfAborted();
        const prepared = await options.prepared.result;
        options.prepared.signal.throwIfAborted();
        if (!playbackRequests.isActive(playbackRequest)) return 'interrupted';
        if (prepared.native) return await speakTextNative(text);
        return prepared.streaming
          ? await speakTextStreaming(text, { ...options, provider: prepared.provider })
          : await speakText(text, options.prepared);
      }

      // Check if native voice mode is enabled
      if (
        !options?.provider && isNativeVoiceModeEnabled()
        && isNativeTTSAvailable()
      ) {
        console.log('[useTTS] Native voice mode enabled - using device TTS');
        return await speakTextNative(text);
      }

      // Use server TTS - auto-select streaming for slow providers
      let useStreaming = options?.streaming;
      // If streaming not explicitly set, auto-detect based on provider
      if (useStreaming === undefined) {
        const provider = options?.provider ?? await fetchVoiceProvider();
        if (!playbackRequests.isActive(playbackRequest)) return 'interrupted';
        // RVC is slow (especially on CPU) - always use streaming for lower latency
        // KokoroService releases ordered phrases while later synthesis continues.
        useStreaming = provider === 'rvc' || provider === 'kokoro' || provider === 'kitten';
        if (useStreaming) {
          console.log(`[useTTS] Auto-selecting streaming mode for ${provider} provider`);
        }
      }

      if (!playbackRequests.isActive(playbackRequest)) return 'interrupted';
      if (useStreaming) {
        return await speakTextStreaming(text, {
          provider: options?.provider,
          voice: options?.voice,
          langCode: options?.langCode,
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
    prepareSpeech,      // Prepare without taking playback ownership
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
