/**
 * Voice Training Data Collection
 * Passively collects voice samples during conversations for custom voice training
 */

import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';
import { spawnSync } from 'node:child_process';
import { audit } from './audit.js';

export interface VoiceTrainingConfig {
  enabled: boolean;
  minDuration: number; // seconds
  maxDuration: number; // seconds
  minQuality: number; // 0-1 (based on volume/clarity)
  targetHours: number; // total hours needed
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
  const samples = listVoiceSamples(100); // Get up to 100 recent samples

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
 */
export function copyToSoVITS(sampleIds: string[], speakerId: string = 'default'): number {
  const recordingsDir = paths.voiceTraining;
  const sovitsRefDir = path.join(paths.sovitsReference, speakerId);

  // Create SoVITS reference directory
  if (!fs.existsSync(sovitsRefDir)) {
    fs.mkdirSync(sovitsRefDir, { recursive: true });
  }

  let copiedCount = 0;

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
      copiedCount++;
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
