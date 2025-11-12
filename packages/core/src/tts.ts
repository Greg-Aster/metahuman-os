/**
 * Text-to-Speech Service (Refactored with Provider Architecture)
 * Supports multiple TTS providers: Piper, GPT-SoVITS
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { paths } from './paths.js';
import { audit } from './audit.js';
import { PiperService } from './tts/providers/piper-service.js';
import { SoVITSService } from './tts/providers/gpt-sovits-service.js';
import type { ITextToSpeechService, TTSConfig, CacheConfig, TTSSynthesizeOptions, TTSStatus } from './tts/interface.js';

// Re-export types for external use
export type { TTSConfig, CacheConfig, TTSSynthesizeOptions, TTSStatus };

interface VoiceConfig {
  tts: TTSConfig;
  cache: CacheConfig;
  [key: string]: any;
}

let config: VoiceConfig | null = null;
let cachedProviders: Map<string, ITextToSpeechService> = new Map();

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

    // Convert relative paths to absolute
    if (!path.isAbsolute(resolved)) {
      resolved = path.resolve(paths.root, resolved);
    }

    return resolved;
  };

  // Resolve Piper paths
  if (config.tts?.piper) {
    config.tts.piper.binary = resolvePath(config.tts.piper.binary)!;
    config.tts.piper.model = resolvePath(config.tts.piper.model)!;
    config.tts.piper.config = config.tts.piper.config ? resolvePath(config.tts.piper.config)! : '';
  }

  // Resolve SoVITS paths
  if (config.tts?.sovits) {
    config.tts.sovits.referenceAudioDir = resolvePath(config.tts.sovits.referenceAudioDir)!;
  }

  // Resolve cache path
  if (config.cache) {
    config.cache.directory = resolvePath(config.cache.directory)!;
  }

  // Clear cached providers when config reloads
  if (forceReload) {
    cachedProviders.clear();
  }

  return config!;
}

/**
 * Create TTS service for specified provider
 */
export function createTTSService(provider?: 'piper' | 'gpt-sovits'): ITextToSpeechService {
  const cfg = loadConfig();
  const selectedProvider = provider || cfg.tts.provider;

  // Return cached provider if available
  const cached = cachedProviders.get(selectedProvider);
  if (cached) return cached;

  let service: ITextToSpeechService;

  if (selectedProvider === 'gpt-sovits') {
    // Check if sovits config exists
    if (!cfg.tts.sovits) {
      console.error('[TTS] GPT-SoVITS config missing. Config keys:', Object.keys(cfg.tts));
      throw new Error('GPT-SoVITS not configured. Please install the addon via System Settings.');
    }

    // Create Piper fallback if auto-fallback is enabled
    const piperService = cfg.tts.sovits.autoFallbackToPiper && cfg.tts.piper
      ? new PiperService(cfg.tts.piper, cfg.cache)
      : undefined;

    service = new SoVITSService(cfg.tts.sovits, cfg.cache, piperService);
  } else {
    // Default to Piper
    if (!cfg.tts.piper) {
      throw new Error('Piper TTS not configured. Please check voice.json configuration.');
    }
    service = new PiperService(cfg.tts.piper, cfg.cache);
  }

  cachedProviders.set(selectedProvider, service);
  return service;
}

/**
 * Generate speech from text using configured or specified provider
 *
 * @param text - The text to convert to speech
 * @param options - Optional parameters including provider override
 */
export async function generateSpeech(
  text: string,
  options?: TTSSynthesizeOptions & { provider?: 'piper' | 'gpt-sovits' }
): Promise<Buffer> {
  const { provider, ...synthesizeOptions } = options || {};

  // Always reload config to ensure fresh settings from file
  loadConfig(true);

  const service = createTTSService(provider);
  return service.synthesize(text, synthesizeOptions);
}

/**
 * Get TTS status and configuration
 */
export async function getTTSStatus(provider?: 'piper' | 'gpt-sovits'): Promise<TTSStatus> {
  const service = createTTSService(provider);
  return await service.getStatus();
}

/**
 * Clear TTS cache
 */
export function clearTTSCache(provider?: 'piper' | 'gpt-sovits'): void {
  const service = createTTSService(provider);
  if (service.clearCache) {
    service.clearCache();
  }
}

/**
 * Generate speech with demonic dual-voice effect (Mutant Super Intelligence)
 * Uses pitch-shifting and mixing for creepy dual-voice effect
 *
 * @param text - The text to convert to speech
 * @param voiceModels - Array of voice model paths (for Piper only)
 * @param options - Optional parameters
 */
export async function generateMultiVoiceSpeech(
  text: string,
  voiceModels: string[],
  options?: TTSSynthesizeOptions & { provider?: 'piper' | 'gpt-sovits' }
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
      effect: 'demonic_dual_voice',
    },
    actor: 'system',
  });

  try {
    // Generate speech with the same voice
    const originalVoice = await generateSpeech(text, {
      ...options,
      voice: voiceModels[0],
      provider: options?.provider || 'piper' // Multi-voice only works with Piper for now
    });

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
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=sample_rate',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        inputFile,
      ]);

      let output = '';
      ffprobe.stdout.on('data', (data) => {
        output += data.toString();
      });
      ffprobe.on('close', (code) => {
        if (code === 0) resolve(parseInt(output.trim(), 10));
        else reject(new Error(`ffprobe failed with code ${code}`));
      });
      ffprobe.on('error', reject);
    });

    // Use ffmpeg to pitch-shift
    const pitchRatio = Math.pow(2, semitones / 12);

    // atempo filter has constraints: values must be between 0.5 and 2.0
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

    const newSampleRate = Math.round(sampleRate * pitchRatio);
    const audioFilter = `asetrate=${newSampleRate},${atempoFilters.join(',')}`;

    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i',
        inputFile,
        '-af',
        audioFilter,
        '-ar',
        sampleRate.toString(),
        '-y',
        outputFile,
      ]);

      let stderr = '';
      ffmpeg.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg pitch-shift failed (code ${code}): ${stderr}`));
      });

      ffmpeg.on('error', reject);
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
  const dataLengths = buffers.map((b) => b.length - headerSize);
  const minDataLength = Math.min(...dataLengths);

  // Mix the audio data (16-bit PCM samples)
  const mixedData = Buffer.alloc(minDataLength);

  for (let i = 0; i < minDataLength; i += 2) {
    // Read 16-bit samples from each buffer
    const samples = buffers.map((buf) => buf.readInt16LE(headerSize + i));

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
  result.writeUInt32LE(dataSize + 36, 4); // File size - 8
  result.writeUInt32LE(dataSize, 40); // Data chunk size

  return result;
}
