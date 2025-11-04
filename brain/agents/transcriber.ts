/**
 * Transcriber Agent
 * Monitors memory/audio/inbox for new audio files and transcribes them using Whisper
 */
import fs from 'node:fs';
import path from 'node:path';
import { paths, audit, transcribe, isWhisperCppAvailable, getRecommendedProvider } from '@metahuman/core';
import type { TranscriptionConfig } from '@metahuman/core';

const AUDIO_CONFIG_PATH = path.join(paths.etc, 'audio.json');
const POLL_INTERVAL_MS = 10000; // Check every 10 seconds

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

async function transcribeAudio(audioPath: string, audioId: string): Promise<void> {
  console.log(`Starting transcription for ${audioId}`);
  const config = loadAudioConfig();

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

    // Transcribe using the transcription module
    // It will auto-detect the best available provider (whisper.cpp, OpenAI, or mock)
    const result = await transcribe(audioPath, transcriptionOptions);

    const transcriptText = result.text;

    // Save transcript
    const transcriptPath = path.join(
      paths.audioTranscripts,
      `${audioId}.txt`
    );
    fs.mkdirSync(paths.audioTranscripts, { recursive: true });
    fs.writeFileSync(transcriptPath, transcriptText, 'utf8');

    // Save metadata
    const metadataPath = path.join(
      paths.audioTranscripts,
      `${audioId}.meta.json`
    );
    const metadata = {
      audioId,
      originalFile: path.basename(audioPath),
      transcribedAt: new Date().toISOString(),
      model: config.transcription.model,
      language: config.transcription.language,
      status: 'completed',
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    // Move audio to archive
    const archivePath = path.join(
      paths.audioArchive,
      path.basename(audioPath)
    );
    fs.mkdirSync(paths.audioArchive, { recursive: true });
    fs.renameSync(audioPath, archivePath);

    audit({
      level: 'info',
      category: 'action',
      event: 'transcription_completed',
      details: {
        audioId,
        transcriptPath,
        archivedTo: archivePath,
        characterCount: transcriptText.length,
      },
      actor: 'transcriber',
    });

    console.log(`✓ Transcribed: ${audioId}`);
  } catch (error) {
    console.error(`Caught error in transcribeAudio for ${audioId}:`, error);
    audit({
      level: 'error',
      category: 'action',
      event: 'transcription_failed',
      details: {
        audioId,
        error: (error as Error).message,
      },
      actor: 'transcriber',
    });

    console.error(`✗ Failed to transcribe ${audioId}:`, (error as Error).message);
  }
  console.log(`Finished transcription for ${audioId}`);
}

async function processInbox(): Promise<void> {
  const config = loadAudioConfig();

  if (!config.transcription.autoTranscribe) {
    return; // Auto-transcription disabled
  }

  if (!fs.existsSync(paths.audioInbox)) {
    return; // Inbox doesn't exist yet
  }

  const files = fs.readdirSync(paths.audioInbox);
  const audioFiles = files.filter(
    (f) =>
      !f.startsWith('.') &&
      /\.(mp3|wav|m4a|ogg|webm|flac)$/i.test(f)
  );

  if (audioFiles.length === 0) {
    return; // No files to process
  }

  console.log(`Found ${audioFiles.length} audio file(s) to transcribe`);

  for (const file of audioFiles) {
    const audioPath = path.join(paths.audioInbox, file);
    const audioId = file.split('.')[0]; // Extract ID from filename

    await transcribeAudio(audioPath, audioId);
  }
}

async function main(): Promise<void> {
  console.log('Transcriber Agent starting...');

  const config = loadAudioConfig();
  const provider = getRecommendedProvider({
    whisperCppPath: config.transcription.whisperCppPath,
    openaiApiKey: config.transcription.openaiApiKey,
  });
  console.log(`Transcription provider: ${provider}`);

  if (!isWhisperCppAvailable(config.transcription.whisperCppPath)) {
    console.log('\n⚠️  whisper.cpp not found - using mock transcription');
    console.log('To enable real transcription:');
    console.log('  1. Install whisper.cpp: https://github.com/ggerganov/whisper.cpp');
    console.log('  2. Or configure OpenAI API key in etc/audio.json\n');
  }

  audit({
    level: 'info',
    category: 'system',
    event: 'agent_started',
    details: { agent: 'transcriber', provider },
    actor: 'transcriber',
  });

  const oneShot = process.env.ONESHOT === '1';

  const runOnce = async () => {
    try {
      await processInbox();
      audit({
        level: 'info',
        category: 'system',
        event: 'agent_cycle_completed',
        details: { agent: 'transcriber' },
        actor: 'transcriber',
      });
    } catch (error) {
      console.error('Error in transcriber run:', error);
      audit({
        level: 'error',
        category: 'system',
        event: 'agent_cycle_failed',
        details: { agent: 'transcriber', error: (error as Error).message },
        actor: 'transcriber',
      });
    }
  };

  if (oneShot) {
    await runOnce();
    return;
  }

  // Continuous monitoring loop
  while (true) {
    await runOnce();
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Transcriber agent shutting down...');
  audit({
    level: 'info',
    category: 'system',
    event: 'agent_stopped',
    details: { agent: 'transcriber' },
    actor: 'transcriber',
  });
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Transcriber agent interrupted...');
  audit({
    level: 'info',
    category: 'system',
    event: 'agent_stopped',
    details: { agent: 'transcriber' },
    actor: 'transcriber',
  });
  process.exit(0);
});

main().catch((error) => {
  console.error('Fatal error in transcriber agent:', error);
  audit({
    level: 'error',
    category: 'system',
    event: 'agent_failed',
    details: { agent: 'transcriber', error: error.message },
    actor: 'transcriber',
  });
  process.exit(1);
});
