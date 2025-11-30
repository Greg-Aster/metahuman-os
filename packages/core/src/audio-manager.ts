/**
 * Audio Manager
 *
 * Centralized service for managing audio files across multiple voice providers.
 * Provides a unified interface for Piper and GPT-SoVITS reference audio management.
 */

import path from 'node:path';
import fs from 'node:fs';
import { paths } from './paths.js';
import {
  listVoiceSamples,
  getReferenceSamples,
  exportSoVITSDataset,
  copyToSoVITS,
  listSoVITSReferences,
  deleteSoVITSReference,
  type VoiceSample
} from './voice-training.js';
import { audit } from './audit.js';

/**
 * Supported voice providers
 */
export type VoiceProvider = 'piper' | 'gpt-sovits';

/**
 * Audio quality validation result
 */
export interface AudioValidation {
  valid: boolean;
  duration?: number;
  sampleRate?: number;
  channels?: number;
  quality?: number;
  issues: string[];
  warnings: string[];
}

/**
 * Copy voice samples to provider-specific reference directory
 *
 * @param sampleIds - Array of sample IDs to copy
 * @param provider - Voice provider (piper or gpt-sovits)
 * @param speakerId - Speaker identifier (default: 'default')
 * @returns Number of samples copied
 */
export function copyToReference(
  sampleIds: string[],
  provider: VoiceProvider,
  speakerId: string = 'default'
): number {
  audit({
    level: 'info',
    category: 'action',
    event: 'audio_copy_to_reference',
    details: {
      provider,
      speakerId,
      sampleCount: sampleIds.length,
    },
    actor: 'system',
  });

  if (provider === 'piper') {
    // Piper: copy to training directory
    const piperTrainingDir = path.join(paths.out, 'piper-training');
    if (!fs.existsSync(piperTrainingDir)) {
      fs.mkdirSync(piperTrainingDir, { recursive: true });
    }

    const samples = listVoiceSamples(1000);
    let copiedCount = 0;

    for (const sampleId of sampleIds) {
      const sample = samples.find(s => s.id === sampleId);
      if (!sample) continue;

      // Copy audio and transcript
      const destWav = path.join(piperTrainingDir, `${sample.id}.wav`);
      const destTxt = path.join(piperTrainingDir, `${sample.id}.txt`);

      if (fs.existsSync(sample.audioPath)) {
        fs.copyFileSync(sample.audioPath, destWav);
        if (fs.existsSync(sample.transcriptPath)) {
          fs.copyFileSync(sample.transcriptPath, destTxt);
        }
        copiedCount++;
      }
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'audio_copy_complete',
      details: {
        provider: 'piper',
        outputDir: piperTrainingDir,
        sampleCount: copiedCount,
      },
      actor: 'system',
    });

    return copiedCount;
  } else if (provider === 'gpt-sovits') {
    // GPT-SoVITS uses reference audio format
    const copiedCount = copyToSoVITS(sampleIds, speakerId);

    audit({
      level: 'info',
      category: 'action',
      event: 'audio_copy_complete',
      details: {
        provider: 'gpt-sovits',
        speakerId,
        sampleCount: copiedCount,
      },
      actor: 'system',
    });

    return copiedCount;
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Options for auto-export operations
 */
export interface AutoExportOptions {
  selectionMethod?: 'quality' | 'random' | 'sequential';
  targetDuration?: number; // in seconds
  maxSamples?: number;
  minQuality?: number;
}

/**
 * Automatically select and export best samples for a provider
 *
 * @param provider - Voice provider
 * @param speakerId - Speaker identifier
 * @param minQuality - Minimum quality threshold (0-1) (deprecated, use options.minQuality)
 * @param options - Export options (selection method, duration, max samples)
 * @returns Path to created reference directory
 */
export function autoExportBestSamples(
  provider: VoiceProvider,
  speakerId: string = 'default',
  minQuality: number = 0.8,
  options: AutoExportOptions = {}
): string {
  const {
    selectionMethod = 'quality',
    targetDuration,
    maxSamples,
    minQuality: optMinQuality,
  } = options;

  const effectiveMinQuality = optMinQuality ?? minQuality;

  audit({
    level: 'info',
    category: 'action',
    event: 'audio_auto_export',
    details: {
      provider,
      speakerId,
      minQuality: effectiveMinQuality,
      selectionMethod,
      targetDuration,
      maxSamples,
    },
    actor: 'system',
  });

  if (provider === 'piper') {
    // Piper: export all quality samples
    const piperTrainingDir = path.join(paths.out, 'piper-training');
    if (!fs.existsSync(piperTrainingDir)) {
      fs.mkdirSync(piperTrainingDir, { recursive: true });
    }

    const samples = listVoiceSamples(1000).filter(s => s.quality >= effectiveMinQuality);
    let copiedCount = 0;

    for (const sample of samples) {
      const destWav = path.join(piperTrainingDir, `${sample.id}.wav`);
      const destTxt = path.join(piperTrainingDir, `${sample.id}.txt`);

      if (fs.existsSync(sample.audioPath)) {
        fs.copyFileSync(sample.audioPath, destWav);
        if (fs.existsSync(sample.transcriptPath)) {
          fs.copyFileSync(sample.transcriptPath, destTxt);
        }
        copiedCount++;
      }
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'audio_auto_export_complete',
      details: {
        provider: 'piper',
        outputDir: piperTrainingDir,
        sampleCount: copiedCount,
      },
      actor: 'system',
    });

    return piperTrainingDir;
  } else if (provider === 'gpt-sovits') {
    // GPT-SoVITS: export with configurable options
    const outputDir = exportSoVITSDataset(speakerId, {
      selectionMethod,
      targetDuration,
      maxSamples,
      minQuality: effectiveMinQuality,
    });

    audit({
      level: 'info',
      category: 'action',
      event: 'audio_auto_export_complete',
      details: {
        provider: 'gpt-sovits',
        speakerId,
        outputDir,
        selectionMethod,
        targetDuration,
        maxSamples,
      },
      actor: 'system',
    });

    return outputDir;
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * List all reference audio files for a provider
 *
 * @param provider - Voice provider
 * @param speakerId - Speaker identifier
 * @returns Array of voice samples
 */
export function listReferenceSamples(
  provider: VoiceProvider,
  speakerId: string = 'default'
): VoiceSample[] {
  if (provider === 'piper') {
    // Piper stores training data in a flat directory
    const piperDir = path.join(paths.out, 'piper-training');
    if (!fs.existsSync(piperDir)) {
      return [];
    }

    const files = fs.readdirSync(piperDir);
    const wavFiles = files.filter(f => f.endsWith('.wav'));
    const samples: VoiceSample[] = [];

    for (const wavFile of wavFiles) {
      const id = path.basename(wavFile, '.wav');
      const wavPath = path.join(piperDir, wavFile);
      const txtPath = path.join(piperDir, `${id}.txt`);
      const metaPath = path.join(piperDir, `${id}.meta.json`);

      let duration = 0;
      let quality = 1.0;
      let timestamp = '';

      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          duration = meta.duration || 0;
          quality = meta.quality || 1.0;
          timestamp = meta.timestamp || '';
        } catch {
          // Ignore parse errors
        }
      }

      const stats = fs.statSync(wavPath);
      if (!timestamp) {
        timestamp = stats.birthtime.toISOString();
      }

      samples.push({
        id,
        audioPath: wavPath,
        transcriptPath: txtPath,
        duration,
        quality,
        timestamp,
      });
    }

    return samples;
  } else if (provider === 'gpt-sovits') {
    // GPT-SoVITS uses speaker-specific directories
    return listSoVITSReferences(speakerId);
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Delete a reference audio file
 *
 * @param provider - Voice provider
 * @param speakerId - Speaker identifier
 * @param sampleId - Sample ID to delete
 */
export function deleteReference(
  provider: VoiceProvider,
  speakerId: string,
  sampleId: string
): void {
  audit({
    level: 'info',
    category: 'action',
    event: 'audio_delete_reference',
    details: {
      provider,
      speakerId,
      sampleId,
    },
    actor: 'system',
  });

  if (provider === 'piper') {
    // Piper: delete from training directory
    const piperDir = path.join(paths.out, 'piper-training');
    const wavPath = path.join(piperDir, `${sampleId}.wav`);
    const txtPath = path.join(piperDir, `${sampleId}.txt`);
    const metaPath = path.join(piperDir, `${sampleId}.meta.json`);

    if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
    if (fs.existsSync(txtPath)) fs.unlinkSync(txtPath);
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);

    audit({
      level: 'info',
      category: 'action',
      event: 'audio_delete_complete',
      details: {
        provider: 'piper',
        sampleId,
      },
      actor: 'system',
    });
  } else if (provider === 'gpt-sovits') {
    // GPT-SoVITS: use dedicated delete function
    deleteSoVITSReference(speakerId, sampleId);

    audit({
      level: 'info',
      category: 'action',
      event: 'audio_delete_complete',
      details: {
        provider: 'gpt-sovits',
        speakerId,
        sampleId,
      },
      actor: 'system',
    });
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Validate audio file for use as reference audio
 *
 * @param filePath - Path to audio file
 * @param provider - Voice provider (affects validation rules)
 * @returns Validation result with issues and warnings
 */
export function validateReferenceAudio(
  filePath: string,
  provider: VoiceProvider
): AudioValidation {
  const result: AudioValidation = {
    valid: true,
    issues: [],
    warnings: [],
  };

  // Check file exists
  if (!fs.existsSync(filePath)) {
    result.valid = false;
    result.issues.push('File does not exist');
    return result;
  }

  // Check file extension
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.wav') {
    result.valid = false;
    result.issues.push('File must be WAV format');
    return result;
  }

  // Try to read metadata file if it exists
  const baseName = path.basename(filePath, '.wav');
  const dir = path.dirname(filePath);
  const metaPath = path.join(dir, `${baseName}.meta.json`);

  if (fs.existsSync(metaPath)) {
    try {
      const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      result.duration = metadata.duration;
      result.quality = metadata.quality;

      // Provider-specific validation rules
      if (provider === 'gpt-sovits') {
        // GPT-SoVITS prefers 5-10 seconds of high-quality audio
        if (metadata.duration < 3) {
          result.warnings.push('Audio shorter than 3 seconds may not work well');
        } else if (metadata.duration > 15) {
          result.warnings.push('Audio longer than 15 seconds may be unnecessary');
        }

        if (metadata.quality < 0.8) {
          result.warnings.push('Quality below 0.8 may produce poor results');
        }
      } else if (provider === 'piper') {
        // Piper benefits from more training data
        if (metadata.duration < 1) {
          result.warnings.push('Very short clips may not be useful for training');
        }
      }
    } catch (error) {
      result.warnings.push('Could not read metadata file');
    }
  } else {
    result.warnings.push('No metadata file found - duration and quality unknown');
  }

  return result;
}

/**
 * Get training readiness status for a provider
 *
 * @param provider - Voice provider
 * @param speakerId - Speaker identifier
 * @returns Object with readiness status and requirements
 */
export function getTrainingReadiness(
  provider: VoiceProvider,
  speakerId: string = 'default'
): {
  ready: boolean;
  reason?: string;
  samples: {
    total: number;
    duration: number;
    quality: number;
  };
  requirements: {
    minSamples: number;
    minDuration: number;
    minQuality: number;
  };
} {
  const samples = listVoiceSamples(1000);
  const totalDuration = samples.reduce((sum, s) => sum + s.duration, 0);
  const avgQuality = samples.length > 0
    ? samples.reduce((sum, s) => sum + s.quality, 0) / samples.length
    : 0;

  if (provider === 'piper') {
    // Piper requires significant training data
    const requirements = {
      minSamples: 100,
      minDuration: 300, // 5 minutes
      minQuality: 0.7,
    };

    const ready =
      samples.length >= requirements.minSamples &&
      totalDuration >= requirements.minDuration &&
      avgQuality >= requirements.minQuality;

    return {
      ready,
      reason: ready
        ? undefined
        : `Need ${requirements.minSamples} samples, ${requirements.minDuration}s duration, ${requirements.minQuality} avg quality`,
      samples: {
        total: samples.length,
        duration: totalDuration,
        quality: avgQuality,
      },
      requirements,
    };
  } else if (provider === 'gpt-sovits') {
    // GPT-SoVITS needs only 5-10 seconds of high-quality audio
    const requirements = {
      minSamples: 3,
      minDuration: 5,
      minQuality: 0.8,
    };

    const qualitySamples = getReferenceSamples(requirements.minQuality);
    const qualityDuration = qualitySamples.reduce((sum, s) => sum + s.duration, 0);

    const ready =
      qualitySamples.length >= requirements.minSamples &&
      qualityDuration >= requirements.minDuration;

    return {
      ready,
      reason: ready
        ? undefined
        : `Need ${requirements.minSamples} samples with ${requirements.minQuality}+ quality, ${requirements.minDuration}s total duration`,
      samples: {
        total: qualitySamples.length,
        duration: qualityDuration,
        quality: avgQuality,
      },
      requirements,
    };
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Get available voice samples suitable for a provider
 *
 * @param provider - Voice provider
 * @param minQuality - Minimum quality threshold
 * @param limit - Maximum number of samples to return
 * @returns Array of voice samples
 */
export function getAvailableSamples(
  provider: VoiceProvider,
  minQuality: number = 0.7,
  limit: number = 100
): VoiceSample[] {
  if (provider === 'piper') {
    // Piper uses all samples above quality threshold
    return listVoiceSamples(limit).filter(s => s.quality >= minQuality);
  } else if (provider === 'gpt-sovits') {
    // GPT-SoVITS prioritizes highest quality samples
    return getReferenceSamples(minQuality);
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }
}
