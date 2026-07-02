import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedHandler } from '../types.js';
import { audit } from '../../audit.js';
import { generateId } from '../../paths.js';
import { storageClient } from '../../storage-client.js';
import { systemPaths } from '../../path-builder.js';
import {
  copyToSoVITS,
  saveVoiceSample,
  setSoVITSReferenceSample,
} from '../../voice-training.js';

interface UploadedFile {
  name: string;
  type: string;
  size: number;
  buffer: Buffer;
}

interface AudioConfig {
  formats: {
    supported: string[];
    maxSizeMB: number;
  };
}

const AUDIO_CONFIG_PATH = path.join(systemPaths.etc, 'audio.json');

function uploadedFile(value: unknown): UploadedFile | null {
  if (
    value &&
    typeof value === 'object' &&
    'name' in value &&
    'size' in value &&
    'buffer' in value &&
    Buffer.isBuffer((value as { buffer?: unknown }).buffer)
  ) {
    return value as UploadedFile;
  }

  return null;
}

function loadAudioConfig(): AudioConfig {
  if (!fs.existsSync(AUDIO_CONFIG_PATH)) {
    return {
      formats: {
        supported: ['mp3', 'wav', 'm4a', 'ogg', 'webm', 'flac'],
        maxSizeMB: 100,
      },
    };
  }

  return JSON.parse(fs.readFileSync(AUDIO_CONFIG_PATH, 'utf8'));
}

export const handleAudioUpload: UnifiedHandler = async (req) => {
  try {
    const file = uploadedFile(req.body?.audio);
    if (!file) {
      return { status: 400, data: { success: false, error: 'No audio file provided' } };
    }

    const config = loadAudioConfig();
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !config.formats.supported.includes(ext)) {
      return {
        status: 400,
        data: {
          success: false,
          error: `Unsupported format. Supported: ${config.formats.supported.join(', ')}`,
        },
      };
    }

    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > config.formats.maxSizeMB) {
      return {
        status: 400,
        data: {
          success: false,
          error: `File too large. Max size: ${config.formats.maxSizeMB}MB`,
        },
      };
    }

    const audioId = generateId('audio');
    const filename = `${audioId}.${ext}`;
    const inboxResult = storageClient.resolvePath({ category: 'voice', subcategory: 'inbox' });

    if (!inboxResult.success || !inboxResult.path) {
      return {
        status: 500,
        data: { success: false, error: 'Cannot resolve audio inbox path' },
      };
    }

    fs.mkdirSync(inboxResult.path, { recursive: true });
    const filepath = path.join(inboxResult.path, filename);
    fs.writeFileSync(filepath, file.buffer);

    audit({
      level: 'info',
      category: 'data',
      event: 'audio_uploaded',
      details: {
        audioId,
        filename,
        size: file.size,
        sizeMB: sizeMB.toFixed(2),
        format: ext,
      },
      actor: 'human',
    });

    return {
      status: 200,
      data: {
        success: true,
        audioId,
        filename,
        size: file.size,
        message: 'Audio uploaded successfully. Transcription will begin automatically.',
      },
    };
  } catch (error) {
    console.error('[api/audio-upload] Error:', error);

    audit({
      level: 'error',
      category: 'system',
      event: 'audio_upload_failed',
      details: { error: (error as Error).message },
      actor: 'system',
    });

    return {
      status: 500,
      data: {
        success: false,
        error: 'Failed to upload audio file',
      },
    };
  }
};

export const handleVoiceProfileUpload: UnifiedHandler = async (req) => {
  try {
    const audioFile = uploadedFile(req.body?.audio);
    const transcript = String(req.body?.transcript || '');
    const providerRaw = String(req.body?.provider || '');
    const provider = providerRaw === 'sovits' ? 'gpt-sovits' : providerRaw;
    const speakerId = String(req.body?.speakerId || 'default');
    const duration = parseFloat(String(req.body?.duration));
    const quality = parseFloat(String(req.body?.quality)) || 1.0;
    const copyToReference = req.body?.copyToReference === 'true' || req.body?.copyToReference === true;

    if (!audioFile) {
      return { status: 400, data: { success: false, error: 'No audio file provided' } };
    }

    if (!transcript || transcript.trim().length < 10) {
      return {
        status: 400,
        data: { success: false, error: 'Transcript required (at least 10 characters)' },
      };
    }

    const format = audioFile.name.endsWith('.wav') ? 'wav' : 'webm';
    const sample = saveVoiceSample(audioFile.buffer, transcript, duration, quality, format);

    if (!sample) {
      return {
        status: 500,
        data: {
          success: false,
          error: 'Failed to save voice sample (possibly too short, low quality, or training disabled)',
        },
      };
    }

    let copiedToReference = false;
    let referencePath: string | undefined;
    if (provider === 'gpt-sovits' && copyToReference) {
      const copiedCount = copyToSoVITS([sample.id], speakerId);
      copiedToReference = copiedCount > 0;
      if (copiedToReference) {
        try {
          const result = setSoVITSReferenceSample(speakerId, sample.id);
          referencePath = result.referencePath;
        } catch (error) {
          console.error('[api/voice-profile-upload] Failed to set SoVITS reference:', error);
        }
      }
    }

    return {
      status: 200,
      data: {
        success: true,
        sampleId: sample.id,
        audioPath: sample.audioPath,
        duration: sample.duration,
        quality: sample.quality,
        copiedToReference,
        referencePath,
        message: copiedToReference
          ? `Voice profile saved and set as reference audio for ${speakerId}`
          : 'Voice sample saved successfully',
      },
    };
  } catch (error) {
    console.error('[api/voice-profile-upload] Error:', error);
    return {
      status: 500,
      data: {
        success: false,
        error: (error as Error).message,
      },
    };
  }
};
