/**
 * Audio Organizer Agent — Core Logic
 *
 * Converts transcripts into episodic memories with LLM-extracted metadata.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import { storageClient, systemPaths, ROOT, audit, callLLM, captureEvent } from '@metahuman/core';

const LOG_PREFIX = '[audio-organizer-core]';
const AUDIO_CONFIG_PATH = path.join(systemPaths.etc, 'audio.json');

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

export interface AudioOrganizerOptions {
  oneShot?: boolean;
}

export interface AudioOrganizerResult {
  success: boolean;
  transcriptsProcessed: number;
  transcriptsOrganized: number;
  transcriptsFailed: number;
  errors: string[];
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
  
  try {
    return JSON.parse(fs.readFileSync(AUDIO_CONFIG_PATH, 'utf8'));
  } catch (error) {
    console.warn(`${LOG_PREFIX} Failed to parse audio config, using defaults:`, error);
    return {
      processing: {
        autoOrganize: true,
        extractEntities: true,
        generateSummary: true,
      },
    };
  }
}

async function organizeTranscript(transcriptPath: string, metadataPath: string, config: AudioConfig): Promise<boolean> {
  console.log(`${LOG_PREFIX} ========== organizeTranscript HIT ==========`);
  console.log(`${LOG_PREFIX} Processing: ${transcriptPath}`);
  
  const metadata: TranscriptMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
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
        console.warn(`${LOG_PREFIX} LLM extraction failed, using fallback:`, error);
        summary = transcriptText.substring(0, 200) + '...';
        tags = ['audio', 'transcript'];
        entities = [];
      }
    }

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

    metadata.organized = true;
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    audit({
      level: 'info',
      category: 'action',
      event: 'audio_organization_completed',
      details: { audioId: metadata.audioId, summary, tagCount: tags.length, entityCount: entities.length },
      actor: 'audio-organizer',
    });

    console.log(`${LOG_PREFIX} ✓ Organized: ${metadata.audioId}`);
    return true;
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'audio_organization_failed',
      details: { audioId: metadata.audioId, error: (error as Error).message },
      actor: 'audio-organizer',
    });

    console.error(`${LOG_PREFIX} ✗ Failed to organize ${metadata.audioId}:`, (error as Error).message);
    return false;
  }
}

export async function runCycle(options: AudioOrganizerOptions = {}): Promise<AudioOrganizerResult> {
  console.log(`${LOG_PREFIX} ========== runCycle HIT ==========`);
  console.log(`${LOG_PREFIX} Input options:`, options);
  
  const result: AudioOrganizerResult = {
    success: true,
    transcriptsProcessed: 0,
    transcriptsOrganized: 0,
    transcriptsFailed: 0,
    errors: [],
  };

  const config = loadAudioConfig();

  if (!config.processing.autoOrganize) {
    console.log(`${LOG_PREFIX} Auto-organization disabled, exiting early`);
    return result; // Auto-organization disabled
  }

  const transcriptsResult = storageClient.resolvePath({ category: 'voice', subcategory: 'transcripts' });
  const transcriptsDir = transcriptsResult.success && transcriptsResult.path ? transcriptsResult.path : null;

  if (!transcriptsDir || !fs.existsSync(transcriptsDir)) {
    console.log(`${LOG_PREFIX} Transcripts directory not found: ${transcriptsDir || 'undefined'}`);
    return result; // Transcripts directory doesn't exist
  }

  const files = fs.readdirSync(transcriptsDir);
  const metadataFiles = files.filter((f) => f.endsWith('.meta.json'));

  if (metadataFiles.length === 0) {
    console.log(`${LOG_PREFIX} No metadata files found in ${transcriptsDir}`);
    return result; // No transcripts to process
  }
  
  console.log(`${LOG_PREFIX} Found ${metadataFiles.length} metadata files to process`);

  for (const metaFile of metadataFiles) {
    const metadataPath = path.join(transcriptsDir, metaFile);
    const metadata: TranscriptMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

    if (metadata.organized) {
      continue;
    }

    const transcriptPath = path.join(transcriptsDir, `${metadata.audioId}.txt`);

    if (!fs.existsSync(transcriptPath)) {
      console.warn(`${LOG_PREFIX} Transcript not found: ${transcriptPath}`);
      continue;
    }

    result.transcriptsProcessed++;
    console.log(`${LOG_PREFIX} Processing transcript: ${metadata.audioId}`);

    try {
      const success = await organizeTranscript(transcriptPath, metadataPath, config);
      if (success) {
        result.transcriptsOrganized++;
      } else {
        result.transcriptsFailed++;
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Error processing ${metadata.audioId}:`, error);
      result.transcriptsFailed++;
      result.errors.push(`Error organizing ${metadata.audioId}: ${(error as Error).message}`);
    }
  }

  audit({
    category: 'agent',
    level: 'info',
    event: 'audio_organizer_cycle_completed',
    actor: 'audio-organizer',
    details: {
      transcriptsProcessed: result.transcriptsProcessed,
      transcriptsOrganized: result.transcriptsOrganized,
      transcriptsFailed: result.transcriptsFailed,
    },
  });

  return result;
}

export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  console.log(`${LOG_PREFIX} ========== run HIT ==========`);
  
  try {
    const args = input.args || [];
    const opts = input.options || {};

    const options: AudioOrganizerOptions = {
      oneShot: args.includes('--oneshot') || opts.oneShot === true,
    };
    console.log(`${LOG_PREFIX} Options: oneShot=${options.oneShot}`);

    const result = await runCycle(options);

    return {
      success: result.success,
      data: {
        transcriptsProcessed: result.transcriptsProcessed,
        transcriptsOrganized: result.transcriptsOrganized,
        transcriptsFailed: result.transcriptsFailed,
      },
      errors: result.errors.length > 0 ? result.errors : undefined,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Fatal error in run():`, error);
    audit({
      level: 'error',
      category: 'agent',
      event: 'audio_organizer_run_failed',
      details: { error: (error as Error).message },
      actor: 'audio-organizer',
    });

    return {
      success: false,
      data: {
        transcriptsProcessed: 0,
        transcriptsOrganized: 0,
        transcriptsFailed: 0,
      },
      errors: [(error as Error).message],
      durationMs: Date.now() - startTime,
    };
  }
}
