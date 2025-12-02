/**
 * RVC (Retrieval-based Voice Conversion) TTS Provider
 * Implements text-to-speech using RVC voice cloning via Applio
 *
 * Architecture: Two-stage synthesis
 * 1. Generate base speech with Piper (fast, high-quality TTS)
 * 2. Apply RVC voice conversion (clone user's voice)
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, systemPaths } from '../../path-builder.js';
import { audit } from '../../audit.js';
import { getCachedAudio, cacheAudio, getCacheStats, clearCache } from '../cache.js';
import { stopServer } from '../server-manager.js';
import type {
  ITextToSpeechService,
  TTSSynthesizeOptions,
  TTSStatus,
  RVCConfig,
  CacheConfig,
} from '../interface.js';

export class RVCService implements ITextToSpeechService {
  private fallbackService?: ITextToSpeechService;
  private serverStartPromise: Promise<boolean> | null = null;

  constructor(
    private config: RVCConfig,
    private cacheConfig: CacheConfig,
    fallbackService?: ITextToSpeechService
  ) {
    this.fallbackService = fallbackService;

    console.log('[RVCService] Constructor called with config:', {
      modelsDir: this.config.modelsDir,
      referenceAudioDir: this.config.referenceAudioDir,
      speakerId: this.config.speakerId,
      autoFallbackToPiper: this.config.autoFallbackToPiper,
    });

    // Auto-create reference audio directory if it doesn't exist
    const speakerDir = path.join(this.config.referenceAudioDir, this.config.speakerId);
    if (!fs.existsSync(speakerDir)) {
      fs.mkdirSync(speakerDir, { recursive: true });
      audit({
        level: 'info',
        category: 'system',
        event: 'rvc_directory_created',
        details: { speakerDir },
        actor: 'system',
      });
    }
  }

  async synthesize(text: string, options?: TTSSynthesizeOptions): Promise<Buffer> {
    const speakerId = options?.voice || this.config.speakerId;
    const pitchShift = options?.pitchShift ?? this.config.pitchShift;
    const speakingRate = options?.speakingRate ?? this.config.speed;
    const qualityKey = [
      speakerId,
      pitchShift,
      Number.isFinite(speakingRate) ? speakingRate.toFixed(2) : 'default',
      Number.isFinite(this.config.indexRate ?? NaN) ? (this.config.indexRate as number).toFixed(2) : 'idx',
      Number.isFinite(this.config.volumeEnvelope ?? NaN) ? (this.config.volumeEnvelope as number).toFixed(2) : 'env',
      Number.isFinite(this.config.protect ?? NaN) ? (this.config.protect as number).toFixed(2) : 'prot',
      this.config.f0Method || 'rmvpe',
      this.config.device || 'cuda',
    ].join(':');

    // Check cache first (include quality parameters so slider changes take effect)
    const cacheKey = `rvc:${qualityKey}`;
    const cached = getCachedAudio(this.cacheConfig, text, cacheKey, speakingRate);
    if (cached) {
      return cached;
    }

    const startTime = Date.now();

    const abortError = new Error('TTS generation aborted');
    abortError.name = 'AbortError';

    const { signal } = options ?? {};
    if (signal?.aborted) {
      throw abortError;
    }

    try {
      // Check if RVC model exists
      const modelExists = await this._validateModel(speakerId);
      console.log('[RVCService] synthesize() - Model validation result:', modelExists);
      if (!modelExists) {
        console.log('[RVCService] Model not found, falling back to Piper');
        if (this.config.autoFallbackToPiper && this.fallbackService) {
          audit({
            level: 'info',
            category: 'action',
            event: 'tts_fallback_to_piper',
            details: { reason: `No RVC model found for speaker: ${speakerId}` },
            actor: 'system',
          });
          return this.fallbackService.synthesize(text, { speakingRate, signal });
        }
        throw new Error(`RVC model not found for speaker: ${speakerId}. Please train a model first.`);
      }

      console.log('[RVCService] Model found! Proceeding with RVC synthesis...');

      // Stage 1: Generate base speech with Piper
      if (!this.fallbackService) {
        throw new Error('RVC requires Piper fallback service for base audio generation');
      }

      audit({
        level: 'info',
        category: 'action',
        event: 'rvc_stage1_piper',
        details: { textLength: text.length },
        actor: 'system',
      });

      const baseAudio = await this.fallbackService.synthesize(text, { speakingRate, signal });
      console.log('[RVCService] Stage 1 complete - Piper base audio generated:', baseAudio.length, 'bytes');

      // Stage 2: Apply RVC voice conversion
      audit({
        level: 'info',
        category: 'action',
        event: 'rvc_stage2_convert',
        details: { speakerId, pitchShift },
        actor: 'system',
      });

      console.log('[RVCService] Stage 2 starting - RVC voice conversion...');

      // Pause Ollama to free GPU VRAM for RVC inference (if enabled)
      const shouldPauseOllama = this.config.pauseOllamaDuringInference ?? true; // Default to true
      const ollamaPaused = shouldPauseOllama ? await this._pauseOllama() : false;

      let convertedAudio: Buffer;
      try {
        convertedAudio = await this._convertWithRVC(
          baseAudio,
          speakerId,
          pitchShift,
          signal
        );
        console.log('[RVCService] Stage 2 complete - RVC converted audio:', convertedAudio.length, 'bytes');
      } finally {
        // Always resume Ollama, even if RVC fails
        if (ollamaPaused) {
          await this._resumeOllama();
        }
      }

      // Cache the final result
      cacheAudio(this.cacheConfig, text, cacheKey, speakingRate, convertedAudio);

      const duration = Date.now() - startTime;

      audit({
        level: 'info',
        category: 'action',
        event: 'tts_generated',
        details: {
          provider: 'rvc',
          textLength: text.length,
          audioSize: convertedAudio.length,
          durationMs: duration,
          speakerId,
          pitchShift,
        },
        actor: 'system',
      });

      return convertedAudio;
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
        return this.fallbackService.synthesize(text, { speakingRate, signal });
      }

      audit({
        level: 'error',
        category: 'action',
        event: 'tts_failed',
        details: {
          provider: 'rvc',
          error: (error as Error).message,
          textLength: text.length,
        },
        actor: 'system',
      });

      throw error;
    }
  }

  /**
   * Check if RVC HTTP server is available
   */
  private async _checkServerAvailable(): Promise<boolean> {
    const serverUrl = this.config.serverUrl || 'http://127.0.0.1:9881';

    try {
      const response = await fetch(`${serverUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(1000), // 1 second timeout
      });

      if (response.ok) {
        const data = await response.json();
        console.log('[RVCService] Server health check:', data);
        return data.status === 'healthy';
      }

      return false;
    } catch (error) {
      console.log('[RVCService] Server not available:', (error as Error).message);
      return false;
    }
  }

  /**
   * Convert audio using HTTP server (persistent model loading - FAST!)
   */
  private async _convertWithRVCServer(
    inputAudio: Buffer,
    speakerId: string,
    pitchShift: number,
    signal?: globalThis.AbortSignal
  ): Promise<Buffer> {
    const serverUrl = this.config.serverUrl || 'http://127.0.0.1:9881';
    console.log('[RVCService] Using HTTP server for RVC conversion:', serverUrl);

    try {
      // Encode audio to base64
      const audioBase64 = inputAudio.toString('base64');

      // Prepare request body
      const requestBody = {
        audio_base64: audioBase64,
        speaker_id: speakerId,
        pitch_shift: pitchShift,
        index_rate: this.config.indexRate ?? 1.0,
        volume_envelope: this.config.volumeEnvelope ?? 0.0,
        protect: this.config.protect ?? 0.15,
        f0_method: this.config.f0Method || 'rmvpe',
      };

      // Call server API
      const response = await fetch(`${serverUrl}/synthesize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(`Server returned ${response.status}: ${error.detail || 'Unknown error'}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Server conversion failed');
      }

      console.log('[RVCService] Server conversion completed in', result.duration_ms, 'ms');
      console.log('[RVCService] Output audio size:', result.audio_size, 'bytes');

      // Decode base64 audio
      const outputAudio = Buffer.from(result.audio_base64, 'base64');

      audit({
        level: 'info',
        category: 'action',
        event: 'rvc_server_conversion',
        details: {
          speakerId,
          pitchShift,
          inputSize: inputAudio.length,
          outputSize: outputAudio.length,
          durationMs: result.duration_ms,
        },
        actor: 'system',
      });

      return outputAudio;

    } catch (error) {
      console.error('[RVCService] Server conversion failed:', error);
      throw error;
    }
  }

  /**
   * Apply RVC voice conversion to base audio
   * Tries HTTP server first (fast), falls back to process spawning (slow)
   */
  private async _convertWithRVC(
    inputAudio: Buffer,
    speakerId: string,
    pitchShift: number,
    signal?: globalThis.AbortSignal
  ): Promise<Buffer> {
    console.log('[RVCService] _convertWithRVC called:', { speakerId, pitchShift, inputSize: inputAudio.length });

    // Try HTTP server first if enabled (default: true)
    const useServer = this.config.useServer ?? true;
    if (useServer) {
      const serverAvailable = await this._ensureServerReady();
      if (serverAvailable) {
        console.log('[RVCService] Server available, using HTTP API for fast inference');
        try {
          return await this._convertWithRVCServer(inputAudio, speakerId, pitchShift, signal);
        } catch (error) {
          console.warn('[RVCService] Server conversion failed, falling back to process spawning:', error);
          // Fall through to process spawning method below
        }
      } else {
      console.log('[RVCService] Server not available, using process spawning (slow)');
    }
    }

    // Fallback to process spawning (original slow method)
    console.log('[RVCService] Using process spawning method for RVC conversion');

    const { tmpdir } = await import('node:os');
    const { unlink, writeFile, readFile } = await import('node:fs/promises');
    const tmpPath = await import('node:path');

    const tempDir = tmpdir();
    const inputFile = tmpPath.join(tempDir, `rvc-input-${Date.now()}.wav`);
    const outputFile = tmpPath.join(tempDir, `rvc-output-${Date.now()}.wav`);

    console.log('[RVCService] Temp files:', { inputFile, outputFile });

    try {
      // Write input audio to temp file
      await writeFile(inputFile, inputAudio);
      console.log('[RVCService] Wrote input audio to temp file');

      // Get model paths
      const modelDir = path.join(this.config.modelsDir, speakerId);
      const modelPath = path.join(modelDir, `${speakerId}.pth`);
      const indexPath = path.join(modelDir, `${speakerId}.index`);

      // Validate model files exist
      if (!fs.existsSync(modelPath)) {
        throw new Error(`RVC model file not found: ${modelPath}`);
      }
      console.log('[RVCService] Model path validated:', modelPath);

      // Python script path
      const rvcDir = path.join(ROOT, 'external', 'applio-rvc');
      const venvPython = path.join(rvcDir, 'venv', 'bin', 'python3');
      const inferScript = path.join(rvcDir, 'infer.py');

      // Check if Python venv exists
      const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python3';
      console.log('[RVCService] Using Python:', pythonBin);
      console.log('[RVCService] Infer script:', inferScript);

      // Build RVC inference arguments
      const args = [
        inferScript,
        '--input', inputFile,
        '--output', outputFile,
        '--model', modelPath,
        '--pitch', pitchShift.toString(),
      ];

      // Add index file if it exists
      if (fs.existsSync(indexPath)) {
        args.push('--index', indexPath);
      }

      // Add inference quality parameters
      if (this.config.indexRate !== undefined) {
        args.push('--index-rate', this.config.indexRate.toString());
      }
      if (this.config.volumeEnvelope !== undefined) {
        args.push('--volume-envelope', this.config.volumeEnvelope.toString());
      }
      if (this.config.protect !== undefined) {
        args.push('--protect', this.config.protect.toString());
      }
      if (this.config.f0Method) {
        args.push('--f0-method', this.config.f0Method);
      }
      if (this.config.device) {
        args.push('--device', this.config.device);
      }

      console.log('[RVCService] Spawning RVC inference with args:', args);

      // Spawn RVC inference process
      await new Promise<void>((resolve, reject) => {
        const child = spawn(pythonBin, args, {
          cwd: rvcDir,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        console.log('[RVCService] RVC process spawned, PID:', child.pid);

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

        if (signal) {
          signal.addEventListener('abort', onAbort, { once: true });
        }

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        child.stdout?.on('data', (chunk) => {
          stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          console.log('[RVCService] stdout:', chunk.toString().trim());
        });

        child.stderr?.on('data', (chunk) => {
          stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          console.log('[RVCService] stderr:', chunk.toString().trim());
        });

        child.once('error', (err) => {
          console.log('[RVCService] Process error:', err);
          cleanupAbort();
          reject(err);
        });

        child.once('close', (code) => {
          console.log('[RVCService] Process closed with code:', code);
          cleanupAbort();
          if (aborted || signal?.aborted) {
            reject(new Error('RVC conversion aborted'));
            return;
          }
          if (code !== 0) {
            const stderr = stderrChunks.length
              ? Buffer.concat(stderrChunks).toString('utf-8').trim()
              : '';
            const stdout = stdoutChunks.length
              ? Buffer.concat(stdoutChunks).toString('utf-8').trim()
              : '';
            console.log('[RVCService] Inference failed. stdout:', stdout);
            console.log('[RVCService] Inference failed. stderr:', stderr);
            reject(new Error(`RVC inference failed (code ${code})${stderr ? `: ${stderr}` : ''}`));
            return;
          }
          resolve();
        });
      });

      // Read converted audio
      console.log('[RVCService] Reading converted audio from:', outputFile);

      // Verify output file exists and has content
      if (!fs.existsSync(outputFile)) {
        throw new Error(`RVC conversion completed but output file not found: ${outputFile}`);
      }

      const stats = fs.statSync(outputFile);
      console.log('[RVCService] Output file size:', stats.size, 'bytes');

      if (stats.size === 0) {
        throw new Error('RVC conversion produced empty output file');
      }

      if (stats.size < 44) {
        throw new Error('RVC conversion produced invalid WAV file (too small)');
      }

      const convertedBuffer = await readFile(outputFile);
      console.log('[RVCService] Successfully read converted audio:', convertedBuffer.length, 'bytes');

      // Clean up temp files
      await unlink(inputFile).catch(() => {});
      await unlink(outputFile).catch(() => {});

      return convertedBuffer;
    } catch (error) {
      // Clean up on error
      await unlink(inputFile).catch(() => {});
      await unlink(outputFile).catch(() => {});
      throw error;
    }
  }

  /**
   * Validate that RVC model exists for speaker
   */
  private async _validateModel(speakerId: string): Promise<boolean> {
    const modelDir = path.join(this.config.modelsDir, speakerId);
    const modelPath = path.join(modelDir, `${speakerId}.pth`);

    const exists = fs.existsSync(modelPath);
    console.log('[RVCService] Model validation:', {
      speakerId,
      modelsDir: this.config.modelsDir,
      modelDir,
      modelPath,
      exists,
    });

    return exists;
  }

  getStatus(): TTSStatus {
    const stats = getCacheStats(this.cacheConfig);
    const modelPath = path.join(
      this.config.modelsDir,
      this.config.speakerId,
      `${this.config.speakerId}.pth`
    );
    const modelExists = fs.existsSync(modelPath);

    return {
      provider: 'rvc',
      available: modelExists,
      modelPath,
      cacheEnabled: this.cacheConfig.enabled,
      cacheSize: stats.size,
      cacheFiles: stats.files,
      error: modelExists ? undefined : 'RVC model not trained. Please train a voice model first.',
    };
  }

  clearCache(): void {
    clearCache(this.cacheConfig);
  }

  private _getServerUrl(): URL {
    try {
      return new URL(this.config.serverUrl || 'http://127.0.0.1:9881');
    } catch {
      return new URL('http://127.0.0.1:9881');
    }
  }

  private async _ensureServerReady(): Promise<boolean> {
    const available = await this._checkServerAvailable();
    if (available) return true;

    if (this.config.autoStartServer === false) {
      return false;
    }

    if (!this.serverStartPromise) {
      this.serverStartPromise = this._startRvcServerProcess()
        .catch((error) => {
          console.error('[RVCService] Auto-start server failed:', error);
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

    return this._checkServerAvailable();
  }

  private async _startRvcServerProcess(): Promise<boolean> {
    const autoStart = this.config.autoStartServer ?? true;
    if (!autoStart) {
      return false;
    }

    const rvcDir = path.join(ROOT, 'external', 'applio-rvc');
    const pythonBin = path.join(rvcDir, 'venv', 'bin', 'python3');
    const serverScript = path.join(rvcDir, 'server.py');

    if (!fs.existsSync(pythonBin) || !fs.existsSync(serverScript)) {
      console.warn('[RVCService] Cannot auto-start server: missing python env or server.py');
      return false;
    }

    if (!this.config.modelsDir || !fs.existsSync(this.config.modelsDir)) {
      console.warn('[RVCService] Cannot auto-start server: models directory missing');
      return false;
    }

    const url = this._getServerUrl();
    const port = Number(url.port) || 9881;
    const device = this.config.device || 'cuda';
    const speaker = this.config.speakerId || 'default';
    const logFile = path.join(systemPaths.run, 'rvc-server.log');

    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      const logFd = fs.openSync(logFile, 'a');

      const child = spawn(
        pythonBin,
        [
          serverScript,
          '--port', String(port),
          '--device', device,
          '--speaker', speaker,
          '--models-dir', this.config.modelsDir,
        ],
        {
          cwd: rvcDir,
          detached: true,
          stdio: ['ignore', logFd, logFd],
        }
      );

      child.unref();
      fs.closeSync(logFd);

      audit({
        level: 'info',
        category: 'system',
        event: 'rvc_server_auto_start',
        details: { port, device, speaker },
        actor: 'system',
      });

      const timeout = this.config.serverStartupTimeoutMs ?? 8000;
      const pollInterval = 500;
      const start = Date.now();

      while (Date.now() - start < timeout) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        if (await this._checkServerAvailable()) {
          audit({
            level: 'info',
            category: 'system',
            event: 'rvc_server_auto_started',
            details: { port },
            actor: 'system',
          });
          return true;
        }
      }

      console.warn('[RVCService] RVC server failed to become healthy within timeout');
      return false;
    } catch (error) {
      console.error('[RVCService] Failed to start RVC server process:', error);
      return false;
    }
  }

  /**
   * Pause Ollama to free GPU VRAM for RVC inference
   * Returns true if Ollama was running and successfully paused
   */
  private async _pauseOllama(): Promise<boolean> {
    try {
      // Check if Ollama is running
      const { execSync } = await import('node:child_process');

      try {
        execSync('pgrep -f ollama', { stdio: 'pipe' });
      } catch {
        // Ollama not running, no need to pause
        console.log('[RVCService] Ollama not running, no GPU conflict');
        return false;
      }

      console.log('[RVCService] Pausing Ollama to free GPU VRAM...');

      audit({
        level: 'info',
        category: 'system',
        event: 'ollama_paused_for_rvc',
        details: { reason: 'Free GPU VRAM for RVC inference' },
        actor: 'system',
      });

      // Send SIGSTOP to pause Ollama (keeps it in memory but stops GPU usage)
      execSync('pkill -STOP -f ollama', { stdio: 'ignore' });

      // Wait 500ms for GPU memory to be released
      await new Promise(resolve => setTimeout(resolve, 500));

      console.log('[RVCService] Ollama paused, GPU VRAM released');
      return true;
    } catch (error) {
      console.error('[RVCService] Failed to pause Ollama:', error);
      return false;
    }
  }

  /**
   * Resume Ollama after RVC inference completes
   */
  private async _resumeOllama(): Promise<void> {
    try {
      console.log('[RVCService] Resuming Ollama...');

      const { execSync } = await import('node:child_process');

      // Send SIGCONT to resume Ollama
      execSync('pkill -CONT -f ollama', { stdio: 'ignore' });

      // Wait 500ms for Ollama to reload models into GPU
      await new Promise(resolve => setTimeout(resolve, 500));

      audit({
        level: 'info',
        category: 'system',
        event: 'ollama_resumed_after_rvc',
        details: { message: 'Ollama resumed after RVC inference' },
        actor: 'system',
      });

      console.log('[RVCService] Ollama resumed');
    } catch (error) {
      console.error('[RVCService] Failed to resume Ollama:', error);
      // Non-fatal - Ollama will auto-resume on next request
    }
  }

  /**
   * Shutdown RVC server and cleanup resources
   */
  async shutdown(): Promise<void> {
    console.log('[RVCService] Shutting down RVC server...');
    await stopServer('rvc');
  }
}
