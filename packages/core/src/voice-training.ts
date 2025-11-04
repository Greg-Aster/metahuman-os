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
    const configPath = path.join(paths.root, 'etc', 'voice.json');
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
  const dir = path.join(paths.root, 'out', 'voice-training', 'recordings');
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
export function listVoiceSamples(): VoiceSample[] {
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
  const exportDir = path.join(paths.root, 'out', 'voice-training', 'dataset');

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
