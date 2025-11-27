/**
 * Text-to-Speech (TTS) Composable
 * Handles all TTS functionality including voice synthesis, audio playback, and voice model management
 */

import { writable } from 'svelte/store';

// Types
interface VoiceModelsCache {
  multiVoice: boolean;
  models?: string[];
}

interface VoiceProviderCache {
  provider?: string;
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
   * Cleanup function to call on component unmount
   */
  function cleanup() {
    cancelInFlightTts();
    stopActiveAudio();
    if (audioCtx) {
      try { audioCtx.close(); } catch {}
      audioCtx = null;
    }
  }

  return {
    // Stores
    isPlaying,
    isLoading,

    // Methods
    speakText,
    stopActiveAudio,
    cancelInFlightTts,
    ensureAudioUnlocked,
    prefetchVoiceResources,
    isMobileDevice,
    cleanup,
  };
}
