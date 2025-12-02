/**
 * Text-to-Speech (TTS) Composable
 * Handles all TTS functionality including voice synthesis, audio playback, and voice model management
 * Supports both batch (full text) and streaming (sentence-by-sentence) modes
 */

import { writable, get } from 'svelte/store';

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
  audio: HTMLAudioElement;
  played: boolean;
}

// Constants
const VOICE_MODELS_CACHE_TTL = 60_000; // 1 minute
const VOICE_PROVIDER_CACHE_TTL = 30_000; // 30 seconds

// Utility: Check if running on mobile device
function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Normalize text for speech synthesis
 * Removes markdown formatting, code blocks, and other non-speakable content
 */
function normalizeTextForSpeech(text: string): string {
  if (!text) return '';
  let output = text;

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
  // Collapse whitespace
  output = output.replace(/\s+/g, ' ').trim();

  return output;
}

/**
 * TTS Composable
 * Provides reactive state and methods for text-to-speech functionality
 */
export function useTTS() {
  // State
  let audioCtx: AudioContext | null = null;
  let currentAudio: HTMLAudioElement | null = null;
  let currentObjectUrl: string | null = null;
  let currentTtsAbort: AbortController | null = null;
  let ttsPlaybackToken = 0;
  let audioUnlocked = false;

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
  let isPlayingChunk = false;
  let streamAbortController: AbortController | null = null;

  /**
   * Revoke current audio object URL to free memory
   */
  function revokeCurrentUrl() {
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
  }

  /**
   * Stop active audio playback
   */
  function stopActiveAudio() {
    if (currentAudio) {
      try {
        currentAudio.pause();
      } catch {}
      currentAudio = null;
    }
    revokeCurrentUrl();
    isPlaying.set(false);

    // Also stop streaming if active
    stopStreaming();
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

    // Stop any playing chunk
    for (const chunk of audioQueue) {
      try {
        chunk.audio.pause();
        URL.revokeObjectURL(chunk.audio.src);
      } catch {}
    }

    // Reset streaming state
    audioQueue = [];
    currentChunkIndex = 0;
    isPlayingChunk = false;
    isStreaming.set(false);
    streamProgress.set({ current: 0, total: 0 });
  }

  /**
   * Cancel in-flight TTS request
   */
  function cancelInFlightTts() {
    if (currentTtsAbort) {
      currentTtsAbort.abort();
      currentTtsAbort = null;
    }
    isLoading.set(false);
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
      const voiceModelsRes = await fetch('/api/voice-models');
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
      const settingsRes = await fetch('/api/voice-settings');
      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        voiceProviderCache = { provider: settings.provider };
        voiceProviderCacheTime = now;
        return settings.provider;
      }
    } catch (error) {
      console.warn('[useTTS] Failed to fetch voice provider:', error);
    }

    return undefined;
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
   */
  async function speakText(text: string): Promise<void> {
    console.log('[useTTS] speakText called with text length:', text.length);
    const speechText = normalizeTextForSpeech(text);
    console.log('[useTTS] normalized text length:', speechText?.length || 0);
    if (!speechText) {
      console.log('[useTTS] No speech text after normalization, aborting');
      return;
    }

    const token = ++ttsPlaybackToken;
    stopActiveAudio();
    cancelInFlightTts();

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

      const ttsRes = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ttsBody),
        signal: controller.signal
      });

      if (token !== ttsPlaybackToken) return;
      currentTtsAbort = null;
      isLoading.set(false);

      if (!ttsRes.ok) {
        console.warn('[useTTS] TTS request failed:', ttsRes.status);
        return;
      }

      const blob = await ttsRes.blob();
      if (token !== ttsPlaybackToken) return;

      const url = URL.createObjectURL(blob);
      currentObjectUrl = url;

      const audio = new Audio(url);
      currentAudio = audio;
      isPlaying.set(true);

      const cleanup = () => {
        if (token !== ttsPlaybackToken) return;
        stopActiveAudio();
      };

      audio.onended = cleanup;
      audio.onerror = cleanup;

      await audio.play().catch((err) => {
        console.warn('[useTTS] Audio playback failed:', err);
        cleanup();
      });
    } catch (e) {
      if (controller.signal.aborted) {
        // Expected when superseded by a new utterance
        return;
      }
      console.warn('[useTTS] speakText failed:', e);
    } finally {
      if (currentTtsAbort === controller) {
        currentTtsAbort = null;
      }
      isLoading.set(false);
    }
  }

  /**
   * Speak text using streaming TTS (sentence-by-sentence)
   * Audio starts playing as soon as the first chunk is ready
   *
   * @param text - Text to speak
   * @param options - Optional parameters for voice control
   */
  async function speakTextStreaming(text: string, options?: {
    pitchShift?: number;  // RVC pitch shift (-12 to +12)
    speed?: number;       // Speaking rate (0.5-2.0)
  }): Promise<void> {
    console.log('[useTTS] speakTextStreaming called with text length:', text.length);
    const speechText = normalizeTextForSpeech(text);
    console.log('[useTTS] normalized text length:', speechText?.length || 0);
    if (!speechText) {
      console.log('[useTTS] No speech text after normalization, aborting');
      return;
    }

    // Stop any existing playback
    stopActiveAudio();
    cancelInFlightTts();

    // Initialize streaming state
    audioQueue = [];
    currentChunkIndex = 0;
    isPlayingChunk = false;
    streamAbortController = new AbortController();

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
      };

      // Add optional parameters
      if (options?.pitchShift !== undefined) {
        requestBody.pitchShift = options.pitchShift;
      }
      if (options?.speed !== undefined) {
        requestBody.speed = options.speed;
      }

      // Start SSE connection to streaming endpoint
      const response = await fetch('/api/tts-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: streamAbortController.signal,
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

          try {
            const data = JSON.parse(event.slice(6));

            // Handle completion event
            if (data.event === 'complete') {
              console.log('[useTTS] Stream complete:', data.total_chunks, 'chunks');
              isLoading.set(false);
              continue;
            }

            // Handle error event
            if (data.event === 'error') {
              console.error('[useTTS] Stream error:', data.error);
              throw new Error(data.error);
            }

            // Handle audio chunk
            if (data.audio_base64) {
              console.log(`[useTTS] Received chunk ${data.chunk_index + 1}/${data.total_sentences}`);
              streamProgress.set({ current: data.chunk_index + 1, total: data.total_sentences });

              // Convert base64 to blob
              const binaryString = atob(data.audio_base64);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              const blob = new Blob([bytes], { type: 'audio/wav' });
              const url = URL.createObjectURL(blob);

              // Create audio element
              const audio = new Audio(url);
              audioQueue.push({
                index: data.chunk_index,
                audio,
                played: false,
              });

              // First chunk received - stop showing loading, start playing
              if (data.chunk_index === 0) {
                isLoading.set(false);
                isPlaying.set(true);
              }

              // Try to play next chunk if not already playing
              playNextChunk();
            }
          } catch (parseError) {
            console.warn('[useTTS] Failed to parse SSE event:', parseError);
          }
        }
      }

      // Wait for all chunks to finish playing
      await waitForPlaybackComplete();

    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        console.log('[useTTS] Streaming aborted');
        return;
      }
      console.warn('[useTTS] Streaming failed:', e);

      // Fallback to non-streaming mode
      console.log('[useTTS] Falling back to non-streaming TTS');
      stopStreaming();
      await speakText(text);
    } finally {
      isLoading.set(false);
      isStreaming.set(false);
    }
  }

  /**
   * Play the next chunk in the queue
   */
  function playNextChunk() {
    if (isPlayingChunk) return;

    // Find next unplayed chunk
    const chunk = audioQueue.find(c => c.index === currentChunkIndex && !c.played);
    if (!chunk) return;

    isPlayingChunk = true;
    chunk.played = true;

    console.log(`[useTTS] Playing chunk ${chunk.index}`);

    chunk.audio.onended = () => {
      console.log(`[useTTS] Chunk ${chunk.index} finished`);
      URL.revokeObjectURL(chunk.audio.src);
      isPlayingChunk = false;
      currentChunkIndex++;
      playNextChunk();

      // Check if all chunks are played
      const allPlayed = audioQueue.every(c => c.played);
      if (allPlayed && get(isStreaming) === false) {
        isPlaying.set(false);
      }
    };

    chunk.audio.onerror = () => {
      console.warn(`[useTTS] Chunk ${chunk.index} playback error`);
      URL.revokeObjectURL(chunk.audio.src);
      isPlayingChunk = false;
      currentChunkIndex++;
      playNextChunk();
    };

    chunk.audio.play().catch((err) => {
      console.warn(`[useTTS] Failed to play chunk ${chunk.index}:`, err);
      isPlayingChunk = false;
      currentChunkIndex++;
      playNextChunk();
    });
  }

  /**
   * Wait for all audio chunks to finish playing
   */
  function waitForPlaybackComplete(): Promise<void> {
    return new Promise((resolve) => {
      const checkComplete = () => {
        const allPlayed = audioQueue.every(c => c.played);
        if (allPlayed && !isPlayingChunk) {
          isPlaying.set(false);
          resolve();
        } else {
          setTimeout(checkComplete, 100);
        }
      };
      checkComplete();
    });
  }

  /**
   * Cleanup function to call on component unmount
   */
  function cleanup() {
    cancelInFlightTts();
    stopActiveAudio();
    stopStreaming();
    if (audioCtx) {
      try { audioCtx.close(); } catch {}
      audioCtx = null;
    }
  }

  return {
    // Stores
    isPlaying,
    isLoading,
    isStreaming,
    streamProgress,

    // Methods
    speakText,
    speakTextStreaming,
    stopActiveAudio,
    stopStreaming,
    cancelInFlightTts,
    ensureAudioUnlocked,
    prefetchVoiceResources,
    isMobileDevice,
    cleanup,
  };
}
