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

  const configPath = path.join(paths.etc, 'voice.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Voice configuration not found at etc/voice.json');
  }

  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  // Resolve template variables in paths
  const resolvePath = (maybePath: string | undefined): string | undefined => {
    if (!maybePath) return maybePath;

    // Replace {METAHUMAN_ROOT} with actual root path
    let resolved = maybePath.replace(/\{METAHUMAN_ROOT\}/g, paths.root);

    // Replace {HOME} with user's home directory (if needed in future)
    // resolved = resolved.replace(/\{HOME\}/g, process.env.HOME || os.homedir());

    // Convert relative paths to absolute
    if (!path.isAbsolute(resolved)) {
      resolved = path.resolve(paths.root, resolved);
    }

    return resolved;
  };

  if (config.tts?.provider === 'piper') {
    config.tts.piper.binary = resolvePath(config.tts.piper.binary)!;
    config.tts.piper.model = resolvePath(config.tts.piper.model)!;
    config.tts.piper.config = config.tts.piper.config ? resolvePath(config.tts.piper.config)! : '';
  }

  if (config.cache) {
    config.cache.directory = resolvePath(config.cache.directory)!;
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

  // Check cache first
  const cached = getCachedAudio(text, modelPath, speakingRate);
  if (cached) {
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

/**
 * Generate speech with demonic dual-voice effect (Mutant Super Intelligence)
 * Uses Amy (female) and Joe (male) voices mixed together for creepy dual-voice effect
 *
 * @param text - The text to convert to speech
 * @param voiceModels - Array of voice model paths (uses Amy + Joe)
 * @param options - Optional parameters
 */
export async function generateMultiVoiceSpeech(
  text: string,
  voiceModels: string[],
  options?: {
    signal?: globalThis.AbortSignal;
    speakingRate?: number;
  }
): Promise<Buffer> {
  if (voiceModels.length === 0) {
    throw new Error('At least one voice model is required');
  }

  const startTime = Date.now();

  audit({
    level: 'info',
    category: 'action',
    event: 'multi_voice_tts_started',
    details: {
      textLength: text.length,
      models: voiceModels.slice(0, 2),
      effect: 'demonic_dual_voice'
    },
    actor: 'system',
  });

  try {
    // Generate speech with the same voice (Amy)
    const originalVoice = await generateSpeech(text, { ...options, model: voiceModels[0] });

    // Create a pitch-shifted copy (-5 semitones = slightly deeper/demonic)
    const pitchShiftedVoice = await pitchShiftAudio(originalVoice, -5);

    // Mix the original and pitch-shifted voices together
    const mixedAudio = mixWAVBuffers([originalVoice, pitchShiftedVoice]);

    const duration = Date.now() - startTime;

    audit({
      level: 'info',
      category: 'action',
      event: 'multi_voice_tts_completed',
      details: {
        textLength: text.length,
        effect: 'demonic_dual_voice',
        voiceCount: 2,
        pitchShift: -5,
        audioSize: mixedAudio.length,
        durationMs: duration,
      },
      actor: 'system',
    });

    return mixedAudio;
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'multi_voice_tts_failed',
      details: { error: (error as Error).message, textLength: text.length },
      actor: 'system',
    });
    throw error;
  }
}

/**
 * Pitch-shift audio using ffmpeg
 * @param audioBuffer - Input WAV audio buffer
 * @param semitones - Number of semitones to shift (negative = lower, positive = higher)
 * @returns Pitch-shifted WAV audio buffer
 */
async function pitchShiftAudio(audioBuffer: Buffer, semitones: number): Promise<Buffer> {
  const { spawn } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { unlink, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const tmpPath = await import('node:path');

  // Create temp files
  const tempDir = tmpdir();
  const inputFile = tmpPath.join(tempDir, `tts-input-${Date.now()}.wav`);
  const outputFile = tmpPath.join(tempDir, `tts-output-${Date.now()}.wav`);

  try {
    // Write input buffer to temp file
    await writeFile(inputFile, audioBuffer);

    // Detect the actual sample rate from the input file
    const sampleRate = await new Promise<number>((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'error',
        '-select_streams', 'a:0',
        '-show_entries', 'stream=sample_rate',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        inputFile
      ]);

      let output = '';
      ffprobe.stdout.on('data', (data) => { output += data.toString(); });
      ffprobe.on('close', (code) => {
        if (code === 0) resolve(parseInt(output.trim(), 10));
        else reject(new Error(`ffprobe failed with code ${code}`));
      });
      ffprobe.on('error', reject);
    });

    // Use ffmpeg to pitch-shift
    // asetrate increases sample rate (pitch up), atempo compensates duration
    // For pitch down, we do the inverse
    const pitchRatio = Math.pow(2, semitones / 12);

    // atempo filter has constraints: values must be between 0.5 and 2.0
    // If outside this range, we need to chain multiple atempo filters
    let tempoFactor = 1 / pitchRatio;
    const atempoFilters: string[] = [];

    while (tempoFactor < 0.5) {
      atempoFilters.push('atempo=0.5');
      tempoFactor *= 2;
    }
    while (tempoFactor > 2.0) {
      atempoFilters.push('atempo=2.0');
      tempoFactor /= 2;
    }

    atempoFilters.push(`atempo=${tempoFactor}`);

    // Calculate the new sample rate (asetrate expects a plain number, not an expression)
    const newSampleRate = Math.round(sampleRate * pitchRatio);
    const audioFilter = `asetrate=${newSampleRate},${atempoFilters.join(',')}`;

    console.log(`[pitch-shift] Shifting by ${semitones} semitones: ${sampleRate}Hz -> ${newSampleRate}Hz, tempo ${tempoFactor.toFixed(3)}`);
    console.log(`[pitch-shift] Filter: ${audioFilter}`);

    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', inputFile,
        '-af', audioFilter,
        '-ar', sampleRate.toString(), // Resample back to original rate
        '-y', // Overwrite output
        outputFile
      ]);

      let stderr = '';
      let stdout = '';
      ffmpeg.stderr?.on('data', (data) => { stderr += data.toString(); });
      ffmpeg.stdout?.on('data', (data) => { stdout += data.toString(); });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          console.log(`[pitch-shift] Success`);
          resolve();
        } else {
          console.error(`[pitch-shift] Failed with code ${code}`);
          console.error(`[pitch-shift] stderr:`, stderr);
          console.error(`[pitch-shift] stdout:`, stdout);
          reject(new Error(`ffmpeg pitch-shift failed (code ${code}): ${stderr}`));
        }
      });

      ffmpeg.on('error', (err) => {
        console.error(`[pitch-shift] Process error:`, err);
        reject(err);
      });
    });

    // Read the pitch-shifted output
    const { readFile } = await import('node:fs/promises');
    const outputBuffer = await readFile(outputFile);

    // Clean up temp files
    await unlink(inputFile).catch(() => {});
    await unlink(outputFile).catch(() => {});

    return outputBuffer;
  } catch (error) {
    // Clean up on error
    await unlink(inputFile).catch(() => {});
    await unlink(outputFile).catch(() => {});
    throw error;
  }
}

/**
 * Synchronize audio durations by time-stretching shorter audio to match the longest
 * This keeps voices perfectly in sync when mixing
 * @param audioBuffers - Array of WAV audio buffers
 * @returns Array of time-synchronized WAV buffers (same durations)
 */
async function syncAudioDurations(audioBuffers: Buffer[]): Promise<Buffer[]> {
  if (audioBuffers.length === 0) throw new Error('No buffers to sync');
  if (audioBuffers.length === 1) return audioBuffers;

  const { spawn } = await import('node:child_process');
  const { unlink, writeFile, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const tmpPath = await import('node:path');

  // Get actual audio durations using ffprobe
  const durations: number[] = [];

  for (let i = 0; i < audioBuffers.length; i++) {
    const tempDir = tmpdir();
    const probeFile = tmpPath.join(tempDir, `probe-${Date.now()}-${i}.wav`);

    try {
      await writeFile(probeFile, audioBuffers[i]);

      const duration = await new Promise<number>((resolve, reject) => {
        const ffprobe = spawn('ffprobe', [
          '-v', 'error',
          '-show_entries', 'format=duration',
          '-of', 'default=noprint_wrappers=1:nokey=1',
          probeFile
        ]);

        let output = '';
        ffprobe.stdout.on('data', (data) => { output += data.toString(); });
        ffprobe.on('close', (code) => {
          if (code === 0) resolve(parseFloat(output.trim()));
          else reject(new Error(`ffprobe failed with code ${code}`));
        });
        ffprobe.on('error', reject);
      });

      durations.push(duration);
      await unlink(probeFile).catch(() => {});
    } catch (error) {
      await unlink(probeFile).catch(() => {});
      throw error;
    }
  }

  // Find the longest duration
  const maxDuration = Math.max(...durations);

  // Time-stretch each buffer to match the longest
  const syncedBuffers: Buffer[] = [];

  for (let i = 0; i < audioBuffers.length; i++) {
    const buffer = audioBuffers[i];
    const duration = durations[i];

    // If this buffer is already the longest (within 0.01s tolerance), no stretching needed
    if (Math.abs(duration - maxDuration) < 0.01) {
      syncedBuffers.push(buffer);
      continue;
    }

    // Calculate tempo factor based on actual duration
    let tempoFactor = duration / maxDuration; // < 1.0 means slow down (stretch)

    // atempo filter has constraints: values must be between 0.5 and 2.0
    // If outside this range, we need to chain multiple atempo filters
    const atempoFilters: string[] = [];

    while (tempoFactor < 0.5) {
      atempoFilters.push('atempo=0.5');
      tempoFactor *= 2;
    }
    while (tempoFactor > 2.0) {
      atempoFilters.push('atempo=2.0');
      tempoFactor /= 2;
    }

    // Add the final tempo adjustment
    atempoFilters.push(`atempo=${tempoFactor}`);

    const audioFilter = atempoFilters.join(',');

    // Use ffmpeg to time-stretch without changing pitch
    const tempDir = tmpdir();
    const inputFile = tmpPath.join(tempDir, `sync-input-${Date.now()}-${i}.wav`);
    const outputFile = tmpPath.join(tempDir, `sync-output-${Date.now()}-${i}.wav`);

    try {
      await writeFile(inputFile, buffer);

      await new Promise<void>((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
          '-i', inputFile,
          '-af', audioFilter,
          '-ar', '22050', // Piper default sample rate
          '-y',
          outputFile
        ]);

        let stderr = '';
        ffmpeg.stderr?.on('data', (data) => { stderr += data.toString(); });

        ffmpeg.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`ffmpeg sync failed (code ${code}): ${stderr}`));
        });

        ffmpeg.on('error', reject);
      });

      const syncedBuffer = await readFile(outputFile);
      syncedBuffers.push(syncedBuffer);

      // Clean up
      await unlink(inputFile).catch(() => {});
      await unlink(outputFile).catch(() => {});
    } catch (error) {
      // Clean up on error
      await unlink(inputFile).catch(() => {});
      await unlink(outputFile).catch(() => {});
      throw error;
    }
  }

  return syncedBuffers;
}

/**
 * Concatenate multiple WAV audio buffers sequentially
 * Joins multiple WAV files end-to-end for voice switching effect
 */
function concatenateWAVBuffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) throw new Error('No buffers to concatenate');
  if (buffers.length === 1) return buffers[0];

  // WAV file structure: 44-byte header + audio data
  const headerSize = 44;

  // Use the first buffer's header as template
  const header = buffers[0].subarray(0, headerSize);

  // Extract audio data from all buffers and concatenate
  const audioDataChunks: Buffer[] = [];
  let totalDataSize = 0;

  for (const buffer of buffers) {
    const audioData = buffer.subarray(headerSize);
    audioDataChunks.push(audioData);
    totalDataSize += audioData.length;
  }

  // Concatenate all audio data
  const concatenatedData = Buffer.concat(audioDataChunks);

  // Create final buffer with header + concatenated data
  const result = Buffer.concat([header, concatenatedData]);

  // Update the data size in the header
  result.writeUInt32LE(totalDataSize + 36, 4);  // File size - 8
  result.writeUInt32LE(totalDataSize, 40);      // Data chunk size

  return result;
}

/**
 * Mix multiple WAV audio buffers together
 * Averages the samples from multiple WAV files
 */
function mixWAVBuffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) throw new Error('No buffers to mix');
  if (buffers.length === 1) return buffers[0];

  // WAV file structure: 44-byte header + audio data
  const headerSize = 44;

  // Use the first buffer's header as template
  const header = buffers[0].subarray(0, headerSize);

  // Find the shortest audio data length
  const dataLengths = buffers.map(b => b.length - headerSize);
  const minDataLength = Math.min(...dataLengths);

  // Mix the audio data (16-bit PCM samples)
  const mixedData = Buffer.alloc(minDataLength);

  for (let i = 0; i < minDataLength; i += 2) {
    // Read 16-bit samples from each buffer
    const samples = buffers.map(buf =>
      buf.readInt16LE(headerSize + i)
    );

    // Average the samples and clamp to prevent clipping
    const mixed = samples.reduce((sum, s) => sum + s, 0) / samples.length;
    const clamped = Math.max(-32768, Math.min(32767, Math.round(mixed)));

    // Write mixed sample
    mixedData.writeInt16LE(clamped, i);
  }

  // Create final buffer with header + mixed data
  const result = Buffer.concat([header, mixedData]);

  // Update the data size in the header
  const dataSize = mixedData.length;
  result.writeUInt32LE(dataSize + 36, 4);  // File size - 8
  result.writeUInt32LE(dataSize, 40);      // Data chunk size

  return result;
}
