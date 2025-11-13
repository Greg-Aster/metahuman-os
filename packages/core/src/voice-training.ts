/**
 * Voice Training Data Collection
 * Passively collects voice samples during conversations for custom voice training
 */

import fs from 'node:fs';
import path from 'node:path';
import { paths, systemPaths } from './paths.js';
import { spawn, spawnSync } from 'node:child_process';
import { audit } from './audit.js';
import { clearCache } from './tts/cache.js';

export interface VoiceTrainingConfig {
  enabled: boolean;
  minDuration: number; // seconds
  maxDuration: number; // seconds
  minQuality: number; // 0-1 (based on volume/clarity)
  targetHours: number; // total hours needed
}

export interface RVCTrainingStatus {
  status: 'idle' | 'running' | 'completed' | 'failed';
  speakerId: string;
  progress: number; // 0-100
  currentEpoch?: number;
  totalEpochs?: number;
  message?: string;
  error?: string;
  startTime?: number;
  endTime?: number;
  pid?: number;
  modelPath?: string;
}

export interface VoiceSample {
  id: string;
  audioPath: string;
  transcriptPath: string;
  duration: number;
  timestamp: string;
  quality: number;
}

let config: VoiceTrainingConfig | null = null;

/**
 * Load voice training configuration
 */
function loadConfig(): VoiceTrainingConfig {
  // Always read fresh so runtime updates to etc/voice.json take effect immediately
  try {
    const configPath = paths.voiceConfig;
    const voiceConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config = voiceConfig.training || null;
  } catch {
    config = null;
  }
  if (!config) {
    config = {
      enabled: true,
      minDuration: 2,
      maxDuration: 120,
      minQuality: 0.6,
      targetHours: 3,
    };
  }
  return config;
}

/**
 * Get voice training data directory
 */
function getTrainingDir(): string {
  const dir = paths.voiceTraining;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Save voice sample for training
 */
export function saveVoiceSample(
  audioBuffer: Buffer,
  transcript: string,
  duration: number,
  quality: number = 1.0,
  format: 'wav' | 'webm' = 'wav'
): VoiceSample | null {
  const cfg = loadConfig();

  console.log('[voice-training] saveVoiceSample called:', {
    audioSize: audioBuffer.length,
    transcriptLength: transcript.length,
    duration,
    quality,
    cfg
  });

  // Check if training is enabled
  if (!cfg.enabled) {
    console.log('[voice-training] Training disabled in config');
    return null;
  }

  // Validate duration (clamp overly long clips instead of rejecting)
  if (duration < cfg.minDuration) {
    console.log('[voice-training] Duration too short:', duration, 'min:', cfg.minDuration);
    return null;
  }
  let effectiveDuration = duration;
  if (duration > cfg.maxDuration) {
    console.log('[voice-training] Duration exceeds max, clamping:', duration, '→', cfg.maxDuration);
    effectiveDuration = cfg.maxDuration;
  }

  // Validate quality
  if (quality < cfg.minQuality) {
    console.log('[voice-training] Quality too low:', quality, 'min:', cfg.minQuality);
    return null;
  }

  // Validate transcript (must have actual words)
  if (!transcript || transcript.trim().length < 10) {
    console.log('[voice-training] Transcript too short:', transcript?.length);
    return null;
  }

  // Generate unique ID
  const timestamp = new Date().toISOString();
  const id = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const trainingDir = getTrainingDir();
  let audioPath = path.join(trainingDir, `${id}.wav`);
  const transcriptPath = path.join(trainingDir, `${id}.txt`);

  try {
    // Save audio
    if (format === 'wav') {
      fs.writeFileSync(audioPath, audioBuffer);
    } else {
      // Attempt to transcode WEBM/Opus to WAV for consistent training format
      try {
        const tempWebm = path.join(trainingDir, `${id}.webm`);
        fs.writeFileSync(tempWebm, audioBuffer);
        const res = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', tempWebm, '-ac', '1', '-ar', '22050', audioPath], {
          cwd: paths.root,
        });
        if (res.status !== 0) {
          // Fallback: keep WEBM if ffmpeg not available
          audioPath = tempWebm;
        } else {
          // Transcode succeeded; remove temp
          try { fs.unlinkSync(tempWebm) } catch {}
        }
      } catch (e) {
        // Fallback: save buffer as WEBM
        audioPath = path.join(trainingDir, `${id}.webm`);
        fs.writeFileSync(audioPath, audioBuffer);
      }
    }

    // Save transcript (cleaned)
    const cleanedTranscript = transcript.trim().replace(/\s+/g, ' ');
    fs.writeFileSync(transcriptPath, cleanedTranscript, 'utf-8');

    // Create metadata file
    const metadataPath = path.join(trainingDir, `${id}.meta.json`);
    const metadata: VoiceSample = {
      id,
      audioPath,
      transcriptPath,
      duration: effectiveDuration,
      timestamp,
      quality,
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    console.log('[voice-training] Sample saved successfully:', id);

    audit({
      level: 'info',
      category: 'action',
      event: 'voice_sample_saved',
      details: {
        id,
        duration: effectiveDuration,
        quality,
        transcriptLength: cleanedTranscript.length,
      },
      actor: 'system',
    });

    return metadata;
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'voice_sample_save_failed',
      details: { error: (error as Error).message },
      actor: 'system',
    });
    return null;
  }
}

/**
 * Get training progress statistics
 */
export function getTrainingProgress(): {
  samplesCollected: number;
  totalDuration: number;
  targetDuration: number;
  percentComplete: number;
  estimatedQuality: number;
  readyForTraining: boolean;
} {
  const cfg = loadConfig();
  const trainingDir = getTrainingDir();

  if (!fs.existsSync(trainingDir)) {
    return {
      samplesCollected: 0,
      totalDuration: 0,
      targetDuration: cfg.targetHours * 3600,
      percentComplete: 0,
      estimatedQuality: 0,
      readyForTraining: false,
    };
  }

  const metaFiles = fs.readdirSync(trainingDir).filter(f => f.endsWith('.meta.json'));

  let totalDuration = 0;
  let totalQuality = 0;

  for (const metaFile of metaFiles) {
    try {
      const metaPath = path.join(trainingDir, metaFile);
      const metadata: VoiceSample = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      totalDuration += metadata.duration;
      totalQuality += metadata.quality;
    } catch {
      // Skip corrupted files
    }
  }

  const targetDuration = cfg.targetHours * 3600;
  const percentComplete = Math.min(100, (totalDuration / targetDuration) * 100);
  const estimatedQuality = metaFiles.length > 0 ? totalQuality / metaFiles.length : 0;
  const readyForTraining = totalDuration >= (cfg.targetHours * 0.8 * 3600); // 80% of target

  return {
    samplesCollected: metaFiles.length,
    totalDuration,
    targetDuration,
    percentComplete,
    estimatedQuality,
    readyForTraining,
  };
}

/**
 * List all voice samples
 */
export function listVoiceSamples(limit?: number): VoiceSample[] {
  const trainingDir = getTrainingDir();

  if (!fs.existsSync(trainingDir)) {
    return [];
  }

  const metaFiles = fs.readdirSync(trainingDir).filter(f => f.endsWith('.meta.json'));
  const samples: VoiceSample[] = [];

  for (const metaFile of metaFiles) {
    try {
      const metaPath = path.join(trainingDir, metaFile);
      const metadata: VoiceSample = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      samples.push(metadata);
    } catch {
      // Skip corrupted files
    }
  }

  // Sort by timestamp (newest first)
  samples.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Apply limit if specified
  if (limit && limit > 0) {
    return samples.slice(0, limit);
  }

  return samples;
}

/**
 * Delete voice sample
 */
export function deleteVoiceSample(id: string): boolean {
  const trainingDir = getTrainingDir();

  try {
    const audioPath = path.join(trainingDir, `${id}.wav`);
    const transcriptPath = path.join(trainingDir, `${id}.txt`);
    const metadataPath = path.join(trainingDir, `${id}.meta.json`);

    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    if (fs.existsSync(transcriptPath)) fs.unlinkSync(transcriptPath);
    if (fs.existsSync(metadataPath)) fs.unlinkSync(metadataPath);

    audit({
      level: 'info',
      category: 'action',
      event: 'voice_sample_deleted',
      details: { id },
      actor: 'system',
    });

    return true;
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'voice_sample_delete_failed',
      details: { id, error: (error as Error).message },
      actor: 'system',
    });
    return false;
  }
}

/**
 * Export training dataset in Piper format
 */
export function exportTrainingDataset(): string {
  const trainingDir = getTrainingDir();
  const exportDir = paths.voiceDataset;

  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const samples = listVoiceSamples();

  // Create metadata.csv for Piper training
  const csvLines: string[] = ['audio_file|transcript'];

  for (const sample of samples) {
    const audioFile = path.basename(sample.audioPath);
    const transcript = fs.readFileSync(sample.transcriptPath, 'utf-8').trim();
    csvLines.push(`${audioFile}|${transcript}`);

    // Copy audio file to dataset
    const destAudio = path.join(exportDir, audioFile);
    fs.copyFileSync(sample.audioPath, destAudio);
  }

  // Write metadata.csv
  const csvPath = path.join(exportDir, 'metadata.csv');
  fs.writeFileSync(csvPath, csvLines.join('\n'), 'utf-8');

  audit({
    level: 'info',
    category: 'action',
    event: 'training_dataset_exported',
    details: { exportDir, samples: samples.length },
    actor: 'system',
  });

  return exportDir;
}

/**
 * Get voice training status (enabled/disabled)
 */
export function getVoiceTrainingStatus(): { enabled: boolean } {
  const cfg = loadConfig();
  return { enabled: cfg.enabled };
}

/**
 * Set voice training enabled state
 */
export function setVoiceTrainingEnabled(enabled: boolean): { enabled: boolean } {
  const configPath = paths.voiceConfig;

  try {
    let voiceConfig: any = {};
    if (fs.existsSync(configPath)) {
      voiceConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }

    if (!voiceConfig.training) {
      voiceConfig.training = {
        enabled: false,
        minDuration: 2,
        maxDuration: 120,
        minQuality: 0.6,
        targetHours: 3,
      };
    }

    voiceConfig.training.enabled = enabled;
    fs.writeFileSync(configPath, JSON.stringify(voiceConfig, null, 2), 'utf-8');

    audit({
      level: 'info',
      category: 'action',
      event: 'voice_training_toggled',
      details: { enabled },
      actor: 'system',
    });

    return { enabled };
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'voice_training_toggle_failed',
      details: { error: (error as Error).message },
      actor: 'system',
    });
    throw error;
  }
}

/**
 * Purge all voice training data
 */
export function purgeVoiceTrainingData(): { deletedCount: number } {
  const trainingDir = getTrainingDir();
  let deletedCount = 0;

  try {
    if (fs.existsSync(trainingDir)) {
      const files = fs.readdirSync(trainingDir);

      for (const file of files) {
        try {
          const filePath = path.join(trainingDir, file);
          fs.unlinkSync(filePath);
          deletedCount++;
        } catch (error) {
          console.error(`Failed to delete ${file}:`, error);
        }
      }
    }

    // Also clean up exported datasets
    const exportDir = paths.voiceDataset;
    if (fs.existsSync(exportDir)) {
      const files = fs.readdirSync(exportDir);
      for (const file of files) {
        try {
          const filePath = path.join(exportDir, file);
          fs.unlinkSync(filePath);
        } catch (error) {
          console.error(`Failed to delete export ${file}:`, error);
        }
      }
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'voice_training_data_purged',
      details: { deletedCount },
      actor: 'system',
    });

    return { deletedCount };
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'voice_training_purge_failed',
      details: { error: (error as Error).message },
      actor: 'system',
    });
    throw error;
  }
}

/**
 * Get high-quality samples suitable for GPT-SoVITS reference audio
 * GPT-SoVITS works best with 5-10 seconds of clear speech
 */
export function getReferenceSamples(minQuality = 0.8): VoiceSample[] {
  const samples = listVoiceSamples(5000); // Get all available samples (no artificial limit)

  // Filter for high quality samples
  const qualitySamples = samples.filter(s => s.quality >= minQuality);

  // Sort by quality descending
  qualitySamples.sort((a, b) => b.quality - a.quality);

  return qualitySamples;
}

/**
 * Export voice training dataset for GPT-SoVITS
 * Copies selected high-quality samples to the SoVITS reference directory
 */
export function exportSoVITSDataset(speakerId: string = 'default'): string {
  const recordingsDir = paths.voiceTraining;
  const sovitsRefDir = path.join(paths.sovitsReference, speakerId);

  // Create SoVITS reference directory
  if (!fs.existsSync(sovitsRefDir)) {
    fs.mkdirSync(sovitsRefDir, { recursive: true });
  }

  // Get recommended reference samples (top quality, 5-10 seconds total)
  const samples = getReferenceSamples(0.8);
  let totalDuration = 0;
  const targetDuration = 10; // 10 seconds total
  const selectedSamples: VoiceSample[] = [];

  // Select samples until we have 5-10 seconds
  for (const sample of samples) {
    if (totalDuration >= targetDuration) break;
    if (totalDuration + sample.duration <= 15) { // Don't exceed 15 seconds
      selectedSamples.push(sample);
      totalDuration += sample.duration;
    }
  }

  if (selectedSamples.length === 0) {
    throw new Error('No suitable samples found for reference audio. Need high-quality recordings (quality ≥ 0.8)');
  }

  // Copy selected WAV files to SoVITS directory
  let copiedCount = 0;
  const manifest: any[] = [];

  for (const sample of selectedSamples) {
    const sourceWav = path.join(recordingsDir, `${sample.id}.wav`);
    const sourceTxt = path.join(recordingsDir, `${sample.id}.txt`);
    const destWav = path.join(sovitsRefDir, `${sample.id}.wav`);
    const destTxt = path.join(sovitsRefDir, `${sample.id}.txt`);

    if (fs.existsSync(sourceWav)) {
      fs.copyFileSync(sourceWav, destWav);
      if (fs.existsSync(sourceTxt)) {
        fs.copyFileSync(sourceTxt, destTxt);
      }
      copiedCount++;

      manifest.push({
        id: sample.id,
        duration: sample.duration,
        quality: sample.quality,
        filename: `${sample.id}.wav`,
      });
    }
  }

  // Write manifest file
  const manifestPath = path.join(sovitsRefDir, 'manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        speakerId,
        createdAt: new Date().toISOString(),
        totalDuration,
        sampleCount: copiedCount,
        samples: manifest,
      },
      null,
      2
    )
  );

  audit({
    level: 'info',
    category: 'action',
    event: 'sovits_dataset_export',
    details: {
      speakerId,
      sampleCount: copiedCount,
      totalDuration,
      exportPath: sovitsRefDir,
    },
    actor: 'system',
  });

  return sovitsRefDir;
}

/**
 * Copy specific samples to GPT-SoVITS reference directory
 * IMPORTANT: Clears existing reference audio first, then copies only selected samples
 */
export function copyToSoVITS(sampleIds: string[], speakerId: string = 'default'): number {
  const recordingsDir = paths.voiceTraining;
  const sovitsRefDir = path.join(paths.sovitsReference, speakerId);

  // Create SoVITS reference directory if it doesn't exist
  if (!fs.existsSync(sovitsRefDir)) {
    fs.mkdirSync(sovitsRefDir, { recursive: true });
  }

  // CLEAR ALL EXISTING REFERENCE AUDIO FILES
  // This ensures only the newly selected samples are used for voice cloning
  const existingFiles = fs.readdirSync(sovitsRefDir);
  let deletedCount = 0;
  for (const file of existingFiles) {
    // Delete all audio and text files (but preserve manifest.json if exists)
    if (file.endsWith('.wav') || file.endsWith('.mp3') || file.endsWith('.flac') || file.endsWith('.txt')) {
      try {
        fs.unlinkSync(path.join(sovitsRefDir, file));
        deletedCount++;
      } catch (error) {
        console.error(`[copyToSoVITS] Failed to delete ${file}:`, error);
      }
    }
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'sovits_reference_cleared',
    details: {
      speakerId,
      deletedCount,
    },
    actor: 'system',
  });

  // Now copy the selected samples
  let copiedCount = 0;
  const copiedFiles: string[] = [];

  for (const sampleId of sampleIds) {
    const sourceWav = path.join(recordingsDir, `${sampleId}.wav`);
    const sourceTxt = path.join(recordingsDir, `${sampleId}.txt`);
    const destWav = path.join(sovitsRefDir, `${sampleId}.wav`);
    const destTxt = path.join(sovitsRefDir, `${sampleId}.txt`);

    if (fs.existsSync(sourceWav)) {
      fs.copyFileSync(sourceWav, destWav);
      if (fs.existsSync(sourceTxt)) {
        fs.copyFileSync(sourceTxt, destTxt);
      }
      copiedFiles.push(destWav);
      copiedCount++;
    }
  }

  // If multiple samples were copied, concatenate them into a single reference.wav
  // This gives GPT-SoVITS more voice data for better accuracy
  if (copiedFiles.length > 1) {
    try {
      const referenceWav = path.join(sovitsRefDir, 'reference.wav');

      // Create ffmpeg concat file list
      const concatListPath = path.join(sovitsRefDir, 'concat-list.txt');
      const concatList = copiedFiles.map(f => `file '${path.basename(f)}'`).join('\n');
      fs.writeFileSync(concatListPath, concatList);

      // Use ffmpeg to concatenate all WAV files
      const result = spawnSync('ffmpeg', [
        '-y', // Overwrite output
        '-f', 'concat',
        '-safe', '0',
        '-i', concatListPath,
        '-c', 'copy', // Copy codec (no re-encoding)
        referenceWav
      ], {
        cwd: sovitsRefDir,
        stdio: 'pipe'
      });

      // Clean up concat list
      try {
        fs.unlinkSync(concatListPath);
      } catch {}

      if (result.status === 0) {
        audit({
          level: 'info',
          category: 'action',
          event: 'sovits_reference_concatenated',
          details: {
            speakerId,
            sourceFiles: copiedFiles.length,
            outputFile: 'reference.wav',
          },
          actor: 'system',
        });
      } else {
        console.error('[copyToSoVITS] ffmpeg concatenation failed:', result.stderr?.toString());
      }
    } catch (error) {
      console.error('[copyToSoVITS] Failed to concatenate audio files:', error);
      // Continue anyway - individual files still work
    }
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'sovits_reference_copy',
    details: {
      speakerId,
      sampleCount: copiedCount,
      sampleIds,
    },
    actor: 'system',
  });

  // Clear TTS cache since reference audio has changed
  // This ensures next TTS generation uses the new voice profile
  try {
    const voiceConfig = JSON.parse(fs.readFileSync(paths.voiceConfig, 'utf-8'));
    if (voiceConfig?.cache?.enabled) {
      const cacheDir = voiceConfig.cache.directory || path.join(paths.out, 'voice-cache');
      const cacheConfig = {
        enabled: true,
        directory: cacheDir,
        maxSizeMB: voiceConfig.cache.maxSizeMB || 500,
      };
      const clearedCount = clearCache(cacheConfig);

      audit({
        level: 'info',
        category: 'action',
        event: 'tts_cache_auto_cleared',
        details: {
          reason: 'Reference audio updated',
          speakerId,
          filesCleared: clearedCount,
        },
        actor: 'system',
      });
    }
  } catch (error) {
    // If cache clearing fails, log but don't throw - reference audio copy still succeeded
    console.error('[copyToSoVITS] Failed to clear TTS cache:', error);
  }

  return copiedCount;
}

/**
 * List reference audio files for a GPT-SoVITS speaker
 */
export function listSoVITSReferences(speakerId: string = 'default'): VoiceSample[] {
  const sovitsRefDir = path.join(paths.sovitsReference, speakerId);

  if (!fs.existsSync(sovitsRefDir)) {
    return [];
  }

  const files = fs.readdirSync(sovitsRefDir);
  const wavFiles = files.filter(f => f.endsWith('.wav'));
  const samples: VoiceSample[] = [];

  for (const wavFile of wavFiles) {
    const id = wavFile.replace('.wav', '');
    const wavPath = path.join(sovitsRefDir, wavFile);
    const txtPath = path.join(sovitsRefDir, `${id}.txt`);
    const metaPath = path.join(sovitsRefDir, `${id}.meta.json`);

    let transcript = '';
    let quality = 1.0;
    let duration = 0;
    let timestamp = '';

    if (fs.existsSync(txtPath)) {
      transcript = fs.readFileSync(txtPath, 'utf-8').trim();
    }

    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        quality = meta.quality || 1.0;
        duration = meta.duration || 0;
        timestamp = meta.timestamp || '';
      } catch (e) {
        // Ignore parse errors
      }
    }

    samples.push({
      id,
      audioPath: wavPath,
      transcriptPath: txtPath,
      duration,
      timestamp,
      quality,
    });
  }

  return samples;
}

/**
 * Delete reference audio for a GPT-SoVITS speaker
 */
export function deleteSoVITSReference(speakerId: string, sampleId: string): void {
  const sovitsRefDir = path.join(paths.sovitsReference, speakerId);
  const wavPath = path.join(sovitsRefDir, `${sampleId}.wav`);
  const txtPath = path.join(sovitsRefDir, `${sampleId}.txt`);
  const metaPath = path.join(sovitsRefDir, `${sampleId}.meta.json`);

  if (fs.existsSync(wavPath)) {
    fs.unlinkSync(wavPath);
  }
  if (fs.existsSync(txtPath)) {
    fs.unlinkSync(txtPath);
  }
  if (fs.existsSync(metaPath)) {
    fs.unlinkSync(metaPath);
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'sovits_reference_delete',
    details: { speakerId, sampleId },
    actor: 'system',
  });
}

/**
 * Copy specific samples to RVC training directory
 * RVC requires 10-15 minutes of training audio (100+ samples)
 */
export function copyToRVC(sampleIds: string[], speakerId: string = 'default'): number {
  const recordingsDir = paths.voiceTraining;
  const rvcRefDir = path.join(paths.rvcReference, speakerId);

  // Create RVC directory if it doesn't exist
  if (!fs.existsSync(rvcRefDir)) {
    fs.mkdirSync(rvcRefDir, { recursive: true });
  }

  let copiedCount = 0;
  let totalDuration = 0;

  for (const sampleId of sampleIds) {
    const sourceWav = path.join(recordingsDir, `${sampleId}.wav`);
    const sourceTxt = path.join(recordingsDir, `${sampleId}.txt`);
    const sourceMeta = path.join(recordingsDir, `${sampleId}.meta.json`);
    const destWav = path.join(rvcRefDir, `${sampleId}.wav`);
    const destTxt = path.join(rvcRefDir, `${sampleId}.txt`);
    const destMeta = path.join(rvcRefDir, `${sampleId}.meta.json`);

    if (fs.existsSync(sourceWav)) {
      fs.copyFileSync(sourceWav, destWav);
      if (fs.existsSync(sourceTxt)) {
        fs.copyFileSync(sourceTxt, destTxt);
      }
      if (fs.existsSync(sourceMeta)) {
        fs.copyFileSync(sourceMeta, destMeta);
        try {
          const meta = JSON.parse(fs.readFileSync(sourceMeta, 'utf-8'));
          totalDuration += meta.duration || 0;
        } catch {}
      }
      copiedCount++;
    }
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'rvc_samples_copy',
    details: {
      speakerId,
      sampleCount: copiedCount,
      totalDuration,
      sampleIds,
    },
    actor: 'system',
  });

  return copiedCount;
}

/**
 * List RVC training samples for a speaker
 */
export function listRVCSamples(speakerId: string = 'default'): VoiceSample[] {
  const rvcRefDir = path.join(paths.rvcReference, speakerId);

  if (!fs.existsSync(rvcRefDir)) {
    return [];
  }

  const files = fs.readdirSync(rvcRefDir);
  const wavFiles = files.filter(f => f.endsWith('.wav') && !f.startsWith('models'));
  const samples: VoiceSample[] = [];

  for (const wavFile of wavFiles) {
    const id = wavFile.replace('.wav', '');
    const wavPath = path.join(rvcRefDir, wavFile);
    const txtPath = path.join(rvcRefDir, `${id}.txt`);
    const metaPath = path.join(rvcRefDir, `${id}.meta.json`);

    let quality = 1.0;
    let duration = 0;
    let timestamp = '';

    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        quality = meta.quality || 1.0;
        duration = meta.duration || 0;
        timestamp = meta.timestamp || '';
      } catch (e) {
        // Ignore parse errors
      }
    }

    samples.push({
      id,
      audioPath: wavPath,
      transcriptPath: txtPath,
      duration,
      timestamp,
      quality,
    });
  }

  return samples;
}

/**
 * Delete RVC training sample
 */
export function deleteRVCSample(speakerId: string, sampleId: string): void {
  const rvcRefDir = path.join(paths.rvcReference, speakerId);
  const wavPath = path.join(rvcRefDir, `${sampleId}.wav`);
  const txtPath = path.join(rvcRefDir, `${sampleId}.txt`);
  const metaPath = path.join(rvcRefDir, `${sampleId}.meta.json`);

  if (fs.existsSync(wavPath)) {
    fs.unlinkSync(wavPath);
  }
  if (fs.existsSync(txtPath)) {
    fs.unlinkSync(txtPath);
  }
  if (fs.existsSync(metaPath)) {
    fs.unlinkSync(metaPath);
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'rvc_sample_delete',
    details: { speakerId, sampleId },
    actor: 'system',
  });
}

/**
 * Get RVC training readiness status
 * RVC typically needs 10-15 minutes of audio (600-900 seconds)
 *
 * This checks the main voice training recordings directory, not the RVC-specific directory.
 * Users need to export/copy samples to the RVC directory before training.
 */
export function getRVCTrainingReadiness(speakerId: string = 'default'): {
  ready: boolean;
  reason?: string;
  samples: { total: number; duration: number; quality: number };
  requirements: { minSamples: number; minDuration: number; minQuality: number };
} {
  // Check the main voice training recordings directory (shared with all providers)
  const samples = listVoiceSamples(1000); // Get all samples
  const minSamples = 50; // Minimum sample count
  const minDuration = 600; // 10 minutes in seconds
  const minQuality = 0.7;

  let totalDuration = 0;
  let totalQuality = 0;

  for (const sample of samples) {
    totalDuration += sample.duration;
    totalQuality += sample.quality;
  }

  const avgQuality = samples.length > 0 ? totalQuality / samples.length : 0;
  const ready = samples.length >= minSamples && totalDuration >= minDuration && avgQuality >= minQuality;

  let reason: string | undefined;
  if (!ready) {
    if (samples.length < minSamples) {
      reason = `Need at least ${minSamples} samples (currently ${samples.length})`;
    } else if (totalDuration < minDuration) {
      reason = `Need at least ${Math.floor(minDuration / 60)} minutes of audio (currently ${Math.floor(totalDuration / 60)} minutes)`;
    } else if (avgQuality < minQuality) {
      reason = `Average quality too low (need ${minQuality * 100}%, currently ${(avgQuality * 100).toFixed(0)}%)`;
    }
  }

  return {
    ready,
    reason,
    samples: {
      total: samples.length,
      duration: totalDuration,
      quality: avgQuality,
    },
    requirements: {
      minSamples,
      minDuration,
      minQuality,
    },
  };
}

/**
 * Get the status file path for RVC training
 */
function getRVCTrainingStatusPath(speakerId: string): string {
  return path.join(systemPaths.logs, 'run', `rvc-training-${speakerId}.json`);
}

/**
 * Get current RVC training status
 */
export function getRVCTrainingStatus(speakerId: string = 'default'): RVCTrainingStatus {
  const statusPath = getRVCTrainingStatusPath(speakerId);

  if (!fs.existsSync(statusPath)) {
    return {
      status: 'idle',
      speakerId,
      progress: 0,
    };
  }

  try {
    const statusData = fs.readFileSync(statusPath, 'utf-8');
    const status: RVCTrainingStatus = JSON.parse(statusData);

    // Check if process is still running
    if (status.status === 'running' && status.pid) {
      try {
        // Check if PID exists (will throw if process doesn't exist)
        process.kill(status.pid, 0);
      } catch {
        // Process is dead but status wasn't updated
        status.status = 'failed';
        status.error = 'Training process terminated unexpectedly';
        status.endTime = Date.now();
        writeRVCTrainingStatus(status);
      }
    }

    return status;
  } catch (error) {
    return {
      status: 'idle',
      speakerId,
      progress: 0,
    };
  }
}

/**
 * Write RVC training status to file
 */
function writeRVCTrainingStatus(status: RVCTrainingStatus): void {
  const statusPath = getRVCTrainingStatusPath(status.speakerId);
  const dir = path.dirname(statusPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), 'utf-8');
}

/**
 * Run RVC preprocessing: slice audio, normalize, resample
 * Returns true if successful, false otherwise
 */
function runRVCPreprocessing(speakerId: string, inputDir: string, outputDir: string, sampleRate: number): boolean {
  const rvcDir = path.join(systemPaths.root, 'external', 'applio-rvc');
  const venvPython = path.join(rvcDir, 'venv', 'bin', 'python');
  const preprocessScript = path.join(rvcDir, 'rvc', 'train', 'preprocess', 'preprocess.py');

  // Preprocessing parameters
  const numProcesses = 'none'; // Use all CPU cores
  const cutPreprocess = 'Automatic'; // Automatic voice activity detection
  const processEffects = '1'; // Apply high-pass filter
  const noiseReduction = '0'; // Don't apply noise reduction (already clean samples)
  const reductionStrength = '0.5'; // Unused when noise_reduction=0
  const chunkLen = '3.0'; // 3 second chunks
  const overlapLen = '0.3'; // 0.3 second overlap
  const normalizationMode = 'post'; // Normalize after cutting

  console.log(`[RVC Preprocessing] Starting preprocessing for ${speakerId}...`);

  const result = spawnSync(
    venvPython,
    [
      preprocessScript,
      outputDir,          // experiment_directory (logs/default)
      inputDir,           // input_root (voice samples directory)
      sampleRate.toString(), // sample_rate
      numProcesses,       // num_processes
      cutPreprocess,      // cut_preprocess
      processEffects,     // process_effects
      noiseReduction,     // noise_reduction
      reductionStrength,  // reduction_strength
      chunkLen,           // chunk_len
      overlapLen,         // overlap_len
      normalizationMode,  // normalization_mode
    ],
    {
      cwd: rvcDir,
      stdio: 'inherit', // Show output directly in console
      encoding: 'utf-8',
    }
  );

  if (result.status !== 0) {
    console.error(`[RVC Preprocessing] Failed with exit code ${result.status}`);
    return false;
  }

  console.log(`[RVC Preprocessing] Completed successfully`);
  return true;
}

/**
 * Run RVC feature extraction: extract f0 pitch and speaker embeddings
 * Returns true if successful, false otherwise
 */
function runRVCFeatureExtraction(
  speakerId: string,
  outputDir: string,
  sampleRate: number,
  f0Method: string = 'rmvpe'
): boolean {
  const rvcDir = path.join(systemPaths.root, 'external', 'applio-rvc');
  const venvPython = path.join(rvcDir, 'venv', 'bin', 'python');
  const extractScript = path.join(rvcDir, 'rvc', 'train', 'extract', 'extract.py');

  // Feature extraction parameters
  const numProcesses = 4; // Number of parallel processes
  const gpus = '-'; // Use CPU (no GPU) - change to "0" for GPU
  const embedderModel = 'contentvec'; // Default embedder model
  const includeMutes = '2'; // Include 2 mute samples per speaker

  console.log(`[RVC Feature Extraction] Starting feature extraction for ${speakerId}...`);

  const result = spawnSync(
    venvPython,
    [
      extractScript,
      outputDir,              // arg 1: exp_dir (logs/default)
      f0Method,               // arg 2: f0_method (rmvpe, crepe, fcpe)
      numProcesses.toString(), // arg 3: num_processes
      gpus,                   // arg 4: gpus
      sampleRate.toString(),  // arg 5: sample_rate
      embedderModel,          // arg 6: embedder_model
      '',                     // arg 7: embedder_model_custom (empty = use default)
      includeMutes,           // arg 8: include_mutes
    ],
    {
      cwd: rvcDir,
      stdio: 'inherit', // Show output directly in console
      encoding: 'utf-8',
      timeout: 600000, // 10 minutes max
    }
  );

  if (result.status !== 0) {
    console.error(`[RVC Feature Extraction] Failed with exit code ${result.status}`);
    return false;
  }

  console.log(`[RVC Feature Extraction] Completed successfully`);
  return true;
}

/**
 * Start RVC model training
 * This spawns a Python training script in the background
 */
export function startRVCTraining(speakerId: string = 'default'): { success: boolean; error?: string } {
  // Check if training is already running
  const currentStatus = getRVCTrainingStatus(speakerId);
  if (currentStatus.status === 'running') {
    return {
      success: false,
      error: 'Training is already in progress. Please wait for it to complete.',
    };
  }

  // Check if enough samples have been copied to the RVC training directory
  const copiedSamples = listRVCSamples(speakerId);
  const minSamples = 50;
  const minDuration = 600; // 10 minutes

  if (copiedSamples.length === 0) {
    return {
      success: false,
      error: 'No samples copied to RVC training directory. Please export samples first using "Auto-Export Best Samples" or "Copy Selected Samples".',
    };
  }

  if (copiedSamples.length < minSamples) {
    return {
      success: false,
      error: `Not enough samples in RVC training directory. Need ${minSamples} samples, currently have ${copiedSamples.length}. Please export more samples.`,
    };
  }

  const totalDuration = copiedSamples.reduce((sum, s) => sum + s.duration, 0);
  if (totalDuration < minDuration) {
    return {
      success: false,
      error: `Not enough audio duration in RVC training directory. Need ${Math.floor(minDuration / 60)} minutes, currently have ${Math.floor(totalDuration / 60)} minutes. Please export more samples.`,
    };
  }

  const rvcDir = path.join(systemPaths.root, 'external', 'applio-rvc');
  const venvPython = path.join(rvcDir, 'venv', 'bin', 'python3');
  const trainScript = path.join(rvcDir, 'rvc', 'train', 'train.py');

  // Check if Python venv exists
  if (!fs.existsSync(venvPython)) {
    return {
      success: false,
      error: 'RVC Python environment not found. Please install RVC addon first.',
    };
  }

  // Check if training script exists
  if (!fs.existsSync(trainScript)) {
    return {
      success: false,
      error: 'RVC training script not found. Please reinstall RVC addon.',
    };
  }

  const trainingDataDir = path.join(paths.rvcReference, speakerId);
  const modelOutputDir = path.join(paths.rvcModels, speakerId);

  // Create model output directory
  if (!fs.existsSync(modelOutputDir)) {
    fs.mkdirSync(modelOutputDir, { recursive: true });
  }

  // RVC experiment directory (where preprocessing outputs will be stored)
  const rvcExperimentDir = path.join(rvcDir, 'logs', speakerId);
  if (!fs.existsSync(rvcExperimentDir)) {
    fs.mkdirSync(rvcExperimentDir, { recursive: true });
  }

  // RVC uses 40kHz sample rate
  const rvcSampleRate = 40000;

  // Stop Ollama to free up GPU VRAM for training (RVC needs ~10GB, Ollama uses ~9.5GB)
  console.log('[RVC Training] Stopping Ollama to free GPU VRAM...');
  try {
    spawnSync('pkill', ['-f', 'ollama'], { stdio: 'ignore' });
    console.log('[RVC Training] Ollama stopped successfully');

    // Wait 2 seconds for VRAM to be fully released
    spawnSync('sleep', ['2']);
  } catch (error) {
    console.log('[RVC Training] Ollama may not be running (this is OK)');
  }

  // Step 1: Run preprocessing (slice, normalize, resample)
  console.log('[RVC Training] Step 1/3: Preprocessing audio samples...');
  const preprocessSuccess = runRVCPreprocessing(speakerId, trainingDataDir, rvcExperimentDir, rvcSampleRate);
  if (!preprocessSuccess) {
    // Restart Ollama before returning error
    console.log('[RVC Training] Restarting Ollama after preprocessing failure...');
    try {
      spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' }).unref();
    } catch (e) {
      console.error('[RVC Training] Failed to restart Ollama:', e);
    }

    return {
      success: false,
      error: 'Preprocessing failed. Check console logs for details.',
    };
  }

  // Step 2: Run feature extraction (f0 pitch and embeddings)
  console.log('[RVC Training] Step 2/3: Extracting features (pitch and embeddings)...');
  const extractionSuccess = runRVCFeatureExtraction(speakerId, rvcExperimentDir, rvcSampleRate);
  if (!extractionSuccess) {
    // Restart Ollama before returning error
    console.log('[RVC Training] Restarting Ollama after feature extraction failure...');
    try {
      spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' }).unref();
    } catch (e) {
      console.error('[RVC Training] Failed to restart Ollama:', e);
    }

    return {
      success: false,
      error: 'Feature extraction failed. Check console logs for details.',
    };
  }

  // Step 3: Train the model
  console.log('[RVC Training] Step 3/3: Training voice conversion model...');

  // Training parameters
  const totalEpochs = 300; // Standard for RVC
  const saveEveryEpoch = 50; // Save checkpoints every 50 epochs
  const batchSize = 8;

  // Initialize training status
  const trainingStatus: RVCTrainingStatus = {
    status: 'running',
    speakerId,
    progress: 0,
    currentEpoch: 0,
    totalEpochs,
    message: 'Initializing training...',
    startTime: Date.now(),
  };

  // Spawn training process in background
  const logPath = path.join(systemPaths.logs, 'run', `rvc-training-${speakerId}.log`);

  // Ensure logs/run directory exists
  const logDir = path.dirname(logPath);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // Open log file descriptor for output redirection
  const logFd = fs.openSync(logPath, 'w');

  // RVC training script expects these exact arguments in this order
  const pretrainG = ''; // Empty string = use default pretrained model
  const pretrainD = ''; // Empty string = use default pretrained model
  const gpus = '0'; // Use first GPU (or CPU if no GPU)
  const sampleRateStr = rvcSampleRate.toString(); // Convert to string for spawn args
  const saveOnlyLatest = '0'; // Save all checkpoints
  const saveEveryWeights = '1'; // Save weights at intervals
  const cacheDataInGpu = '0'; // Don't cache in GPU (safer for memory)
  const overtrainingDetector = '1'; // Enable overtraining detection
  const overtrainingThreshold = '50'; // Standard threshold
  const cleanup = '0'; // Don't auto-cleanup
  const vocoder = 'v2'; // Use v2 vocoder (standard)
  const checkpointing = '0'; // Disable gradient checkpointing for now

  const trainingProcess = spawn(
    venvPython,
    [
      trainScript,
      speakerId,                    // arg 1: model_name
      saveEveryEpoch.toString(),    // arg 2: save_every_epoch
      totalEpochs.toString(),       // arg 3: total_epoch
      pretrainG,                    // arg 4: pretrainG path
      pretrainD,                    // arg 5: pretrainD path
      gpus,                         // arg 6: GPU IDs
      batchSize.toString(),         // arg 7: batch_size
      sampleRateStr,                // arg 8: sample_rate
      saveOnlyLatest,               // arg 9: save_only_latest
      saveEveryWeights,             // arg 10: save_every_weights
      cacheDataInGpu,               // arg 11: cache_data_in_gpu
      overtrainingDetector,         // arg 12: overtraining_detector
      overtrainingThreshold,        // arg 13: overtraining_threshold
      cleanup,                      // arg 14: cleanup
      vocoder,                      // arg 15: vocoder
      checkpointing,                // arg 16: checkpointing
    ],
    {
      cwd: rvcDir,
      detached: true,
      stdio: ['ignore', logFd, logFd] as const,
      env: {
        ...process.env,
        CUDA_VISIBLE_DEVICES: '0', // Use first GPU if available
      },
    }
  );

  trainingStatus.pid = trainingProcess.pid ?? 0;
  writeRVCTrainingStatus(trainingStatus);

  // Detach process so it continues after parent exits
  if (trainingProcess.unref) {
    trainingProcess.unref();
  }

  // Monitor training progress in background
  const monitorInterval = setInterval(() => {
    const status = getRVCTrainingStatus(speakerId);

    // Parse log file for progress
    if (fs.existsSync(logPath)) {
      try {
        const logContent = fs.readFileSync(logPath, 'utf-8');

        // RVC uses format: "default | epoch=35 | step=2275 | ..."
        // Extract the last epoch line
        const epochMatches = logContent.match(/epoch=(\d+)\s*\|/g);

        if (epochMatches && epochMatches.length > 0) {
          const lastMatch = epochMatches[epochMatches.length - 1];
          const [, current] = lastMatch.match(/epoch=(\d+)/) || [];

          // Total epochs is always 300 (set in startRVCTraining)
          const total = status.totalEpochs || 300;

          if (current) {
            status.currentEpoch = parseInt(current);
            status.totalEpochs = total;
            status.progress = Math.floor((status.currentEpoch / status.totalEpochs) * 100);
            status.message = `Training epoch ${current}/${total}...`;
            writeRVCTrainingStatus(status);
          }
        }
      } catch (error) {
        // Ignore parsing errors
      }
    }

    // Check if training completed
    const modelPath = path.join(modelOutputDir, `${speakerId}.pth`);
    if (fs.existsSync(modelPath) && status.status === 'running') {
      status.status = 'completed';
      status.progress = 100;
      status.endTime = Date.now();
      status.message = 'Training completed successfully!';
      status.modelPath = modelPath;
      writeRVCTrainingStatus(status);

      audit({
        level: 'info',
        category: 'action',
        event: 'rvc_training_completed',
        details: {
          speakerId,
          modelPath,
          duration: status.endTime - (status.startTime || 0),
          epochs: status.totalEpochs,
        },
        actor: 'system',
      });

      clearInterval(monitorInterval);
    }

    // Stop monitoring if failed or completed
    if (status.status === 'failed' || status.status === 'completed') {
      clearInterval(monitorInterval);
    }
  }, 5000); // Check every 5 seconds

  // Handle process completion
  if (trainingProcess.on) {
    trainingProcess.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      const status = getRVCTrainingStatus(speakerId);

      if (code === 0) {
        status.status = 'completed';
        status.progress = 100;
        status.message = 'Training completed successfully!';

        const modelPath = path.join(modelOutputDir, `${speakerId}.pth`);
        if (fs.existsSync(modelPath)) {
          status.modelPath = modelPath;
        }
      } else {
        status.status = 'failed';
        status.error = `Training process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`;
      }

      status.endTime = Date.now();
      writeRVCTrainingStatus(status);

      // Close log file descriptor
      try {
        fs.closeSync(logFd);
      } catch (e) {
        // Ignore errors closing fd
      }

      clearInterval(monitorInterval);

      // Restart Ollama after training completes (success or failure)
      console.log('[RVC Training] Restarting Ollama...');
      try {
        spawn('ollama', ['serve'], {
          detached: true,
          stdio: 'ignore'
        }).unref(); // Unref so parent process doesn't wait for Ollama
        console.log('[RVC Training] Ollama restarted successfully');
      } catch (error) {
        console.error('[RVC Training] Failed to restart Ollama:', error);
      }

      audit({
        level: code === 0 ? 'info' : 'error',
        category: 'action',
        event: code === 0 ? 'rvc_training_completed' : 'rvc_training_failed',
        details: {
          speakerId,
          exitCode: code,
          signal,
          duration: status.endTime - (status.startTime || 0),
        },
        actor: 'system',
      });
    });
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'rvc_training_started',
    details: {
      speakerId,
      trainingDataDir,
      modelOutputDir,
      sampleCount: copiedSamples.length,
      duration: totalDuration,
      totalEpochs,
      pid: trainingProcess.pid ?? 0,
    },
    actor: 'system',
  });

  return { success: true };
}
