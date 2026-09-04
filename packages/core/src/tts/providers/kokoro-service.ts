/**
 * Kokoro TTS Provider
 * Implements text-to-speech using Kokoro StyleTTS2-based synthesis
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../path-builder.js';
import { audit } from '../../audit.js';
import {
  ensureVoiceServiceRunning,
  getVoiceServiceUrl,
  stopVoiceService,
} from '../../voice-service-manager.js';
import { eventBus, EventTypes, generateRequestId } from '../../infrastructure/event-bus/index.js';
import { getCachedAudio, cacheAudio, getCacheStats, clearCache } from '../cache.js';
import type { ITextToSpeechService, TTSSynthesizeOptions, TTSStatus, KokoroConfig, CacheConfig } from '../interface.js';
import { splitSpeechText } from '../speech-chunks.js';
import type { PiperService } from './piper-service.js';

export interface KokoroStreamChunk {
  index: number;
  total: number;
  text: string;
  audio: Buffer;
  isFinal: boolean;
  synthesisMs: number;
  cacheHit: boolean;
}

interface ResolvedKokoroOptions {
  langCode: string;
  voice: string;
  speed: number;
  useCustom: boolean;
  customPath: string;
  voiceKey: string;
  cacheKey: string;
}

interface KokoroSynthesisResult {
  audio: Buffer;
  cacheHit: boolean;
}

export class KokoroService implements ITextToSpeechService {
  constructor(
    private config: KokoroConfig,
    private cacheConfig: CacheConfig,
    private piperFallback?: PiperService
  ) {}

  async synthesize(text: string, options?: TTSSynthesizeOptions): Promise<Buffer> {
    const result = await this.synthesizeWithMetadata(text, options);
    return result.audio;
  }

  async *synthesizeStream(
    text: string,
    options: TTSSynthesizeOptions = {},
  ): AsyncGenerator<KokoroStreamChunk> {
    const chunks = splitSpeechText(text);
    if (chunks.length === 0) throw new Error('No speakable text to synthesize');

    const requestId = options.requestId || generateRequestId();
    const startedAt = Date.now();
    let audioBytes = 0;
    audit({
      level: 'info',
      category: 'action',
      event: 'tts_stream_started',
      details: {
        provider: 'kokoro',
        requestId,
        textLength: text.length,
        totalChunks: chunks.length,
      },
      actor: 'system',
    });

    try {
      for (let index = 0; index < chunks.length; index += 1) {
        if (options.signal?.aborted) {
          throw new DOMException('TTS generation aborted', 'AbortError');
        }
        const chunkStartedAt = Date.now();
        const chunkText = chunks[index]!;
        const result = await this.synthesizeWithMetadata(chunkText, options, requestId);
        const synthesisMs = Date.now() - chunkStartedAt;
        audioBytes += result.audio.length;

        if (index === 0) {
          audit({
            level: 'info',
            category: 'action',
            event: 'tts_stream_first_audio',
            details: {
              provider: 'kokoro',
              requestId,
              textLength: text.length,
              chunkLength: chunkText.length,
              durationMs: Date.now() - startedAt,
              cacheHit: result.cacheHit,
            },
            actor: 'system',
          });
        }

        yield {
          index,
          total: chunks.length,
          text: chunkText,
          audio: result.audio,
          isFinal: index === chunks.length - 1,
          synthesisMs,
          cacheHit: result.cacheHit,
        };
      }

      audit({
        level: 'info',
        category: 'action',
        event: 'tts_stream_completed',
        details: {
          provider: 'kokoro',
          requestId,
          textLength: text.length,
          totalChunks: chunks.length,
          audioBytes,
          durationMs: Date.now() - startedAt,
        },
        actor: 'system',
      });
    } catch (error) {
      audit({
        level: (error as Error).name === 'AbortError' ? 'info' : 'error',
        category: 'action',
        event: 'tts_stream_failed',
        details: {
          provider: 'kokoro',
          requestId,
          textLength: text.length,
          durationMs: Date.now() - startedAt,
          error: (error as Error).message,
        },
        actor: 'system',
      });
      throw error;
    }
  }

  private resolveOptions(options?: TTSSynthesizeOptions): ResolvedKokoroOptions {
    const langCode = options?.langCode || this.config.langCode;
    const voice = options?.voice || this.config.voice;
    const speed = options?.speakingRate || this.config.speed;

    // Override useCustom if a built-in voice is explicitly requested via options
    // Built-in voices follow pattern: af_*, am_*, bf_*, bm_*, etc.
    const isBuiltInVoice = options?.voice && /^[a-z]{2}_[a-z]+$/.test(options.voice);
    const useCustom = isBuiltInVoice ? false : this.config.useCustomVoicepack;
    const customPath = this.config.customVoicepackPath;
    const voiceKey = useCustom ? `custom:${path.basename(customPath)}` : voice;
    const cacheKey = `kokoro:${langCode}:${voiceKey}`;

    return { langCode, voice, speed, useCustom, customPath, voiceKey, cacheKey };
  }

  private async synthesizeWithMetadata(
    text: string,
    options?: TTSSynthesizeOptions,
    correlatedRequestId?: string,
  ): Promise<KokoroSynthesisResult> {
    const resolved = this.resolveOptions(options);

    // Check cache first
    const cached = getCachedAudio(this.cacheConfig, text, resolved.cacheKey, resolved.speed);
    if (cached) {
      return { audio: cached, cacheHit: true };
    }

    const requestId = correlatedRequestId || options?.requestId || generateRequestId();
    const startTime = Date.now();

    // Publish synthesize started event
    eventBus.emit('kokoro', EventTypes.KOKORO_SYNTHESIZE_STARTED, {
      textLength: text.length,
      voice: resolved.voiceKey,
      langCode: resolved.langCode,
      speed: resolved.speed,
      useCustomVoicepack: resolved.useCustom,
      mode: 'server',
    }, { requestId });

    try {
      const audioBuffer = await this.synthesizeViaServer(
        text,
        resolved.langCode,
        resolved.voice,
        resolved.speed,
        resolved.useCustom,
        resolved.customPath,
        options?.signal,
      );

      // Cache for future use
      cacheAudio(this.cacheConfig, text, resolved.cacheKey, resolved.speed, audioBuffer);

      const duration = Date.now() - startTime;

      audit({
        level: 'info',
        category: 'action',
        event: 'tts_generated',
        details: {
          provider: 'kokoro',
          textLength: text.length,
          audioSize: audioBuffer.length,
          durationMs: duration,
          mode: 'server',
          voice: resolved.voiceKey,
          langCode: resolved.langCode,
          requestId,
        },
        actor: 'system',
      });

      // Publish synthesize completed event
      eventBus.emit('kokoro', EventTypes.KOKORO_SYNTHESIZE_COMPLETED, {
        textLength: text.length,
        audioSize: audioBuffer.length,
        voice: resolved.voiceKey,
      }, { requestId, durationMs: duration });

      return { audio: audioBuffer, cacheHit: false };
    } catch (error) {
      // Fallback to Piper if configured
      if (this.config.autoFallbackToPiper && this.piperFallback) {
        audit({
          level: 'warn',
          category: 'action',
          event: 'tts_fallback',
          details: {
            provider: 'kokoro',
            fallbackTo: 'piper',
            error: (error as Error).message,
          },
          actor: 'system',
        });

        // Publish fallback event
        eventBus.emit('kokoro', EventTypes.KOKORO_SYNTHESIZE_FAILED, {
          error: (error as Error).message,
          fallbackTo: 'piper',
        }, { requestId, level: 'warn', durationMs: Date.now() - startTime });

        return {
          audio: await this.piperFallback.synthesize(text, options),
          cacheHit: false,
        };
      }

      // Publish synthesize failed event
      eventBus.emit('kokoro', EventTypes.KOKORO_SYNTHESIZE_FAILED, {
        error: (error as Error).message,
      }, { requestId, level: 'error', durationMs: Date.now() - startTime });

      throw error;
    }
  }

  /**
   * Synthesize via FastAPI server (preferred method)
   */
  private async synthesizeViaServer(
    text: string,
    langCode: string,
    voice: string,
    speed: number,
    useCustom: boolean,
    customPath: string,
    signal?: AbortSignal
  ): Promise<Buffer> {
    const serverUrl = getVoiceServiceUrl('kokoro');

    // Ensure server is ready (auto-start if needed)
    const serverReady = await this._ensureServerReady();
    if (!serverReady) {
      throw new Error(`Kokoro server could not be started at ${serverUrl}`);
    }

    // Prepare request payload
    const payload = {
      text,
      lang_code: langCode,
      voice: voice,
      speed,
      custom_voicepack: useCustom ? customPath : null,
      normalize: useCustom ? (this.config.normalizeCustomVoicepacks ?? true) : false,
    };

    const response = await fetch(`${serverUrl}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Kokoro server error (${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Check if Kokoro server is healthy
   */
  private async checkServerHealth(serverUrl: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      // Use longer timeout (5s) to handle slow responses and reduce false negatives
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${serverUrl}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  async getStatus(): Promise<TTSStatus> {
    const kokoroDir = path.join(ROOT, 'external', 'kokoro');
    const pythonBin = path.join(kokoroDir, 'venv', 'bin', 'python3');
    const installed = fs.existsSync(pythonBin);

    const serverAvailable = await this.checkServerHealth(getVoiceServiceUrl('kokoro'));

    const cacheStats = getCacheStats(this.cacheConfig);

    return {
      provider: 'kokoro',
      available: installed && serverAvailable,
      modelPath: kokoroDir,
      serverUrl: getVoiceServiceUrl('kokoro'),
      cacheEnabled: this.cacheConfig.enabled,
      cacheSize: cacheStats.size,
      cacheFiles: cacheStats.files,
      error: !installed ? 'Kokoro not installed. Run: ./bin/install-kokoro.sh' : undefined,
    };
  }

  clearCache(): void {
    clearCache(this.cacheConfig);
  }

  /**
   * Ensure Kokoro server is ready, auto-starting if necessary
   */
  private async _ensureServerReady(): Promise<boolean> {
    const serverUrl = getVoiceServiceUrl('kokoro');
    const available = await this.checkServerHealth(serverUrl);
    if (available) return true;

    try {
      await ensureVoiceServiceRunning('kokoro');
    } catch (error) {
      console.error('[KokoroService] Auto-start server failed:', error);
      return false;
    }

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await this.checkServerHealth(serverUrl)) return true;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return false;
  }

  /**
   * Shutdown Kokoro server and cleanup resources
   */
  async shutdown(): Promise<void> {
    console.log('[KokoroService] Shutting down Kokoro server...');
    await stopVoiceService('kokoro');

    // Publish server stopped event
    eventBus.emit('kokoro', EventTypes.KOKORO_SERVER_STOPPED, {});
  }
}
