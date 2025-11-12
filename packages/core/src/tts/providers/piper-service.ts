/**
 * Piper TTS Provider
 * Implements text-to-speech using Piper neural TTS
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../../paths.js';
import { audit } from '../../audit.js';
import { getCachedAudio, cacheAudio, getCacheStats, clearCache } from '../cache.js';
import type { ITextToSpeechService, TTSSynthesizeOptions, TTSStatus, PiperConfig, CacheConfig } from '../interface.js';

export class PiperService implements ITextToSpeechService {
  constructor(
    private config: PiperConfig,
    private cacheConfig: CacheConfig
  ) {}

  async synthesize(text: string, options?: TTSSynthesizeOptions): Promise<Buffer> {
    const modelPath = options?.voice || this.config.model;
    const configPath = this.config.config;
    const speakingRate = options?.speakingRate ?? this.config.speakingRate;

    // Check cache first
    const cached = getCachedAudio(this.cacheConfig, text, modelPath, speakingRate);
    if (cached) {
      return cached;
    }

    const startTime = Date.now();

    // Validate Piper binary exists
    if (!fs.existsSync(this.config.binary)) {
      throw new Error(`Piper binary not found at ${this.config.binary}`);
    }

    // Validate model exists
    if (!fs.existsSync(modelPath)) {
      throw new Error(`Piper model not found at ${modelPath}`);
    }

    // Generate temp output file
    const tempDir = this.cacheConfig.directory;
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const tempFile = path.join(tempDir, `temp_${Date.now()}_${Math.random().toString(16).slice(2)}.wav`);

    const abortError = new Error('TTS generation aborted');
    abortError.name = 'AbortError';

    const { signal } = options ?? {};
    if (signal?.aborted) {
      throw abortError;
    }

    try {
      const args = ['--model', modelPath, '--output_file', tempFile];

      // Add config if provided
      if (configPath) {
        args.push('--config', configPath);
      }

      // Add speaking rate if different from 1.0
      if (speakingRate && speakingRate !== 1.0) {
        args.push('--length_scale', String(1 / speakingRate));
      }

      const child = spawn(this.config.binary, args, {
        cwd: paths.root,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (child.stdin) {
        child.stdin.setDefaultEncoding('utf-8');
        child.stdin.write(text);
        child.stdin.end('\n');
      }

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
            reject(new Error(`Piper exited with code ${code}${stderr ? `: ${stderr}` : ''}`));
            return;
          }
          resolve();
        });
      });

      // Read generated audio
      const audioBuffer = fs.readFileSync(tempFile);

      // Clean up temp file
      fs.unlinkSync(tempFile);

      // Cache for future use
      cacheAudio(this.cacheConfig, text, modelPath, speakingRate, audioBuffer);

      const duration = Date.now() - startTime;

      audit({
        level: 'info',
        category: 'action',
        event: 'tts_generated',
        details: {
          provider: 'piper',
          textLength: text.length,
          audioSize: audioBuffer.length,
          durationMs: duration,
        },
        actor: 'system',
      });

      return audioBuffer;
    } catch (error) {
      // Clean up temp file if it exists
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      if ((error as Error).name === 'AbortError') {
        throw error;
      }

      audit({
        level: 'error',
        category: 'action',
        event: 'tts_failed',
        details: { provider: 'piper', error: (error as Error).message, textLength: text.length },
        actor: 'system',
      });

      throw error;
    }
  }

  getStatus(): TTSStatus {
    const stats = getCacheStats(this.cacheConfig);

    return {
      provider: 'piper',
      available: fs.existsSync(this.config.binary) && fs.existsSync(this.config.model),
      modelPath: this.config.model,
      cacheEnabled: this.cacheConfig.enabled,
      cacheSize: stats.size,
      cacheFiles: stats.files,
    };
  }

  clearCache(): void {
    clearCache(this.cacheConfig);
  }
}
