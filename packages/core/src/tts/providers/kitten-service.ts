import { ensureVoiceServiceRunning, getVoiceServiceStatus, getVoiceServiceUrl } from '../../voice-service-manager.js';
import { getCachedAudio, cacheAudio, getCacheStats, clearCache } from '../cache.js';
import type { CacheConfig, ITextToSpeechService, KittenConfig, TTSSynthesizeOptions, TTSStatus } from '../interface.js';

export const KITTEN_VOICES = ['Bella', 'Jasper', 'Luna', 'Bruno', 'Rosie', 'Hugo', 'Kiki', 'Leo'] as const;

export function validateKittenPreferences(voice: string, speed: number): void {
  if (!(KITTEN_VOICES as readonly string[]).includes(voice)) throw new Error(`Unknown Kitten voice: ${voice}`);
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error('Kitten speed must be between 0.5 and 2');
}

/** Batch request owner. Process lifecycle and ordered streaming have existing owners. */
export class KittenService implements ITextToSpeechService {
  constructor(private config: KittenConfig, private cache: CacheConfig) {}

  async synthesize(text: string, options: TTSSynthesizeOptions = {}): Promise<Buffer> {
    const voice = options.voice ?? this.config.voice;
    const speed = options.speakingRate ?? this.config.speed;
    validateKittenPreferences(voice, speed);
    if (!text.trim()) throw new Error('Text is required');
    options.signal?.throwIfAborted();
    const identifier = `kitten:micro-0.8:0.8.1:${voice}`;
    const cached = getCachedAudio(this.cache, text, identifier, speed);
    if (cached) return cached;
    await ensureVoiceServiceRunning('kitten');
    options.signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(120_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const response = await fetch(`${getVoiceServiceUrl('kitten')}/synthesize`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, speed }), signal,
    });
    if (!response.ok) throw new Error(`Kitten synthesis failed (${response.status}): ${await response.text()}`);
    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length === 0) throw new Error('Kitten returned empty audio');
    options.signal?.throwIfAborted();
    cacheAudio(this.cache, text, identifier, speed, audio);
    return audio;
  }

  async getStatus(): Promise<TTSStatus> {
    const status = await getVoiceServiceStatus('kitten');
    const cache = getCacheStats(this.cache);
    return { provider: 'kitten', available: status.healthy, serverUrl: status.url,
      cacheEnabled: this.cache.enabled, cacheSize: cache.size, cacheFiles: cache.files, error: status.error };
  }

  clearCache(): void { clearCache(this.cache); }
}
