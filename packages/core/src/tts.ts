/**
 * Text-to-Speech Service (Refactored with Provider Architecture)
 * Supports multiple TTS providers: Piper, GPT-SoVITS
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { paths, getProfilePaths } from './paths.js';
import { getUserContext } from './context.js';
import { audit } from './audit.js';
import { PiperService } from './tts/providers/piper-service.js';
import { SoVITSService } from './tts/providers/gpt-sovits-service.js';
import { RVCService } from './tts/providers/rvc-service.js';
import type { ITextToSpeechService, TTSConfig, CacheConfig, TTSSynthesizeOptions, TTSStatus } from './tts/interface.js';

// Re-export types for external use
export type { TTSConfig, CacheConfig, TTSSynthesizeOptions, TTSStatus };

interface VoiceConfig {
  tts: TTSConfig;
  cache: CacheConfig;
  [key: string]: any;
}

let config: VoiceConfig | null = null;
// NOTE: Provider caching disabled for multi-user support
// Services must be created fresh each time to respect per-user path resolution

/**
 * Load voice configuration from etc/voice.json (global config)
 * Returns raw config with unresolved template variables
 * Path resolution happens at service creation time based on user context
 */
function loadRawConfig(forceReload = false): VoiceConfig {
  if (config && !forceReload) return config;

  const configPath = path.join(paths.etc, 'voice.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Voice configuration not found at etc/voice.json');
  }

  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  return config!;
}

/**
 * Load user-specific voice configuration with fallback to global config
 * User config at profiles/{username}/etc/voice.json overrides global config settings
 *
 * @param username - Username to load config for (optional)
 * @returns Merged config with user-specific overrides
 */
function loadUserConfig(username?: string): VoiceConfig {
  // Always start with global config as base
  const globalConfig = loadRawConfig();

  // If no username, return global config
  if (!username || username === 'anonymous') {
    return globalConfig;
  }

  // Check for user-specific config
  const userConfigPath = getProfilePaths(username).voiceConfig;
  if (!fs.existsSync(userConfigPath)) {
    // No user config, use global
    return globalConfig;
  }

  try {
    const userConfig = JSON.parse(fs.readFileSync(userConfigPath, 'utf-8'));

    // Merge configs: user config takes precedence for provider and settings
    const merged: VoiceConfig = JSON.parse(JSON.stringify(globalConfig));

    // Override provider if user has set one
    if (userConfig.tts?.provider) {
      merged.tts.provider = userConfig.tts.provider;
    }

    // Merge provider-specific settings
    if (userConfig.tts?.piper) {
      merged.tts.piper = { ...merged.tts.piper, ...userConfig.tts.piper };
    }
    if (userConfig.tts?.sovits) {
      merged.tts.sovits = { ...merged.tts.sovits, ...userConfig.tts.sovits };
    }
    if (userConfig.tts?.rvc) {
      merged.tts.rvc = { ...merged.tts.rvc, ...userConfig.tts.rvc };
    }

    // Merge cache settings
    if (userConfig.cache) {
      merged.cache = { ...merged.cache, ...userConfig.cache };
    }

    console.log('[TTS] Loaded user-specific config for', username, '- provider:', merged.tts.provider);

    return merged;
  } catch (error) {
    console.warn('[TTS] Failed to load user config, falling back to global:', error);
    return globalConfig;
  }
}

/**
 * Resolve template variables in configuration paths
 * Handles {METAHUMAN_ROOT} and {PROFILE_DIR} based on user context
 */
function resolveConfigPaths(rawConfig: VoiceConfig, username?: string): VoiceConfig {
  // Clone config to avoid mutating cached version
  const resolved = JSON.parse(JSON.stringify(rawConfig));

  // Get user context for profile-aware path resolution
  const userContext = getUserContext();
  const activeUsername = username || userContext?.username;

  console.log('[TTS] resolveConfigPaths:', { username, userContext, activeUsername });

  // Resolve template variables in paths
  const resolvePath = (maybePath: string | undefined): string | undefined => {
    if (!maybePath) return maybePath;

    // Replace {METAHUMAN_ROOT} with actual root path
    let resolvedPath = maybePath.replace(/\{METAHUMAN_ROOT\}/g, paths.root);

    // Replace {PROFILE_DIR} with user-specific profile directory
    if (resolvedPath.includes('{PROFILE_DIR}')) {
      if (activeUsername) {
        const profilePaths = getProfilePaths(activeUsername);
        resolvedPath = resolvedPath.replace(/\{PROFILE_DIR\}/g, profilePaths.root);
      } else {
        // Fallback: use global out directory if no user context
        resolvedPath = resolvedPath.replace(/\{PROFILE_DIR\}/g, path.join(paths.root, 'out'));
      }
    }

    // Convert relative paths to absolute
    if (!path.isAbsolute(resolvedPath)) {
      resolvedPath = path.resolve(paths.root, resolvedPath);
    }

    return resolvedPath;
  };

  // Resolve Piper paths
  if (resolved.tts?.piper) {
    resolved.tts.piper.binary = resolvePath(resolved.tts.piper.binary)!;
    resolved.tts.piper.model = resolvePath(resolved.tts.piper.model)!;
    resolved.tts.piper.config = resolved.tts.piper.config ? resolvePath(resolved.tts.piper.config)! : '';
  }

  // Resolve SoVITS paths
  if (resolved.tts?.sovits) {
    resolved.tts.sovits.referenceAudioDir = resolvePath(resolved.tts.sovits.referenceAudioDir)!;
  }

  // Resolve RVC paths
  if (resolved.tts?.rvc) {
    resolved.tts.rvc.referenceAudioDir = resolvePath(resolved.tts.rvc.referenceAudioDir)!;
    resolved.tts.rvc.modelsDir = resolvePath(resolved.tts.rvc.modelsDir)!;
  }

  // Resolve cache path
  if (resolved.cache) {
    resolved.cache.directory = resolvePath(resolved.cache.directory)!;
  }

  return resolved;
}

/**
 * Create TTS service for specified provider
 * Uses current user context for profile-aware path resolution
 */
export function createTTSService(provider?: 'piper' | 'gpt-sovits' | 'rvc', username?: string): ITextToSpeechService {
  // Get user context if not explicitly provided
  const userContext = getUserContext();
  const activeUsername = username || userContext?.username || 'anonymous';

  // Load user-specific config (with fallback to global) and resolve paths
  const rawConfig = loadUserConfig(activeUsername);
  const cfg = resolveConfigPaths(rawConfig, activeUsername);
  const selectedProvider = provider || cfg.tts.provider;

  console.log('[TTS] createTTSService:', {
    selectedProvider,
    activeUsername,
    rvcConfig: cfg.tts.rvc,
    sovitsReferenceAudioDir: cfg.tts.sovits?.referenceAudioDir,
    rvcReferenceAudioDir: cfg.tts.rvc?.referenceAudioDir,
    rvcModelsDir: cfg.tts.rvc?.modelsDir
  });

  // Always create fresh service (no caching) to ensure per-user paths are respected
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
  } else if (selectedProvider === 'rvc') {
    // Check if RVC config exists
    if (!cfg.tts.rvc) {
      console.error('[TTS] RVC config missing. Config keys:', Object.keys(cfg.tts));
      throw new Error('RVC not configured. Please install the addon via System Settings.');
    }

    // RVC requires Piper for base audio generation
    if (!cfg.tts.piper) {
      throw new Error('RVC requires Piper TTS. Please check voice.json configuration.');
    }

    const piperService = new PiperService(cfg.tts.piper, cfg.cache);
    service = new RVCService(cfg.tts.rvc, cfg.cache, piperService);
  } else {
    // Default to Piper
    if (!cfg.tts.piper) {
      throw new Error('Piper TTS not configured. Please check voice.json configuration.');
    }
    service = new PiperService(cfg.tts.piper, cfg.cache);
  }

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
  options?: TTSSynthesizeOptions & { provider?: 'piper' | 'gpt-sovits' | 'rvc'; username?: string }
): Promise<Buffer> {
  const { provider, username, ...synthesizeOptions } = options || {};

  // Always reload config to ensure fresh settings from file (clears cache)
  loadRawConfig(true);

  // createTTSService will load user-specific config with fallback to global
  const service = createTTSService(provider, username);
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
  options?: TTSSynthesizeOptions & { provider?: 'piper' | 'gpt-sovits' | 'rvc' }
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
