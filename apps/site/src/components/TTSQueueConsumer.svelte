<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { apiEventSource, apiFetch } from '../lib/client/api-config';
  import { readAssistantSpeechEnabled } from '../lib/client/assistant-speech-preference';
  import { useTTS } from '../lib/client/composables/useTTS';
  import { shouldPlayAdmittedSpeech } from '../lib/client/inner-dialogue-speech-visibility';

  type TTSQueueItem = {
    id?: string;
    text?: string;
    mode?: string;
    source?: string;
    generation?: number;
    leaseToken?: string;
    leaseExpiresAt?: number;
  };

  const ttsApi = useTTS();
  let queueStream: EventSource | null = null;
  let playbackQueue = Promise.resolve();
  let mounted = false;
  let consumerId = '';
  let leaseDurationMs = 20_000;
  let queueGeneration = 0;
  let activeDeliveryId = '';
  const queueInterruptedDeliveries = new Set<string>();

  type DeliveryAction = 'complete' | 'renew' | 'retry' | 'suppress' | 'interrupt';

  async function updateDelivery(item: TTSQueueItem, action: DeliveryAction): Promise<boolean> {
    if (!item.id || !item.leaseToken) return false;
    try {
      const response = await apiFetch('/api/tts-queue-delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          leaseToken: item.leaseToken,
          action,
        }),
      });
      if (!response.ok) {
        console.warn(`[tts-queue] Delivery ${action} rejected for ${item.id} (${response.status})`);
        return false;
      }
      return true;
    } catch (error) {
      console.warn(`[tts-queue] Delivery ${action} failed for ${item.id}:`, error);
      return false;
    }
  }

  async function playAdmittedItem(item: TTSQueueItem): Promise<void> {
    const text = item.text?.trim();
    const source = item.source || item.mode || 'unknown';

    if (typeof item.generation === 'number' && item.generation < queueGeneration) {
      console.log(`[tts-queue] Skipping superseded delivery ${item.id}`);
      return;
    }

    if (!mounted || !text || !item.id || !item.leaseToken) {
      console.warn(`[tts-queue] Cannot play an invalid or unmounted delivery from ${source}`);
      return;
    }

    if (!shouldPlayAdmittedSpeech(item.mode)) {
      console.log(`[tts-queue] Suppressing admitted Inner Dialogue item from ${source} (Inner view closed)`);
      await updateDelivery(item, 'suppress');
      return;
    }

    if (!readAssistantSpeechEnabled()) {
      console.log(`[tts-queue] Suppressing admitted item from ${source} (speech disabled)`);
      await updateDelivery(item, 'suppress');
      return;
    }

    let renewInFlight = false;
    const renewLease = async (): Promise<void> => {
      if (renewInFlight || !mounted) return;
      renewInFlight = true;
      try {
        await updateDelivery(item, 'renew');
      } finally {
        renewInFlight = false;
      }
    };
    const renewInterval = window.setInterval(
      () => void renewLease(),
      Math.max(2_000, Math.floor(leaseDurationMs / 3)),
    );

    try {
      console.log(`[tts-queue] Playing node-admitted item from ${source} (${text.length} chars)`);
      activeDeliveryId = item.id;
      await ttsApi.ensureAudioUnlocked();
      if (!mounted) return;
      if (
        queueInterruptedDeliveries.delete(item.id)
        || (typeof item.generation === 'number' && item.generation < queueGeneration)
      ) return;
      if (!readAssistantSpeechEnabled()) {
        await updateDelivery(item, 'suppress');
        return;
      }
      const outcome = await ttsApi.speak(text, { source, requestId: item.id });
      if (!mounted) return;
      if (queueInterruptedDeliveries.delete(item.id)) return;
      const action: DeliveryAction = outcome === 'completed'
        ? 'complete'
        : outcome === 'interrupted'
          ? 'interrupt'
          : outcome === 'suppressed'
            ? 'suppress'
            : 'retry';
      await updateDelivery(item, action);
    } catch (error) {
      console.warn(`[tts-queue] Playback failed for ${source}:`, error);
      if (mounted) await updateDelivery(item, 'retry');
    } finally {
      if (activeDeliveryId === item.id) activeDeliveryId = '';
      window.clearInterval(renewInterval);
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
    const stream = apiEventSource(
      `/api/tts-queue-stream?consumerId=${encodeURIComponent(consumerId)}`,
    );
    queueStream = stream;

    stream.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'connected') {
          if (typeof data.leaseDurationMs === 'number') {
            leaseDurationMs = data.leaseDurationMs;
          }
          if (typeof data.generation === 'number') {
            if (data.generation > queueGeneration && activeDeliveryId) {
              queueInterruptedDeliveries.add(activeDeliveryId);
              ttsApi.interruptPlaybackRequest(activeDeliveryId, 'interrupted');
            }
            queueGeneration = Math.max(queueGeneration, data.generation);
          }
          return;
        }
        if (data.type === 'heartbeat') return;
        if (data.type === 'interrupt') {
          if (typeof data.generation === 'number') {
            queueGeneration = Math.max(queueGeneration, data.generation);
          }
          console.log('[tts-queue] Interrupting superseded playback', data.interruption);
          if (activeDeliveryId) {
            queueInterruptedDeliveries.add(activeDeliveryId);
            ttsApi.interruptPlaybackRequest(activeDeliveryId, 'interrupted');
          }
          return;
        }
        if (data.type === 'error') {
          console.error('[tts-queue] Queue reported an error:', data.error);
          return;
        }
        if (data.type === 'tts' && data.item) {
          enqueueItems([data.item]);
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
    consumerId = `tts-client-${crypto.randomUUID()}`;
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
