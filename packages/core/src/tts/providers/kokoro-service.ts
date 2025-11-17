/**
 * Kokoro TTS Provider
 * Implements text-to-speech using Kokoro StyleTTS2-based synthesis
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../../paths.js';
import { audit } from '../../audit.js';
import { getCachedAudio, cacheAudio, getCacheStats, clearCache } from '../cache.js';
import { stopServer } from '../server-manager.js';
import type { ITextToSpeechService, TTSSynthesizeOptions, TTSStatus, KokoroConfig, CacheConfig } from '../interface.js';
import type { PiperService } from './piper-service.js';

export class KokoroService implements ITextToSpeechService {
  private serverStartPromise: Promise<boolean> | null = null;

  constructor(
    private config: KokoroConfig,
    private cacheConfig: CacheConfig,
    private piperFallback?: PiperService
  ) {}

  async synthesize(text: string, options?: TTSSynthesizeOptions): Promise<Buffer> {
    const langCode = options?.langCode || this.config.langCode;
    const voice = options?.voice || this.config.voice;
    const speed = options?.speakingRate || this.config.speed;
    const useCustom = this.config.useCustomVoicepack;
    const customPath = this.config.customVoicepackPath;

    // Build cache key
    const voiceKey = useCustom ? `custom:${path.basename(customPath)}` : voice;
    const cacheKey = `kokoro:${langCode}:${voiceKey}`;

    // Check cache first
    const cached = getCachedAudio(this.cacheConfig, text, cacheKey, speed);
    if (cached) {
      return cached;
    }

    const startTime = Date.now();

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

        return this.piperFallback.synthesize(text, options);
      }

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
    const serverUrl = this.config.server.url;

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
    const kokoroDir = path.join(paths.root, 'external', 'kokoro');
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
      const timeout = setTimeout(() => controller.abort(), 2000);

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
    const kokoroDir = path.join(paths.root, 'external', 'kokoro');
    const pythonBin = path.join(kokoroDir, 'venv', 'bin', 'python3');
    const installed = fs.existsSync(pythonBin);

    let serverAvailable = false;
    if (this.config.server.useServer) {
      serverAvailable = await this.checkServerHealth(this.config.server.url);
    }

    const cacheStats = getCacheStats(this.cacheConfig);

    return {
      provider: 'kokoro',
      available: installed && (serverAvailable || !this.config.server.useServer),
      modelPath: kokoroDir,
      serverUrl: this.config.server.useServer ? this.config.server.url : undefined,
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
    const serverUrl = this.config.server.url;
    const available = await this.checkServerHealth(serverUrl);
    if (available) return true;

    // Check if auto-start is disabled
    if (this.config.server.autoStart === false) {
      return false;
    }

    // Start server if not already starting
    if (!this.serverStartPromise) {
      this.serverStartPromise = this._startKokoroServerProcess()
        .catch((error) => {
          console.error('[KokoroService] Auto-start server failed:', error);
          return false;
        })
        .finally(() => {
          this.serverStartPromise = null;
        });
    }

    const started = await this.serverStartPromise;
    if (!started) {
      return false;
    }

    // Verify server is actually healthy
    return this.checkServerHealth(serverUrl);
  }

  /**
   * Start Kokoro FastAPI server as a detached background process
   */
  private async _startKokoroServerProcess(): Promise<boolean> {
    const autoStart = this.config.server.autoStart ?? false;
    if (!autoStart) {
      return false;
    }

    const kokoroDir = path.join(paths.root, 'external', 'kokoro');
    const pythonBin = path.join(kokoroDir, 'venv', 'bin', 'python3');
    const serverScript = path.join(kokoroDir, 'kokoro_server.py');

    // Validate required files exist
    if (!fs.existsSync(pythonBin)) {
      console.warn('[KokoroService] Cannot auto-start: Python venv not found');
      return false;
    }
    if (!fs.existsSync(serverScript)) {
      console.warn('[KokoroService] Cannot auto-start: server.py not found');
      return false;
    }

    const port = this.config.server.port || 9882;
    const logDir = path.join(paths.root, 'logs', 'run');
    const logFile = path.join(logDir, 'kokoro-server.log');
    const pidFile = path.join(logDir, 'kokoro-server.pid');

    try {
      // Ensure log directory exists
      fs.mkdirSync(logDir, { recursive: true });
      const logFd = fs.openSync(logFile, 'a');

      // Spawn server as detached background process
      const child = spawn(
        pythonBin,
        [serverScript, '--port', String(port)],
        {
          cwd: kokoroDir,
          detached: true,
          stdio: ['ignore', logFd, logFd],
        }
      );

      // Save PID for status checking
      if (child.pid) {
        fs.writeFileSync(pidFile, child.pid.toString());
      }

      child.unref();
      fs.closeSync(logFd);

      audit({
        level: 'info',
        category: 'system',
        event: 'kokoro_server_auto_start',
        details: { port },
        actor: 'system',
      });

      // Poll for server health with timeout (10 seconds default)
      const timeout = 10000;
      const pollInterval = 500;
      const start = Date.now();

      while (Date.now() - start < timeout) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        if (await this.checkServerHealth(this.config.server.url)) {
          audit({
            level: 'info',
            category: 'system',
            event: 'kokoro_server_auto_started',
            details: { port, durationMs: Date.now() - start },
            actor: 'system',
          });
          return true;
        }
      }

      console.warn('[KokoroService] Server failed to become healthy within timeout');
      return false;
    } catch (error) {
      console.error('[KokoroService] Failed to start server process:', error);
      return false;
    }
  }

  /**
   * Shutdown Kokoro server and cleanup resources
   */
  async shutdown(): Promise<void> {
    console.log('[KokoroService] Shutting down Kokoro server...');
    await stopServer('kokoro');
  }
}
