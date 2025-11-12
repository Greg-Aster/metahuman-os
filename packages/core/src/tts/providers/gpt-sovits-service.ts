/**
 * GPT-SoVITS TTS Provider
 * Implements text-to-speech using GPT-SoVITS server
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { paths } from '../../paths.js';
import { audit } from '../../audit.js';
import { getCachedAudio, cacheAudio, getCacheStats, clearCache } from '../cache.js';
import type {
  ITextToSpeechService,
  TTSSynthesizeOptions,
  TTSStatus,
  SoVITSConfig,
  CacheConfig,
} from '../interface.js';

interface SoVITSRequest {
  text: string;
  text_lang?: string;
  ref_audio_path?: string;
  prompt_text?: string;
  prompt_lang?: string;
  top_k?: number;
  top_p?: number;
  temperature?: number;
  text_split_method?: string;
  batch_size?: number;
  speed_factor?: number;
  ref_text_free?: boolean;
}

export class SoVITSService implements ITextToSpeechService {
  private activeRequests = new Map<string, Promise<Buffer>>();
  private fallbackService?: ITextToSpeechService;

  constructor(
    private config: SoVITSConfig,
    private cacheConfig: CacheConfig,
    fallbackService?: ITextToSpeechService
  ) {
    this.fallbackService = fallbackService;
  }

  async synthesize(text: string, options?: TTSSynthesizeOptions): Promise<Buffer> {
    const speakerId = options?.voice || this.config.speakerId;
    const temperature = options?.temperature ?? this.config.temperature;
    const speed = options?.speakingRate ?? this.config.speed;

    // Check cache first
    const cacheKey = `${this.config.serverUrl}:${speakerId}`;
    const cached = getCachedAudio(this.cacheConfig, text, cacheKey, speed);
    if (cached) {
      return cached;
    }

    // Deduplicate concurrent requests
    const requestKey = `${text}:${speakerId}:${temperature}:${speed}`;
    const existing = this.activeRequests.get(requestKey);
    if (existing) {
      return existing;
    }

    const promise = this._synthesizeInternal(text, speakerId, temperature, speed, options?.signal);
    this.activeRequests.set(requestKey, promise);

    try {
      const result = await promise;
      return result;
    } finally {
      this.activeRequests.delete(requestKey);
    }
  }

  private async _synthesizeInternal(
    text: string,
    speakerId: string,
    temperature: number,
    speed: number,
    signal?: globalThis.AbortSignal
  ): Promise<Buffer> {
    const startTime = Date.now();

    // Check if server is available
    const serverAvailable = await this._checkServerHealth();
    if (!serverAvailable) {
      if (this.config.autoFallbackToPiper && this.fallbackService) {
        audit({
          level: 'info',
          category: 'action',
          event: 'tts_fallback_to_piper',
          details: { reason: 'SoVITS server unavailable' },
          actor: 'system',
        });
        return this.fallbackService.synthesize(text, { speakingRate: speed, signal });
      }
      throw new Error(`GPT-SoVITS server not available at ${this.config.serverUrl}`);
    }

    const abortError = new Error('TTS generation aborted');
    abortError.name = 'AbortError';

    if (signal?.aborted) {
      throw abortError;
    }

    try {
      // Find reference audio for speaker
      const referenceAudio = this._findReferenceAudio(speakerId);

      // Prepare request payload
      const payload: SoVITSRequest = {
        text,
        text_lang: 'en',
        ref_audio_path: referenceAudio,
        prompt_lang: 'en',
        temperature,
        speed_factor: speed,
        ref_text_free: !referenceAudio, // If no reference, use zero-shot mode
      };

      // Make HTTP request to SoVITS server
      const controller = new AbortController();
      const cleanup = () => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      const onAbort = () => {
        controller.abort();
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      const response = await fetch(`${this.config.serverUrl}/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
        // @ts-ignore - Node.js fetch timeout
        timeout: this.config.timeout,
      });

      cleanup();

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`SoVITS server error (${response.status}): ${errorText}`);
      }

      // Get audio data
      const contentType = response.headers.get('content-type');
      let audioBuffer: Buffer;

      if (contentType?.includes('application/json')) {
        // Base64-encoded response
        const json = await response.json();
        if (json.audio) {
          audioBuffer = Buffer.from(json.audio, 'base64');
        } else {
          throw new Error('SoVITS response missing audio data');
        }
      } else {
        // Direct binary response
        const arrayBuffer = await response.arrayBuffer();
        audioBuffer = Buffer.from(arrayBuffer);
      }

      // Normalize sample rate to match Piper (22.05kHz) for consistency
      const normalizedAudio = await this._normalizeSampleRate(audioBuffer);

      // Cache for future use
      const cacheKey = `${this.config.serverUrl}:${speakerId}`;
      cacheAudio(this.cacheConfig, text, cacheKey, speed, normalizedAudio);

      const duration = Date.now() - startTime;

      audit({
        level: 'info',
        category: 'action',
        event: 'tts_generated',
        details: {
          provider: 'gpt-sovits',
          textLength: text.length,
          audioSize: normalizedAudio.length,
          durationMs: duration,
          speakerId,
        },
        actor: 'system',
      });

      return normalizedAudio;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw error;
      }

      // Try fallback to Piper if configured
      if (this.config.autoFallbackToPiper && this.fallbackService) {
        audit({
          level: 'info',
          category: 'action',
          event: 'tts_fallback_to_piper',
          details: { reason: (error as Error).message },
          actor: 'system',
        });
        return this.fallbackService.synthesize(text, { speakingRate: speed, signal });
      }

      audit({
        level: 'error',
        category: 'action',
        event: 'tts_failed',
        details: {
          provider: 'gpt-sovits',
          error: (error as Error).message,
          textLength: text.length,
        },
        actor: 'system',
      });

      throw error;
    }
  }

  private async _checkServerHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.config.serverUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      }).catch(() => null);

      clearTimeout(timeoutId);

      return response?.ok ?? false;
    } catch {
      return false;
    }
  }

  private _findReferenceAudio(speakerId: string): string | undefined {
    const speakerDir = path.join(this.config.referenceAudioDir, speakerId);

    if (!fs.existsSync(speakerDir)) {
      return undefined;
    }

    // Look for reference audio files (wav, mp3, flac)
    const files = fs.readdirSync(speakerDir).filter((f) => /\.(wav|mp3|flac)$/i.test(f));

    if (files.length === 0) {
      return undefined;
    }

    // Prefer files named "reference.*" or use first available
    const referenceFile =
      files.find((f) => f.toLowerCase().startsWith('reference')) || files[0];

    return path.join(speakerDir, referenceFile);
  }

  private async _normalizeSampleRate(audioBuffer: Buffer): Promise<Buffer> {
    const { tmpdir } = await import('node:os');
    const { unlink, writeFile, readFile } = await import('node:fs/promises');
    const tmpPath = await import('node:path');

    const tempDir = tmpdir();
    const inputFile = tmpPath.join(tempDir, `sovits-input-${Date.now()}.wav`);
    const outputFile = tmpPath.join(tempDir, `sovits-output-${Date.now()}.wav`);

    try {
      await writeFile(inputFile, audioBuffer);

      await new Promise<void>((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
          '-i',
          inputFile,
          '-ar',
          '22050', // Piper default sample rate
          '-ac',
          '1', // Mono
          '-y',
          outputFile,
        ]);

        let stderr = '';
        ffmpeg.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        ffmpeg.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg normalization failed (code ${code}): ${stderr}`));
        });

        ffmpeg.on('error', reject);
      });

      const normalizedBuffer = await readFile(outputFile);

      await unlink(inputFile).catch(() => {});
      await unlink(outputFile).catch(() => {});

      return normalizedBuffer;
    } catch (error) {
      await unlink(inputFile).catch(() => {});
      await unlink(outputFile).catch(() => {});
      throw error;
    }
  }

  async getStatus(): Promise<TTSStatus> {
    const stats = getCacheStats(this.cacheConfig);
    const available = await this._checkServerHealth();

    return {
      provider: 'gpt-sovits',
      available,
      serverUrl: this.config.serverUrl,
      cacheEnabled: this.cacheConfig.enabled,
      cacheSize: stats.size,
      cacheFiles: stats.files,
      error: available ? undefined : 'Server not responding',
    };
  }

  clearCache(): void {
    clearCache(this.cacheConfig);
  }
}
