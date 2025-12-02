/**
 * Whisper STT Service Provider
 * Implements speech-to-text using faster-whisper with server support
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, systemPaths } from '../../path-builder.js';
import { audit } from '../../audit.js';

export interface WhisperServerConfig {
  useServer: boolean;
  url: string;
  autoStart: boolean;
  port: number;
}

export interface WhisperConfig {
  model: string;
  device: 'cpu' | 'cuda';
  computeType: 'int8' | 'float16' | 'float32';
  language: string;
  server: WhisperServerConfig;
}

export interface TranscriptionResult {
  text: string;
  language: string;
  language_probability: number;
  duration?: number;
}

export class WhisperService {
  private serverStartPromise: Promise<boolean> | null = null;

  constructor(private config: WhisperConfig) {}

  /**
   * Transcribe audio buffer to text
   */
  async transcribe(audioBuffer: Buffer, audioFormat: 'wav' | 'webm' | 'mp3' = 'wav'): Promise<string> {
    const startTime = Date.now();

    try {
      let result: TranscriptionResult;

      // Use server mode if configured and enabled
      if (this.config.server.useServer) {
        result = await this.transcribeViaServer(audioBuffer, audioFormat);
      } else {
        result = await this.transcribeViaCLI(audioBuffer, audioFormat);
      }

      const duration = Date.now() - startTime;

      audit({
        level: 'info',
        category: 'action',
        event: 'stt_transcribed',
        details: {
          provider: 'whisper',
          audioSize: audioBuffer.length,
          audioFormat,
          textLength: result.text.length,
          language: result.language,
          languageProbability: result.language_probability,
          durationMs: duration,
          mode: this.config.server.useServer ? 'server' : 'cli',
          device: this.config.device,
          model: this.config.model,
        },
        actor: 'system',
      });

      return result.text;
    } catch (error) {
      audit({
        level: 'error',
        category: 'action',
        event: 'stt_failed',
        details: {
          provider: 'whisper',
          error: (error as Error).message,
          mode: this.config.server.useServer ? 'server' : 'cli',
        },
        actor: 'system',
      });

      throw error;
    }
  }

  /**
   * Transcribe via FastAPI server (preferred method)
   */
  private async transcribeViaServer(audioBuffer: Buffer, audioFormat: string): Promise<TranscriptionResult> {
    const serverUrl = this.config.server.url;

    // Ensure server is ready (auto-start if needed)
    const serverReady = await this._ensureServerReady();
    if (!serverReady) {
      // Check if server is loading
      try {
        const healthResponse = await fetch(`${serverUrl}/health`);
        if (healthResponse.ok) {
          const health = await healthResponse.json();
          if (health.status === 'loading') {
            throw new Error('WHISPER_LOADING: Model is still loading, please wait...');
          }
        }
      } catch (e) {
        if ((e as Error).message.startsWith('WHISPER_LOADING:')) {
          throw e;
        }
      }
      throw new Error(`Whisper server could not be started at ${serverUrl}`);
    }

    // Create form data with audio file using Node.js native File API
    const formData = new FormData();

    // Create a File object for the audio (required for FastAPI UploadFile)
    const file = new File([audioBuffer], `audio.${audioFormat}`, {
      type: `audio/${audioFormat}`
    });
    formData.append('file', file);

    // Make HTTP request to server
    const response = await fetch(`${serverUrl}/transcribe?language=${this.config.language}`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Check if it's a "still loading" error from the server
      if (response.status === 503 && errorText.includes('still loading')) {
        throw new Error('WHISPER_LOADING: Model is still loading, please wait...');
      }
      throw new Error(`Whisper server error (${response.status}): ${errorText}`);
    }

    const result = await response.json() as TranscriptionResult;
    return result;
  }

  /**
   * Transcribe via direct Python CLI (fallback method)
   */
  private async transcribeViaCLI(audioBuffer: Buffer, audioFormat: string): Promise<TranscriptionResult> {
    const venvPython = path.join(ROOT, 'venv', 'bin', 'python3');
    if (!fs.existsSync(venvPython)) {
      throw new Error('Python venv not found. Cannot use CLI mode.');
    }

    // Save audio buffer to temp file
    const cacheDir = path.join(ROOT, 'out', 'voice-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const tempAudioFile = path.join(cacheDir, `stt_${Date.now()}.${audioFormat}`);
    fs.writeFileSync(tempAudioFile, audioBuffer);

    try {
      // Adjust compute type for GPU
      let computeType = this.config.computeType;
      if (this.config.device === 'cuda' && computeType === 'int8') {
        computeType = 'float16';
      }

      // Call Python script to run Whisper transcription
      const pythonScript = `
from faster_whisper import WhisperModel
import sys
import json

model = WhisperModel('${this.config.model}', device='${this.config.device}', compute_type='${computeType}')
segments, info = model.transcribe(r'${tempAudioFile.replace(/\\/g, '\\\\')}', language='${this.config.language}')

result = {
  'text': ' '.join([segment.text.strip() for segment in segments]),
  'language': info.language,
  'language_probability': info.language_probability
}

print(json.dumps(result))
`;

      const result = await new Promise<string>((resolve, reject) => {
        const proc = spawn(venvPython, ['-c', pythonScript], {
          cwd: ROOT,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`Whisper process exited with code ${code}: ${stderr}`));
          } else {
            resolve(stdout.trim());
          }
        });

        proc.on('error', (err) => {
          reject(err);
        });
      });

      // Parse result
      const parsed = JSON.parse(result) as TranscriptionResult;

      // Clean up temp file
      try {
        fs.unlinkSync(tempAudioFile);
      } catch {}

      return parsed;
    } catch (error) {
      // Clean up temp file on error
      try {
        fs.unlinkSync(tempAudioFile);
      } catch {}
      throw error;
    }
  }

  /**
   * Check if Whisper server is healthy
   */
  private async checkServerHealth(serverUrl: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`${serverUrl}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return false;
      }

      // Check if model is ready (not just loading)
      const health = await response.json();
      return health.status === 'ready';
    } catch {
      return false;
    }
  }

  /**
   * Get service status
   */
  async getStatus(): Promise<{
    provider: string;
    available: boolean;
    model: string;
    device: string;
    computeType: string;
    serverUrl?: string;
    serverAvailable?: boolean;
    error?: string;
  }> {
    const whisperDir = path.join(ROOT, 'external', 'whisper');
    const pythonBin = path.join(ROOT, 'venv', 'bin', 'python3');
    const installed = fs.existsSync(pythonBin);

    let serverAvailable = false;
    if (this.config.server.useServer) {
      serverAvailable = await this.checkServerHealth(this.config.server.url);
    }

    return {
      provider: 'whisper',
      available: installed && (serverAvailable || !this.config.server.useServer),
      model: this.config.model,
      device: this.config.device,
      computeType: this.config.computeType,
      serverUrl: this.config.server.useServer ? this.config.server.url : undefined,
      serverAvailable,
      error: !installed ? 'Python venv not found. Run: pnpm install' : undefined,
    };
  }

  /**
   * Ensure Whisper server is ready, auto-starting if necessary
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
      this.serverStartPromise = this._startWhisperServerProcess()
        .catch((error) => {
          console.error('[WhisperService] Auto-start server failed:', error);
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
   * Start Whisper FastAPI server as a detached background process
   */
  private async _startWhisperServerProcess(): Promise<boolean> {
    const autoStart = this.config.server.autoStart ?? false;
    if (!autoStart) {
      return false;
    }

    const whisperDir = path.join(ROOT, 'external', 'whisper');
    const pythonBin = path.join(ROOT, 'venv', 'bin', 'python3');
    const serverScript = path.join(whisperDir, 'whisper_server.py');

    // Validate required files exist
    if (!fs.existsSync(pythonBin)) {
      console.warn('[WhisperService] Cannot auto-start: Python venv not found');
      return false;
    }
    if (!fs.existsSync(serverScript)) {
      console.warn('[WhisperService] Cannot auto-start: whisper_server.py not found');
      return false;
    }

    const port = this.config.server.port || 9883;
    const logDir = path.join(ROOT, 'logs', 'run');
    const logFile = path.join(logDir, 'whisper-server.log');
    const pidFile = path.join(logDir, 'whisper-server.pid');

    try {
      // Ensure log directory exists
      fs.mkdirSync(logDir, { recursive: true });
      const logFd = fs.openSync(logFile, 'a');

      // Adjust compute type for GPU
      let computeType = this.config.computeType;
      if (this.config.device === 'cuda' && computeType === 'int8') {
        computeType = 'float16';
      }

      // Spawn server as detached background process
      const args = [
        serverScript,
        '--model', this.config.model,
        '--device', this.config.device,
        '--compute-type', computeType,
        '--port', port.toString(),
      ];

      const child = spawn(pythonBin, args, {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        cwd: ROOT,
      });

      // Save PID for later management
      fs.writeFileSync(pidFile, child.pid!.toString());

      // Unref so parent can exit
      child.unref();

      console.log(`[WhisperService] Started server (PID ${child.pid}) on port ${port}`);

      // Wait for server to respond (not necessarily model loaded - max 10 seconds)
      const maxWaitMs = 10000;
      const startWaitTime = Date.now();
      while (Date.now() - startWaitTime < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Check if server is responding (any status is fine - loading, ready, or error)
        try {
          const response = await fetch(`${this.config.server.url}/health`, {
            signal: AbortSignal.timeout(2000)
          });

          if (response.ok) {
            const health = await response.json();
            console.log(`[WhisperService] Server responding with status: ${health.status}`);
            return true; // Server is up, even if model still loading
          }
        } catch {
          // Server not responding yet, continue waiting
        }
      }

      console.warn('[WhisperService] Server failed to respond within 10 seconds');
      return false;
    } catch (error) {
      console.error('[WhisperService] Failed to start server:', error);
      return false;
    }
  }

  /**
   * Stop the Whisper server
   */
  async stopServer(): Promise<void> {
    const pidFile = path.join(ROOT, 'logs', 'run', 'whisper-server.pid');
    if (!fs.existsSync(pidFile)) {
      return;
    }

    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      process.kill(pid, 'SIGTERM');
      fs.unlinkSync(pidFile);
      console.log(`[WhisperService] Stopped server (PID ${pid})`);
    } catch (error) {
      console.error('[WhisperService] Failed to stop server:', error);
    }
  }
}
