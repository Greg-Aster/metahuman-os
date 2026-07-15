/**
 * Transcriber Agent — Core Logic
 *
 * Monitors memory/audio/inbox for new audio files and transcribes them using Whisper.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import { storageClient, systemPaths, audit, transcribe, isWhisperCppAvailable, getRecommendedProvider } from '@metahuman/core';
import type { TranscriptionConfig } from '@metahuman/core';
import { audioIdForPath, findAudioFiles } from './audio-inbox.js';

const AUDIO_CONFIG_PATH = path.join(systemPaths.etc, 'audio.json');

interface AudioConfig {
  transcription: {
    provider?: TranscriptionConfig['provider'];
    model: string;
    language: string;
    temperature: number;
    autoTranscribe: boolean;
    whisperCppPath?: string;
    modelPath?: string;
    openaiApiKey?: string;
  };
  processing: {
    minDurationSeconds: number;
  };
}

export interface TranscriberOptions {
  oneShot?: boolean;
}

export interface TranscriberResult {
  success: boolean;
  filesProcessed: number;
  filesTranscribed: number;
  filesFailed: number;
  errors: string[];
}

function loadAudioConfig(): AudioConfig {
  if (!fs.existsSync(AUDIO_CONFIG_PATH)) {
    return {
      transcription: {
        provider: 'mock',
        model: 'base.en',
        language: 'en',
        temperature: 0.0,
        autoTranscribe: true,
      },
      processing: {
        minDurationSeconds: 5,
      },
    };
  }
  return JSON.parse(fs.readFileSync(AUDIO_CONFIG_PATH, 'utf8'));
}

async function transcribeAudio(audioPath: string, audioId: string, inboxDir: string, config: AudioConfig): Promise<boolean> {
  console.log(`Starting transcription for ${audioId}`);

  audit({
    level: 'info',
    category: 'action',
    event: 'transcription_started',
    details: { audioId, audioPath },
    actor: 'transcriber',
  });

  try {
    const transcriptionOptions: Partial<TranscriptionConfig> = {
      language: config.transcription.language,
      temperature: config.transcription.temperature,
    };

    if (config.transcription.provider) {
      transcriptionOptions.provider = config.transcription.provider;
    }
    if (config.transcription.whisperCppPath) {
      transcriptionOptions.whisperCppPath = config.transcription.whisperCppPath;
    }
    if (config.transcription.modelPath) {
      transcriptionOptions.modelPath = config.transcription.modelPath;
    }
    if (config.transcription.openaiApiKey) {
      transcriptionOptions.openaiApiKey = config.transcription.openaiApiKey;
    }

    const result = await transcribe(audioPath, transcriptionOptions);
    const transcriptText = result.text;

    const transcriptsResult = storageClient.resolvePath({ category: 'voice', subcategory: 'transcripts' });
    const transcriptsDir = transcriptsResult.success && transcriptsResult.path ? transcriptsResult.path : path.join(systemPaths.memory, 'audio', 'transcripts');

    const transcriptPath = path.join(transcriptsDir, `${audioId}.txt`);
    fs.mkdirSync(transcriptsDir, { recursive: true });
    fs.writeFileSync(transcriptPath, transcriptText, 'utf8');

    const metadataPath = path.join(transcriptsDir, `${audioId}.meta.json`);
    const metadata = {
      audioId,
      originalFile: path.basename(audioPath),
      transcribedAt: new Date().toISOString(),
      model: config.transcription.model,
      language: config.transcription.language,
      status: 'completed',
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    const archiveResult = storageClient.resolvePath({ category: 'voice', subcategory: 'archive' });
    const archiveDir = archiveResult.success && archiveResult.path ? archiveResult.path : path.join(systemPaths.memory, 'audio', 'archive');
    const archivePath = path.join(archiveDir, path.relative(inboxDir, audioPath));
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.renameSync(audioPath, archivePath);

    audit({
      level: 'info',
      category: 'action',
      event: 'transcription_completed',
      details: { audioId, transcriptPath, archivedTo: archivePath, characterCount: transcriptText.length },
      actor: 'transcriber',
    });

    console.log(`✓ Transcribed: ${audioId}`);
    return true;
  } catch (error) {
    console.error(`Caught error in transcribeAudio for ${audioId}:`, error);
    audit({
      level: 'error',
      category: 'action',
      event: 'transcription_failed',
      details: { audioId, error: (error as Error).message },
      actor: 'transcriber',
    });
    console.error(`✗ Failed to transcribe ${audioId}:`, (error as Error).message);
    return false;
  }
}

export async function runCycle(options: TranscriberOptions = {}): Promise<TranscriberResult> {
  const result: TranscriberResult = {
    success: true,
    filesProcessed: 0,
    filesTranscribed: 0,
    filesFailed: 0,
    errors: [],
  };

  const config = loadAudioConfig();

  if (!config.transcription.autoTranscribe) {
    return result; // Auto-transcription disabled
  }

  const provider = getRecommendedProvider({
    whisperCppPath: config.transcription.whisperCppPath,
    openaiApiKey: config.transcription.openaiApiKey,
  });
  console.log(`Transcription provider: ${provider}`);

  if (config.transcription.provider === 'whisper.cpp') {
    const whisperAvailable = isWhisperCppAvailable(config.transcription.whisperCppPath);
    const modelAvailable = !config.transcription.modelPath || fs.existsSync(config.transcription.modelPath);
    if (!whisperAvailable || !modelAvailable) {
      const missing = [
        !whisperAvailable ? `binary ${config.transcription.whisperCppPath || 'whisper'}` : null,
        !modelAvailable ? `model ${config.transcription.modelPath}` : null,
      ].filter(Boolean).join(' and ');
      const message = `Whisper dependency missing: ${missing}. Audio inbox left unchanged.`;
      console.error(`[transcriber] ${message}`);
      audit({
        category: 'agent',
        level: 'error',
        event: 'transcriber_dependency_missing',
        actor: 'transcriber',
        details: { missing, provider: config.transcription.provider },
      });
      result.success = false;
      result.errors.push(message);
      return result;
    }
  }

  const inboxResult = storageClient.resolvePath({ category: 'voice', subcategory: 'inbox' });
  const inboxDir = inboxResult.success && inboxResult.path ? inboxResult.path : null;

  if (!inboxDir || !fs.existsSync(inboxDir)) {
    return result; // Inbox doesn't exist yet
  }

  const audioFiles = findAudioFiles(inboxDir);

  if (audioFiles.length === 0) {
    return result; // No files to process
  }

  console.log(`Found ${audioFiles.length} audio file(s) to transcribe`);
  result.filesProcessed = audioFiles.length;

  for (const audioPath of audioFiles) {
    const audioId = audioIdForPath(inboxDir, audioPath);

    try {
      const success = await transcribeAudio(audioPath, audioId, inboxDir, config);
      if (success) {
        result.filesTranscribed++;
      } else {
        result.filesFailed++;
      }
    } catch (error) {
      result.filesFailed++;
      result.errors.push(`Error processing ${path.relative(inboxDir, audioPath)}: ${(error as Error).message}`);
    }
  }

  audit({
    category: 'agent',
    level: 'info',
    event: 'transcriber_cycle_completed',
    actor: 'transcriber',
    details: {
      filesProcessed: result.filesProcessed,
      filesTranscribed: result.filesTranscribed,
      filesFailed: result.filesFailed,
    },
  });

  return result;
}

export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  const options: TranscriberOptions = {
    oneShot: args.includes('--oneshot') || opts.oneShot === true,
  };

  const result = await runCycle(options);

  return {
    success: result.success,
    data: {
      filesProcessed: result.filesProcessed,
      filesTranscribed: result.filesTranscribed,
      filesFailed: result.filesFailed,
    },
    errors: result.errors.length > 0 ? result.errors : undefined,
    durationMs: Date.now() - startTime,
  };
}
