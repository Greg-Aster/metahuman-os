/**
 * Kokoro TTS Provider
 * Implements text-to-speech using Kokoro StyleTTS2-based synthesis
 */

import { spawn } from 'node:child_process';
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
import type { PiperService } from './piper-service.js';

export class KokoroService implements ITextToSpeechService {
  constructor(
    private config: KokoroConfig,
    private cacheConfig: CacheConfig,
    private piperFallback?: PiperService
  ) {}

  async synthesize(text: string, options?: TTSSynthesizeOptions): Promise<Buffer> {
    const langCode = options?.langCode || this.config.langCode;
    const voice = options?.voice || this.config.voice;
    const speed = options?.speakingRate || this.config.speed;

    // Override useCustom if a built-in voice is explicitly requested via options
    // Built-in voices follow pattern: af_*, am_*, bf_*, bm_*, etc.
    const isBuiltInVoice = options?.voice && /^[a-z]{2}_[a-z]+$/.test(options.voice);
    const useCustom = isBuiltInVoice ? false : this.config.useCustomVoicepack;
    const customPath = this.config.customVoicepackPath;


    // Build cache key
    const voiceKey = useCustom ? `custom:${path.basename(customPath)}` : voice;
    const cacheKey = `kokoro:${langCode}:${voiceKey}`;

    // Check cache first
    const cached = getCachedAudio(this.cacheConfig, text, cacheKey, speed);
    if (cached) {
      return cached;
    }

    const requestId = generateRequestId();
    const startTime = Date.now();

    // Publish synthesize started event
    eventBus.emit('kokoro', EventTypes.KOKORO_SYNTHESIZE_STARTED, {
      textLength: text.length,
      voice: voiceKey,
      langCode,
      speed,
      useCustomVoicepack: useCustom,
      mode: this.config.server.useServer ? 'server' : 'cli',
    }, { requestId });

    try {
      let audioBuffer: Buffer;

      // Use server mode if configured and enabled
      if (this.config.server.useServer) {
        audioBuffer = await this.synthesizeViaServer(text, langCode, voice, speed, useCustom, customPath, options?.signal);
      } else {
        audioBuffer = await this.synthesizeViaCLI(text, langCode, voice, speed, useCustom, customPath, options?.signal);
      }

      // Cache for future use
      cacheAudio(this.cacheConfig, text, cacheKey, speed, audioBuffer);

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
          mode: this.config.server.useServer ? 'server' : 'cli',
          voice: voiceKey,
          langCode,
        },
        actor: 'system',
      });

      // Publish synthesize completed event
      eventBus.emit('kokoro', EventTypes.KOKORO_SYNTHESIZE_COMPLETED, {
        textLength: text.length,
        audioSize: audioBuffer.length,
        voice: voiceKey,
      }, { requestId, durationMs: duration });

      return audioBuffer;
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

        return this.piperFallback.synthesize(text, options);
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

    // Make HTTP request to server
    const controller = new AbortController();
    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }

    const response = await fetch(`${serverUrl}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Kokoro server error (${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Synthesize via direct Python CLI (fallback method)
   */
  private async synthesizeViaCLI(
    text: string,
    langCode: string,
    voice: string,
    speed: number,
    useCustom: boolean,
    customPath: string,
    signal?: AbortSignal
  ): Promise<Buffer> {
    const kokoroDir = path.join(ROOT, 'external', 'kokoro');
    const pythonBin = path.join(kokoroDir, 'venv', 'bin', 'python3');

    // Validate Python virtual environment exists
    if (!fs.existsSync(pythonBin)) {
      throw new Error(`Kokoro not installed. Run: ./bin/install-kokoro.sh`);
    }

    // Create temp output file
    const tempDir = this.cacheConfig.directory;
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const tempFile = path.join(tempDir, `kokoro_temp_${Date.now()}_${Math.random().toString(16).slice(2)}.wav`);

    const abortError = new Error('TTS generation aborted');
    abortError.name = 'AbortError';

    if (signal?.aborted) {
      throw abortError;
    }

    try {
      // Build Python command to run Kokoro
      const args = [
        '-m', 'kokoro',
        '--text', text,
        '--lang', langCode,
        '--voice', useCustom ? customPath : voice,
        '--speed', speed.toString(),
        '--output', tempFile,
      ];

      const child = spawn(pythonBin, args, {
        cwd: kokoroDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let aborted = false;
      const onAbort = () => {
        aborted = true;
        try {
          child.kill('SIGTERM');
        } catch {}
      };

      const cleanupAbort = () => {
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      };

      const stderrChunks: Buffer[] = [];
      child.stderr?.on('data', (chunk) => {
        stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      await new Promise<void>((resolve, reject) => {
        child.once('error', (err) => {
          cleanupAbort();
          reject(err);
        });

        child.once('close', (code) => {
          cleanupAbort();
          if (aborted || signal?.aborted) {
            reject(abortError);
            return;
          }
          if (code !== 0) {
            const stderr = stderrChunks.length ? Buffer.concat(stderrChunks).toString('utf-8').trim() : '';
            reject(new Error(`Kokoro CLI exited with code ${code}${stderr ? `: ${stderr}` : ''}`));
            return;
          }
          resolve();
        });
      });

      // Read generated audio
      if (!fs.existsSync(tempFile)) {
        throw new Error('Kokoro failed to generate audio file');
      }

      const audioBuffer = fs.readFileSync(tempFile);

      // Clean up temp file
      fs.unlinkSync(tempFile);

      return audioBuffer;
    } catch (error) {
      // Clean up temp file on error
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      throw error;
    }
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

    let serverAvailable = false;
    if (this.config.server.useServer) {
      serverAvailable = await this.checkServerHealth(getVoiceServiceUrl('kokoro'));
    }

    const cacheStats = getCacheStats(this.cacheConfig);

    return {
      provider: 'kokoro',
      available: installed && (serverAvailable || !this.config.server.useServer),
      modelPath: kokoroDir,
      serverUrl: this.config.server.useServer ? getVoiceServiceUrl('kokoro') : undefined,
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

    if (this.config.server.autoStart === false) {
      return false;
    }

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
