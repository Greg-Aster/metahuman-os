<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { apiEventSource } from '../lib/client/api-config';
  import { readAssistantSpeechEnabled } from '../lib/client/assistant-speech-preference';
  import { useTTS } from '../lib/client/composables/useTTS';

  type TTSQueueItem = {
    id?: string;
    text?: string;
    mode?: string;
    source?: string;
  };

  const ttsApi = useTTS();
  let queueStream: EventSource | null = null;
  let playbackQueue = Promise.resolve();
  let mounted = false;

  async function playAdmittedItem(item: TTSQueueItem): Promise<void> {
    const text = item.text?.trim();
    const source = item.source || item.mode || 'unknown';

    if (!mounted || !text || !readAssistantSpeechEnabled()) {
      console.log(`[tts-queue] Skipping admitted item from ${source} (speech disabled or empty)`);
      return;
    }

    try {
      console.log(`[tts-queue] Playing node-admitted item from ${source} (${text.length} chars)`);
      await ttsApi.ensureAudioUnlocked();
      if (!mounted || !readAssistantSpeechEnabled()) return;
      await ttsApi.speak(text, { source, requestId: item.id });
    } catch (error) {
      console.warn(`[tts-queue] Playback failed for ${source}:`, error);
    }
  }

  function enqueueItems(items: TTSQueueItem[]): void {
    for (const item of items) {
      playbackQueue = playbackQueue.then(() => playAdmittedItem(item));
    }
  }

  function connectQueueStream(): void {
    if (queueStream) return;

    console.log('[tts-queue] Connecting app-level TTS queue stream');
    const stream = apiEventSource('/api/tts-queue-stream');
    queueStream = stream;

    stream.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'connected') return;
        if (data.type === 'error') {
          console.error('[tts-queue] Queue reported an error:', data.error);
          return;
        }
        if (data.type === 'tts' && Array.isArray(data.items)) {
          enqueueItems(data.items);
        }
      } catch (error) {
        console.error('[tts-queue] Could not parse queue event:', error);
      }
    };

    stream.onerror = (error) => {
      // Native EventSource reconnects automatically. Keep this app-lifetime
      // stream independent of Chat view changes and foreground pool suspension.
      console.warn('[tts-queue] Queue connection interrupted; waiting for reconnect', error);
    };
  }

  function unlockAudio(): void {
    void ttsApi.ensureAudioUnlocked();
  }

  onMount(() => {
    mounted = true;
    connectQueueStream();

    // Preserve a user gesture for later robot-initiated responses, which do
    // not originate from an interaction in the browser.
    window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
    window.addEventListener('keydown', unlockAudio, { once: true, capture: true });
  });

  onDestroy(() => {
    mounted = false;
    queueStream?.close();
    queueStream = null;
    window.removeEventListener('pointerdown', unlockAudio, { capture: true });
    window.removeEventListener('keydown', unlockAudio, { capture: true });
    ttsApi.cleanup();
  });
</script>
