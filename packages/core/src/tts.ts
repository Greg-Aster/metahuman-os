/**
 * Text-to-Speech Service (Refactored with Provider Architecture)
 * Supports multiple TTS providers: Piper, GPT-SoVITS, RVC, Kokoro
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, systemPaths, getProfilePaths } from './path-builder.js';
import { getUserContext } from './context.js';
import { audit } from './audit.js';
import { PiperService } from './tts/providers/piper-service.js';
import { createLogger } from './logger.js';
const log = createLogger('tts');
import { SoVITSService } from './tts/providers/gpt-sovits-service.js';
import { RVCService } from './tts/providers/rvc-service.js';
import { KokoroService } from './tts/providers/kokoro-service.js';
import { KittenService } from './tts/providers/kitten-service.js';
import type { ITextToSpeechService, TTSConfig, CacheConfig, TTSSynthesizeOptions, TTSStatus } from './tts/interface.js';

// Re-export types and utilities for external use
export type { TTSConfig, CacheConfig, TTSSynthesizeOptions, TTSStatus };
export {
  cleanupStalePidFiles,
  getRunningServers,
  getSovitsServerStatus,
  startSovitsServer,
  stopAllServers,
  stopServer,
  stopSovitsServer,
} from './tts/server-manager.js';
export type { SovitsActionResult, SovitsStatus } from './tts/server-manager.js';

interface VoiceConfig {
  tts: TTSConfig;
  cache: CacheConfig;
  [key: string]: any;
}

/** Read an explicitly configured document; absence does not create defaults. */
function readVoiceConfig(configPath: string): Partial<VoiceConfig> | null {
  if (!fs.existsSync(configPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected a configuration object');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid voice configuration at ${configPath}: ${(error as Error).message}`, { cause: error });
  }
}

/**
 * Profile voice preferences own synthesis configuration. Existing installation
 * defaults may supply omitted fields, but a complete profile stands alone.
 * Read fresh for each service so settings changes and profiles stay isolated.
 */
function loadUserConfig(username?: string): VoiceConfig {
  const userContext = getUserContext();
  const userConfigPath = userContext?.profilePaths?.voiceConfig ||
    (username && username !== 'anonymous' ? getProfilePaths(username).voiceConfig : null);
  const globalConfig = readVoiceConfig(path.join(systemPaths.etc, 'voice.json'));
  const userConfig = userConfigPath ? readVoiceConfig(userConfigPath) : null;
  if (!globalConfig && !userConfig) {
    throw new Error('Voice configuration not found. Configure speech in Voice Settings for this profile.');
  }

  const merged = {
    ...globalConfig,
    ...userConfig,
    tts: { ...globalConfig?.tts, ...userConfig?.tts },
    cache: { ...globalConfig?.cache, ...userConfig?.cache },
  } as VoiceConfig;
  for (const provider of ['piper', 'sovits', 'rvc', 'kokoro', 'kitten'] as const) {
    const base = globalConfig?.tts?.[provider];
    const override = userConfig?.tts?.[provider];
    if (base || override) Object.assign(merged.tts, { [provider]: { ...base, ...override } });
  }
  if (!merged.tts.provider || typeof merged.cache.enabled !== 'boolean'
    || typeof merged.cache.directory !== 'string' || !merged.cache.directory) {
    throw new Error('Voice configuration is incomplete. Configure speech and its cache in Voice Settings.');
  }
  return merged;
}

/**
 * Resolve template variables in configuration paths
 * Handles {METAHUMAN_ROOT} and {PROFILE_DIR} based on user context
 */
function resolveConfigPaths(rawConfig: VoiceConfig, username?: string): VoiceConfig {
  // Clone configuration before resolving profile-specific paths
  const resolved = JSON.parse(JSON.stringify(rawConfig));

  // Get user context for profile-aware path resolution
  const userContext = getUserContext();

  log.debug(' resolveConfigPaths:', { username, userContext });

  // Resolve template variables in paths
  // IMPORTANT: Always use getProfilePaths which respects storage router configuration
  const resolvePath = (maybePath: string | undefined): string | undefined => {
    if (!maybePath) return maybePath;

    let resolvedPath = maybePath;

    // FIRST: Detect and fix hardcoded profile paths (legacy configs)
    // Pattern: /path/to/metahuman/profiles/{username}/... should use storage router
    const profilePathMatch = resolvedPath.match(/\/profiles\/([^/]+)\//);
    if (profilePathMatch && username && username !== 'anonymous') {
      // Extract the relative path after profiles/{username}/
      const relativePathMatch = resolvedPath.match(/\/profiles\/[^/]+\/(.+)/);
      if (relativePathMatch) {
        const relativePath = relativePathMatch[1];
        const profilePaths = getProfilePaths(username);
        resolvedPath = path.join(profilePaths.root, relativePath);
        log.debug('Redirected hardcoded profile path to storage router:', {
          original: maybePath,
          resolved: resolvedPath
        });
        return resolvedPath;
      }
    }

    // Replace {METAHUMAN_ROOT} with actual root path
    resolvedPath = resolvedPath.replace(/\{METAHUMAN_ROOT\}/g, ROOT);

    // Replace {PROFILE_DIR} with user-specific profile directory
    // Uses storage router to resolve correct path (internal, external, or encrypted)
    if (resolvedPath.includes('{PROFILE_DIR}')) {
      if (userContext?.profilePaths) {
        // Prioritize context's profilePaths - this handles guests viewing other profiles correctly
        // The context's profilePaths is already resolved to the correct profile (e.g., bitter-greg)
        resolvedPath = resolvedPath.replace(/\{PROFILE_DIR\}/g, userContext.profilePaths.root);
      } else if (username && username !== 'anonymous' && username !== 'guest') {
        // Use getProfilePaths which respects storage router configuration
        // Excludes 'guest' since guests should always have context-provided paths
        const profilePaths = getProfilePaths(username);
        resolvedPath = resolvedPath.replace(/\{PROFILE_DIR\}/g, profilePaths.root);
      } else {
        // SECURITY: No silent fallback - throw error if no user context for profile paths
        // This prevents accidentally writing sensitive data to unencrypted locations
        throw new Error(
          'SECURITY: Cannot resolve {PROFILE_DIR} - no authenticated user context. ' +
          'Voice files require user authentication to ensure proper storage routing.'
        );
      }
    }

    // Convert relative paths to absolute
    if (!path.isAbsolute(resolvedPath)) {
      resolvedPath = path.resolve(ROOT, resolvedPath);
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

  // Resolve Kokoro paths
  if (resolved.tts?.kokoro) {
    resolved.tts.kokoro.customVoicepackPath = resolvePath(resolved.tts.kokoro.customVoicepackPath)!;
  }

  // Resolve cache path (resolvePath handles hardcoded profile paths automatically)
  if (resolved.cache) {
    resolved.cache.directory = resolvePath(resolved.cache.directory)!;
  }

  return resolved;
}

function buildKokoroService(config: VoiceConfig): KokoroService {
  if (!config.tts.kokoro) {
    throw new Error('Kokoro not configured. Please install the addon via System Settings.');
  }
  const piperService = config.tts.kokoro.autoFallbackToPiper && config.tts.piper
    ? new PiperService(config.tts.piper, config.cache)
    : undefined;
  return new KokoroService(config.tts.kokoro, config.cache, piperService);
}

/**
 * Construct the profile-resolved Kokoro owner used by batch, streaming, and
 * robot delivery adapters.
 */
export function createKokoroTTSService(username?: string): KokoroService {
  const userContext = getUserContext();
  const activeUsername = username || userContext?.username || 'anonymous';
  return buildKokoroService(resolveConfigPaths(loadUserConfig(activeUsername), activeUsername));
}

/**
 * Create TTS service for specified provider
 * Uses current user context for profile-aware path resolution
 */
export function createTTSService(provider?: TTSConfig['provider'], username?: string): ITextToSpeechService {
  // Get user context if not explicitly provided
  const userContext = getUserContext();
  const activeUsername = username || userContext?.username || 'anonymous';


  // Load user-specific config (with fallback to global) and resolve paths
  const rawConfig = loadUserConfig(activeUsername);
  const cfg = resolveConfigPaths(rawConfig, activeUsername);
  const selectedProvider = provider || cfg.tts.provider;


  log.debug(' createTTSService:', {
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
  } else if (selectedProvider === 'kokoro') {
    service = buildKokoroService(cfg);
  } else if (selectedProvider === 'kitten') {
    if (!cfg.tts.kitten) throw new Error('Kitten is not configured. Select a voice in Voice Settings.');
    service = new KittenService(cfg.tts.kitten, cfg.cache);
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
  options?: TTSSynthesizeOptions & { provider?: TTSConfig['provider']; username?: string }
): Promise<Buffer> {
  const { provider, username, ...synthesizeOptions } = options || {};

  // The service reads current profile preferences and optional installation defaults
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
