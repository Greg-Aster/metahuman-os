/**
 * Audio Organizer Agent
 * Converts transcripts into episodic memories with LLM-extracted metadata
 */
import fs from 'node:fs';
import path from 'node:path';
import { storageClient, systemPaths, ROOT, audit, callLLM, type RouterMessage, captureEvent } from '@metahuman/core';

const AUDIO_CONFIG_PATH = path.join(systemPaths.etc, 'audio.json');
const POLL_INTERVAL_MS = 900000; // Check every 15 minutes (15 * 60 * 1000 ms)

interface AudioConfig {
  processing: {
    autoOrganize: boolean;
    extractEntities: boolean;
    generateSummary: boolean;
  };
}

interface TranscriptMetadata {
  audioId: string;
  originalFile: string;
  transcribedAt: string;
  model: string;
  language: string;
  status: string;
  organized?: boolean;
}

function loadAudioConfig(): AudioConfig {
  if (!fs.existsSync(AUDIO_CONFIG_PATH)) {
    return {
      processing: {
        autoOrganize: true,
        extractEntities: true,
        generateSummary: true,
      },
    };
  }
  return JSON.parse(fs.readFileSync(AUDIO_CONFIG_PATH, 'utf8'));
}

async function organizeTranscript(
  transcriptPath: string,
  metadataPath: string
): Promise<void> {
  const config = loadAudioConfig();
  const metadata: TranscriptMetadata = JSON.parse(
    fs.readFileSync(metadataPath, 'utf8')
  );
  const transcriptText = fs.readFileSync(transcriptPath, 'utf8');

  audit({
    level: 'info',
    category: 'action',
    event: 'audio_organization_started',
    details: { audioId: metadata.audioId },
    actor: 'audio-organizer',
  });

  try {
    let summary = '';
    let tags: string[] = [];
    let entities: string[] = [];

    // Generate summary and extract metadata using LLM
    if (config.processing.generateSummary || config.processing.extractEntities) {
      const systemPrompt = `You are analyzing an audio transcript. Extract key information in JSON format.`;
      const userPrompt = `Analyze this transcript and provide:
1. A concise summary (2-3 sentences)
2. Key tags/topics (array of strings)
3. Named entities (people, places, organizations - array of strings)

Transcript:
${transcriptText}

Respond with JSON only:
{
  "summary": "...",
  "tags": ["tag1", "tag2"],
  "entities": ["entity1", "entity2"]
}`;

      try {
        const llmResponse = await callLLM({
          role: 'curator',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          options: { temperature: 0.3 },
        });

        const response = JSON.parse(llmResponse.content) as {
          summary: string;
          tags: string[];
          entities: string[];
        };

        summary = response.summary || '';
        tags = response.tags || [];
        entities = response.entities || [];
      } catch (error) {
        console.warn('LLM extraction failed, using fallback:', error);
        summary = transcriptText.substring(0, 200) + '...';
        tags = ['audio', 'transcript'];
        entities = [];
      }
    }

    // Create episodic memory using structured metadata (avoid embedding full transcript)
    const memoryContent = summary
      ? summary
      : transcriptText.substring(0, 200) + (transcriptText.length > 200 ? '...' : '');

    const transcriptRel = path.relative(ROOT, transcriptPath);
    await captureEvent(memoryContent, {
      type: 'audio',
      tags: Array.from(new Set(['audio', 'transcript', ...tags])),
      entities,
      links: [{ type: 'source', target: transcriptRel }],
    });

    // Update transcript metadata to mark as organized
    metadata.organized = true;
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    audit({
      level: 'info',
      category: 'action',
      event: 'audio_organization_completed',
      details: {
        audioId: metadata.audioId,
        summary,
        tagCount: tags.length,
        entityCount: entities.length,
      },
      actor: 'audio-organizer',
    });

    console.log(`✓ Organized: ${metadata.audioId}`);
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'audio_organization_failed',
      details: {
        audioId: metadata.audioId,
        error: (error as Error).message,
      },
      actor: 'audio-organizer',
    });

    console.error(
      `✗ Failed to organize ${metadata.audioId}:`,
      (error as Error).message
    );
  }
}

async function processTranscripts(): Promise<void> {
  const config = loadAudioConfig();

  if (!config.processing.autoOrganize) {
    return; // Auto-organization disabled
  }

  const transcriptsResult = storageClient.resolvePath({ category: 'voice', subcategory: 'transcripts' });
  const transcriptsDir = transcriptsResult.success && transcriptsResult.path ? transcriptsResult.path : null;

  if (!transcriptsDir || !fs.existsSync(transcriptsDir)) {
    return; // Transcripts directory doesn't exist
  }

  const files = fs.readdirSync(transcriptsDir);
  const metadataFiles = files.filter((f) => f.endsWith('.meta.json'));

  if (metadataFiles.length === 0) {
    return; // No transcripts to process
  }

  for (const metaFile of metadataFiles) {
    const metadataPath = path.join(transcriptsDir, metaFile);
    const metadata: TranscriptMetadata = JSON.parse(
      fs.readFileSync(metadataPath, 'utf8')
    );

    // Skip if already organized
    if (metadata.organized) {
      continue;
    }

    // Find corresponding transcript file
    const transcriptPath = path.join(
      transcriptsDir,
      `${metadata.audioId}.txt`
    );

    if (!fs.existsSync(transcriptPath)) {
      console.warn(`Transcript not found: ${transcriptPath}`);
      continue;
    }

    console.log(`Processing transcript: ${metadata.audioId}`);
    await organizeTranscript(transcriptPath, metadataPath);
  }
}

async function main(): Promise<void> {
  console.log('Audio Organizer Agent starting...');

  audit({
    level: 'info',
    category: 'system',
    event: 'agent_started',
    details: { agent: 'audio-organizer' },
    actor: 'audio-organizer',
  });

  const oneShot = process.env.ONESHOT === '1';

  const runOnce = async () => {
    try {
      await processTranscripts();
      audit({
        level: 'info',
        category: 'system',
        event: 'agent_cycle_completed',
        details: { agent: 'audio-organizer' },
        actor: 'audio-organizer',
      });
    } catch (error) {
      console.error('Error in audio-organizer run:', error);
      audit({
        level: 'error',
        category: 'system',
        event: 'agent_cycle_failed',
        details: { agent: 'audio-organizer', error: (error as Error).message },
        actor: 'audio-organizer',
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
  console.log('Audio organizer agent shutting down...');
  audit({
    level: 'info',
    category: 'system',
    event: 'agent_stopped',
    details: { agent: 'audio-organizer' },
    actor: 'audio-organizer',
  });
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Audio organizer agent interrupted...');
  audit({
    level: 'info',
    category: 'system',
    event: 'agent_stopped',
    details: { agent: 'audio-organizer' },
    actor: 'audio-organizer',
  });
  process.exit(0);
});

main().catch((error) => {
  console.error('Fatal error in audio-organizer agent:', error);
  audit({
    level: 'error',
    category: 'system',
    event: 'agent_failed',
    details: { agent: 'audio-organizer', error: error.message },
    actor: 'audio-organizer',
  });
  process.exit(1);
});
