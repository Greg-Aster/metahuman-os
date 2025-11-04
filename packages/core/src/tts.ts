/**
 * Text-to-Speech Service
 * Converts text to audio using Piper TTS
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths } from './paths.js';
import { audit } from './audit.js';

export interface TTSConfig {
  provider: 'piper';
  piper: {
    binary: string;
    model: string;
    config: string;
    speakingRate: number;
    outputFormat: 'wav';
  };
}

export interface CacheConfig {
  enabled: boolean;
  directory: string;
  maxSizeMB: number;
}

interface VoiceConfig {
  tts: TTSConfig;
  cache: CacheConfig;
}

let config: VoiceConfig | null = null;

/**
 * Load voice configuration from etc/voice.json
 */
function loadConfig(forceReload = false): VoiceConfig {
  if (config && !forceReload) return config;

  const configPath = path.join(paths.root, 'etc', 'voice.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Voice configuration not found at etc/voice.json');
  }

  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  const toAbsolute = (maybePath: string | undefined): string | undefined => {
    if (!maybePath) return maybePath;
    return path.isAbsolute(maybePath)
      ? maybePath
      : path.resolve(paths.root, maybePath);
  };

  if (config.tts?.provider === 'piper') {
    config.tts.piper.binary = toAbsolute(config.tts.piper.binary)!;
    config.tts.piper.model = toAbsolute(config.tts.piper.model)!;
    config.tts.piper.config = config.tts.piper.config ? toAbsolute(config.tts.piper.config)! : '';
  }

  if (config.cache) {
    config.cache.directory = toAbsolute(config.cache.directory)!;
  }

  return config!;
}

/**
 * Generate a cache key for text, model, and speaking rate
 */
function getCacheKey(text: string, modelPath: string, speakingRate: number): string {
  const key = `${text}|${modelPath}|${speakingRate}`;
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * Check if cached audio exists for text, model, and speaking rate
 */
function getCachedAudio(text: string, modelPath: string, speakingRate: number): Buffer | null {
  const cfg = loadConfig();
  if (!cfg.cache.enabled) return null;

  const cacheKey = getCacheKey(text, modelPath, speakingRate);
  const cachePath = path.join(cfg.cache.directory, `${cacheKey}.wav`);

  if (fs.existsSync(cachePath)) {
    audit({
      level: 'info',
      category: 'action',
      event: 'tts_cache_hit',
      details: { cacheKey, textLength: text.length, modelPath, speakingRate },
      actor: 'system',
    });
    return fs.readFileSync(cachePath);
  }

  return null;
}

/**
 * Save audio to cache
 */
function cacheAudio(text: string, modelPath: string, speakingRate: number, audioBuffer: Buffer): void {
  const cfg = loadConfig();
  if (!cfg.cache.enabled) return;

  const cacheKey = getCacheKey(text, modelPath, speakingRate);
  const cachePath = path.join(cfg.cache.directory, `${cacheKey}.wav`);

  // Ensure cache directory exists
  if (!fs.existsSync(cfg.cache.directory)) {
    fs.mkdirSync(cfg.cache.directory, { recursive: true });
  }

  fs.writeFileSync(cachePath, audioBuffer);

  audit({
    level: 'info',
    category: 'action',
    event: 'tts_cache_write',
    details: { cacheKey, textLength: text.length, audioSize: audioBuffer.length, modelPath, speakingRate },
    actor: 'system',
  });
}

/**
 * Generate speech from text using Piper
 *
 * @param text - The text to convert to speech
 * @param options - Optional parameters
 * @param options.signal - AbortSignal for cancellation
 * @param options.model - Override voice model path (optional)
 * @param options.config - Override voice config path (optional)
 * @param options.speakingRate - Override speaking rate (optional)
 */
export async function generateSpeech(
  text: string,
  options?: {
    signal?: globalThis.AbortSignal;
    model?: string;
    config?: string;
    speakingRate?: number;
  }
): Promise<Buffer> {
  // Reload config if no overrides provided (ensures fresh settings from file)
  const hasOverrides = !!(options?.model || options?.config || options?.speakingRate !== undefined);
  const cfg = loadConfig(!hasOverrides);

  // Use overrides if provided, otherwise use config
  const modelPath = options?.model || cfg.tts.piper.model;
  const configPath = options?.config || cfg.tts.piper.config;
  const speakingRate = options?.speakingRate ?? cfg.tts.piper.speakingRate;

  console.log('[TTS] =======================================================');
  console.log('[TTS] Using parameters:', {
    modelPath,
    configPath,
    speakingRate,
    overrideModel: options?.model,
    overrideConfig: options?.config,
    overrideRate: options?.speakingRate,
    configFileModel: cfg.tts.piper.model,
    configFileConfig: cfg.tts.piper.config,
    configFileRate: cfg.tts.piper.speakingRate
  });
  console.log('[TTS] =======================================================')

  // Check cache first
  const cached = getCachedAudio(text, modelPath, speakingRate);
  if (cached) {
    console.log('[TTS] Returning cached audio');
    return cached;
  }

  const startTime = Date.now();

  // Validate Piper binary exists
  if (!fs.existsSync(cfg.tts.piper.binary)) {
    throw new Error(`Piper binary not found at ${cfg.tts.piper.binary}`);
  }

  // Validate model exists
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Piper model not found at ${modelPath}`);
  }

  // Generate temp output file
  const tempDir = cfg.cache.directory;
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

    console.log('[TTS] Executing Piper with args:', args);

    const child = spawn(cfg.tts.piper.binary, args, {
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
    cacheAudio(text, modelPath, speakingRate, audioBuffer);

    const duration = Date.now() - startTime;

    audit({
      level: 'info',
      category: 'action',
      event: 'tts_generated',
      details: {
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
      details: { error: (error as Error).message, textLength: text.length },
      actor: 'system',
    });

    throw error;
  }
}

/**
 * Get TTS status and configuration
 */
export function getTTSStatus(): {
  provider: string;
  modelPath: string;
  cacheEnabled: boolean;
  cacheSize: number;
  cacheFiles: number;
} {
  const cfg = loadConfig();

  let cacheSize = 0;
  let cacheFiles = 0;

  if (cfg.cache.enabled && fs.existsSync(cfg.cache.directory)) {
    const files = fs.readdirSync(cfg.cache.directory).filter(f => f.endsWith('.wav'));
    cacheFiles = files.length;

    for (const file of files) {
      const filePath = path.join(cfg.cache.directory, file);
      cacheSize += fs.statSync(filePath).size;
    }
  }

  return {
    provider: cfg.tts.provider,
    modelPath: cfg.tts.piper.model,
    cacheEnabled: cfg.cache.enabled,
    cacheSize: Math.round(cacheSize / (1024 * 1024) * 100) / 100, // MB
    cacheFiles,
  };
}

/**
 * Clear TTS cache
 */
export function clearTTSCache(): void {
  const cfg = loadConfig();

  if (!cfg.cache.enabled || !fs.existsSync(cfg.cache.directory)) {
    return;
  }

  const files = fs.readdirSync(cfg.cache.directory).filter(f => f.endsWith('.wav'));

  for (const file of files) {
    fs.unlinkSync(path.join(cfg.cache.directory, file));
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'tts_cache_cleared',
    details: { filesDeleted: files.length },
    actor: 'system',
  });
}
