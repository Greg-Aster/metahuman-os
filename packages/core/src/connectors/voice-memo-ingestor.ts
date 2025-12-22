/**
 * Voice Memo Ingestor Connector
 *
 * Ingests voice memos and audio files into the memory system.
 * Uses whisper.cpp for transcription.
 *
 * Part of Phase 3: Massive Greg-Centric Grounding
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';
import { getProfilePaths } from '../paths.js';
import { audit } from '../audit.js';
import { captureEvent } from '../memory.js';
import { transcribe, isWhisperCppAvailable, type TranscriptionResult } from '../transcription.js';

// ============================================================================
// Types
// ============================================================================

export interface AudioMetadata {
  filename: string;
  filepath: string;
  fileSize: number;
  format: string;
  duration?: number; // seconds
  sampleRate?: number;
  channels?: number;
  bitrate?: number;
  createdAt?: string;
  modifiedAt?: string;
}

export interface VoiceMemoIngestionResult {
  success: boolean;
  filepath: string;
  memoryId?: string;
  metadata?: AudioMetadata;
  transcription?: string;
  transcriptionPreview?: string;
  error?: string;
}

export interface VoiceMemoIngestionOptions {
  /** Copy audio to profile's media directory */
  copyToProfile?: boolean;
  /** Additional tags to add */
  additionalTags?: string[];
  /** Source context (e.g., "phone recording", "meeting") */
  source?: string;
  /** Language hint for transcription */
  language?: string;
  /** Skip transcription (just store metadata) */
  skipTranscription?: boolean;
  /** Maximum transcription length to store */
  maxTranscriptionLength?: number;
}

// ============================================================================
// Audio Format Detection
// ============================================================================

const SUPPORTED_FORMATS: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.webm': 'audio/webm',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma',
  '.aiff': 'audio/aiff',
  '.3gp': 'audio/3gpp',
};

const SUPPORTED_EXTENSIONS = Object.keys(SUPPORTED_FORMATS);

function isSupported(ext: string): boolean {
  return SUPPORTED_EXTENSIONS.includes(ext.toLowerCase());
}

function getMimeType(ext: string): string {
  return SUPPORTED_FORMATS[ext.toLowerCase()] || 'audio/unknown';
}

// ============================================================================
// Audio Metadata Extraction
// ============================================================================

/**
 * Extract audio metadata using ffprobe if available.
 */
function extractAudioMetadataWithFfprobe(filepath: string): Partial<AudioMetadata> {
  try {
    // Check if ffprobe is available
    const checkResult = spawnSync('ffprobe', ['-version'], { stdio: 'ignore' });
    if (checkResult.status !== 0) {
      return {};
    }

    const result = spawnSync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filepath,
    ], { encoding: 'utf-8' });

    if (result.status !== 0 || !result.stdout) {
      return {};
    }

    const data = JSON.parse(result.stdout);
    const format = data.format || {};
    const audioStream = data.streams?.find((s: any) => s.codec_type === 'audio');

    return {
      duration: format.duration ? parseFloat(format.duration) : undefined,
      bitrate: format.bit_rate ? parseInt(format.bit_rate) : undefined,
      sampleRate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate) : undefined,
      channels: audioStream?.channels,
    };
  } catch {
    return {};
  }
}

/**
 * Extract basic metadata from audio file.
 */
export async function extractAudioMetadata(filepath: string): Promise<AudioMetadata> {
  const stats = fs.statSync(filepath);
  const filename = path.basename(filepath);
  const ext = path.extname(filepath).toLowerCase();

  if (!isSupported(ext)) {
    throw new Error(`Unsupported audio format: ${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
  }

  // Get ffprobe metadata if available
  const ffprobeData = extractAudioMetadataWithFfprobe(filepath);

  return {
    filename,
    filepath,
    fileSize: stats.size,
    format: getMimeType(ext),
    duration: ffprobeData.duration,
    sampleRate: ffprobeData.sampleRate,
    channels: ffprobeData.channels,
    bitrate: ffprobeData.bitrate,
    createdAt: stats.birthtime.toISOString(),
    modifiedAt: stats.mtime.toISOString(),
  };
}

// ============================================================================
// Transcription
// ============================================================================

/**
 * Transcribe an audio file.
 */
async function transcribeAudioFile(
  filepath: string,
  options: VoiceMemoIngestionOptions
): Promise<TranscriptionResult> {
  return transcribe(filepath, {
    language: options.language || 'en',
  });
}

// ============================================================================
// Memory Integration
// ============================================================================

/**
 * Generate tags from audio metadata.
 */
function generateTagsFromMetadata(metadata: AudioMetadata, hasTranscription: boolean): string[] {
  const tags: string[] = ['voice-memo', 'audio'];

  // Format tag
  const ext = path.extname(metadata.filename).toLowerCase().replace('.', '');
  tags.push(ext);

  // Duration category
  if (metadata.duration) {
    if (metadata.duration < 60) {
      tags.push('short-clip');
    } else if (metadata.duration < 300) {
      tags.push('medium-recording');
    } else {
      tags.push('long-recording');
    }
  }

  // File size category
  if (metadata.fileSize > 50 * 1024 * 1024) {
    tags.push('large-file');
  }

  if (hasTranscription) {
    tags.push('transcribed');
  }

  return [...new Set(tags)];
}

/**
 * Format duration as human-readable string.
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) {
    return `${secs}s`;
  }
  return `${mins}m ${secs}s`;
}

/**
 * Generate content description for the memory.
 */
function generateContentFromVoiceMemo(
  metadata: AudioMetadata,
  transcription: string | null,
  options?: VoiceMemoIngestionOptions
): string {
  const parts: string[] = [];

  parts.push(`Voice Memo: ${metadata.filename}`);

  if (metadata.duration) {
    parts.push(`Duration: ${formatDuration(metadata.duration)}`);
  }

  if (metadata.createdAt) {
    const date = new Date(metadata.createdAt);
    parts.push(`Recorded: ${date.toLocaleDateString()} ${date.toLocaleTimeString()}`);
  }

  if (options?.source) {
    parts.push(`Source: ${options.source}`);
  }

  parts.push(''); // Empty line before transcription

  if (transcription) {
    const maxLength = options?.maxTranscriptionLength ?? 50000;
    if (transcription.length > maxLength) {
      parts.push('Transcription (truncated):');
      parts.push(transcription.substring(0, maxLength) + '...[truncated]');
    } else {
      parts.push('Transcription:');
      parts.push(transcription);
    }
  } else {
    parts.push('[No transcription available]');
  }

  return parts.join('\n');
}

// ============================================================================
// Main Ingestion
// ============================================================================

/**
 * Ingest a single voice memo into the memory system.
 */
export async function ingestVoiceMemo(
  filepath: string,
  username: string,
  options?: VoiceMemoIngestionOptions
): Promise<VoiceMemoIngestionResult> {
  const profilePaths = getProfilePaths(username);

  try {
    // Check file exists
    if (!fs.existsSync(filepath)) {
      return {
        success: false,
        filepath,
        error: `File not found: ${filepath}`,
      };
    }

    // Extract metadata
    const metadata = await extractAudioMetadata(filepath);

    // Copy to profile media directory if requested
    let storedPath = filepath;
    if (options?.copyToProfile) {
      const mediaDir = path.join(profilePaths.root, 'media', 'audio');
      if (!fs.existsSync(mediaDir)) {
        fs.mkdirSync(mediaDir, { recursive: true });
      }

      const destFilename = `${Date.now()}-${metadata.filename}`;
      storedPath = path.join(mediaDir, destFilename);
      fs.copyFileSync(filepath, storedPath);
    }

    // Transcribe unless skipped
    let transcription: string | null = null;
    if (!options?.skipTranscription) {
      try {
        const result = await transcribeAudioFile(filepath, options || {});
        transcription = result.text;
      } catch (error) {
        console.warn(`[voice-memo-ingestor] Transcription failed: ${(error as Error).message}`);
        // Continue without transcription
      }
    }

    // Generate content and tags
    const content = generateContentFromVoiceMemo(metadata, transcription, options);
    const tags = [
      ...generateTagsFromMetadata(metadata, !!transcription),
      ...(options?.additionalTags || []),
    ];

    // Create memory event
    const eventId = captureEvent(content, {
      type: 'observation',
      tags,
      metadata: {
        voiceMemo: {
          ...metadata,
          filepath: storedPath, // Override with stored path
          hasTranscription: !!transcription,
        },
        consent: true,
        provenance: 'voice-memo',
        source: options?.source || 'voice-memo-ingestor',
      },
    });

    // Audit the ingestion
    audit({
      category: 'data_change',
      level: 'info',
      event: 'voice_memo_ingested',
      actor: 'voice-memo-ingestor',
      details: {
        filepath,
        storedPath,
        username,
        eventId,
        duration: metadata.duration,
        hasTranscription: !!transcription,
        transcriptionLength: transcription?.length,
      },
    });

    return {
      success: true,
      filepath,
      memoryId: eventId,
      metadata,
      transcription: transcription || undefined,
      transcriptionPreview: transcription?.substring(0, 200),
    };
  } catch (error) {
    audit({
      category: 'system',
      level: 'error',
      event: 'voice_memo_ingestion_failed',
      actor: 'voice-memo-ingestor',
      details: {
        filepath,
        error: (error as Error).message,
      },
    });

    return {
      success: false,
      filepath,
      error: (error as Error).message,
    };
  }
}

/**
 * Ingest multiple voice memos from a directory.
 */
export async function ingestVoiceMemosFromDirectory(
  directory: string,
  username: string,
  options?: VoiceMemoIngestionOptions & { recursive?: boolean }
): Promise<{
  total: number;
  successful: number;
  failed: number;
  results: VoiceMemoIngestionResult[];
}> {
  const results: VoiceMemoIngestionResult[] = [];

  function scanDirectory(dir: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && options?.recursive) {
        files.push(...scanDirectory(fullPath));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (isSupported(ext)) {
          files.push(fullPath);
        }
      }
    }

    return files;
  }

  const audioFiles = scanDirectory(directory);

  for (const filepath of audioFiles) {
    const result = await ingestVoiceMemo(filepath, username, options);
    results.push(result);
  }

  return {
    total: results.length,
    successful: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

/**
 * Check if transcription is available.
 */
export function isTranscriptionAvailable(): boolean {
  return isWhisperCppAvailable();
}

/**
 * Get transcription status information.
 */
export function getTranscriptionStatus(): {
  available: boolean;
  provider: string;
  message: string;
} {
  if (isWhisperCppAvailable()) {
    return {
      available: true,
      provider: 'whisper.cpp',
      message: 'Local transcription available via whisper.cpp',
    };
  }

  return {
    available: false,
    provider: 'none',
    message: 'No transcription backend available. Install whisper.cpp for local transcription.',
  };
}

// ============================================================================
// Export
// ============================================================================

export const voiceMemoIngestor = {
  extractAudioMetadata,
  ingestVoiceMemo,
  ingestVoiceMemosFromDirectory,
  isTranscriptionAvailable,
  getTranscriptionStatus,
  isSupported,
  SUPPORTED_EXTENSIONS,
};
