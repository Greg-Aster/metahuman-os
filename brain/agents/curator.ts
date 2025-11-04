#!/usr/bin/env node
/**
 * Curator Agent - Prepares clean, persona-friendly training data
 *
 * This agent:
 * - Processes raw episodic memories into curated summaries
 * - Removes tool syntax, JSON, and operator transcripts
 * - Extracts conversational essence for LoRA training
 * - Generates training-ready conversation pairs
 * - Flags sensitive data for review
 *
 * Part of Phase 3: Multi-Model Orchestration
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// For ESM __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');

// Import from core
import { paths, audit, auditAction, callLLM, type RouterMessage, acquireLock, releaseLock, isLocked, initGlobalLogger } from '@metahuman/core';

interface EpisodicMemory {
  id: string;
  timestamp: string;
  content: string;
  type?: string;
  entities?: string[];
  tags?: string[];
  response?: string;
  metadata?: {
    processed?: boolean;
    curated?: boolean;
    curatedAt?: string;
    model?: string;
  };
}

interface CuratedMemory {
  id: string;
  originalTimestamp: string;
  conversationalEssence: string;
  context?: string;
  userMessage?: string;
  assistantResponse?: string;
  curatedAt: string;
  flags: string[];
  suitableForTraining: boolean;
}

interface TrainingPair {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  metadata: {
    sourceId: string;
    timestamp: string;
    curatedAt: string;
  };
}

/**
 * Curate a memory using the curator model
 */
async function curateMemory(memory: EpisodicMemory): Promise<CuratedMemory> {
  console.log(`[Curator] Processing memory ${memory.id}`);

  const systemPrompt = `You are a memory curator preparing training data for a personal AI assistant.

Your task:
1. Extract the conversational essence from this memory
2. Remove any tool syntax, JSON, file paths, or technical jargon
3. Convert operator/skill transcripts into natural dialogue
4. Flag any sensitive information (passwords, API keys, private data)
5. Determine if this memory is suitable for personality training

Respond with JSON:
{
  "conversationalEssence": "Natural language summary",
  "userMessage": "What the user said (if applicable)",
  "assistantResponse": "What the assistant said (if applicable)",
  "context": "Additional context if needed",
  "flags": ["sensitive-data", "tool-syntax", "etc"],
  "suitableForTraining": true/false
}`;

  const messages: RouterMessage[] = [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: `Memory content:\n${memory.content}\n\n${memory.response ? `Response: ${memory.response}` : ''}`,
    },
  ];

  try {
    const response = await callLLM({
      role: 'curator',
      messages,
      options: {
        temperature: 0.3,
      },
    });

    // Parse the JSON response
    const result = JSON.parse(response.content);

    return {
      id: memory.id,
      originalTimestamp: memory.timestamp,
      conversationalEssence: result.conversationalEssence || memory.content,
      context: result.context,
      userMessage: result.userMessage,
      assistantResponse: result.assistantResponse,
      curatedAt: new Date().toISOString(),
      flags: result.flags || [],
      suitableForTraining: result.suitableForTraining !== false,
    };
  } catch (error) {
    console.error(`[Curator] Failed to parse curator response for ${memory.id}:`, error);

    // Fallback: mark as unsuitable but keep the content
    return {
      id: memory.id,
      originalTimestamp: memory.timestamp,
      conversationalEssence: memory.content,
      curatedAt: new Date().toISOString(),
      flags: ['curator-error'],
      suitableForTraining: false,
    };
  }
}

/**
 * Convert curated memory to training pair
 */
function toTrainingPair(curated: CuratedMemory): TrainingPair | null {
  if (!curated.suitableForTraining) {
    return null;
  }

  // If we have explicit user/assistant messages, use them
  if (curated.userMessage && curated.assistantResponse) {
    return {
      messages: [
        {
          role: 'user',
          content: curated.userMessage,
        },
        {
          role: 'assistant',
          content: curated.assistantResponse,
        },
      ],
      metadata: {
        sourceId: curated.id,
        timestamp: curated.originalTimestamp,
        curatedAt: curated.curatedAt,
      },
    };
  }

  // Otherwise, use the conversational essence as context
  // (suitable for pre-training but not fine-tuning pairs)
  return null;
}

/**
 * Load unprocessed episodic memories
 */
async function loadUnprocessedMemories(limit = 50): Promise<EpisodicMemory[]> {
  const episodicPath = path.join(ROOT, 'memory', 'episodic');
  const memories: EpisodicMemory[] = [];

  // Get all year directories
  const years = fs.readdirSync(episodicPath).filter(f => /^\d{4}$/.test(f));

  for (const year of years.sort().reverse()) {
    const yearPath = path.join(episodicPath, year);
    const files = fs.readdirSync(yearPath).filter(f => f.endsWith('.json'));

    for (const file of files.sort().reverse()) {
      if (memories.length >= limit) break;

      const filePath = path.join(yearPath, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const memory = JSON.parse(content) as EpisodicMemory;

        // Skip if already curated
        if (memory.metadata?.curated) continue;

        // Skip inner dialogues and reflections (not suitable for persona training)
        if (memory.type === 'inner_dialogue' || memory.tags?.includes('reflection')) continue;

        memories.push(memory);
      } catch (error) {
        console.error(`[Curator] Failed to load ${filePath}:`, error);
      }
    }

    if (memories.length >= limit) break;
  }

  return memories;
}

/**
 * Save curated memory
 */
function saveCuratedMemory(curated: CuratedMemory, outputDir: string): void {
  const dateStr = new Date(curated.originalTimestamp).toISOString().split('T')[0];
  const filename = `${dateStr}-${curated.id}.json`;
  const filepath = path.join(outputDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(curated, null, 2), 'utf-8');
  console.log(`[Curator] Saved curated memory: ${filepath}`);
}

/**
 * Save training pair to JSONL
 */
function saveTrainingPair(pair: TrainingPair, outputFile: string): void {
  const line = JSON.stringify(pair) + '\n';
  fs.appendFileSync(outputFile, line, 'utf-8');
}

/**
 * Mark original memory as curated
 */
function markAsCurated(memoryId: string, timestamp: string): void {
  const year = new Date(timestamp).getFullYear();
  const episodicPath = path.join(ROOT, 'memory', 'episodic', String(year));
  const files = fs.readdirSync(episodicPath).filter(f => f.includes(memoryId));

  if (files.length === 0) {
    console.warn(`[Curator] Could not find file for memory ${memoryId}`);
    return;
  }

  const filepath = path.join(episodicPath, files[0]);
  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const memory = JSON.parse(content);

    memory.metadata = memory.metadata || {};
    memory.metadata.curated = true;
    memory.metadata.curatedAt = new Date().toISOString();

    fs.writeFileSync(filepath, JSON.stringify(memory, null, 2), 'utf-8');
  } catch (error) {
    console.error(`[Curator] Failed to mark as curated: ${filepath}`, error);
  }
}

/**
 * Main curator process
 */
async function main() {
  initGlobalLogger();

  const lockName = 'curator';
  if (isLocked(lockName)) {
    console.log('[Curator] Another instance is already running. Exiting.');
    process.exit(0);
  }

  try {
    acquireLock(lockName);

    auditAction({
      event: 'curator_started',
      details: { timestamp: new Date().toISOString() },
    });

    // Create output directories
    const curatedDir = path.join(ROOT, 'memory', 'curated', 'conversations');
    const trainingDir = path.join(ROOT, 'memory', 'curated', 'training-datasets');
    fs.mkdirSync(curatedDir, { recursive: true });
    fs.mkdirSync(trainingDir, { recursive: true });

    // Load unprocessed memories
    console.log('[Curator] Loading unprocessed memories...');
    const memories = await loadUnprocessedMemories(50);
    console.log(`[Curator] Found ${memories.length} memories to curate`);

    if (memories.length === 0) {
      console.log('[Curator] No memories to process. Exiting.');
      auditAction({
        event: 'curator_completed',
        details: { processed: 0 },
      });
      return;
    }

    // Process each memory
    const trainingFile = path.join(trainingDir, `persona-training-${new Date().toISOString().split('T')[0]}.jsonl`);
    let processed = 0;
    let trainingPairs = 0;

    for (const memory of memories) {
      try {
        const curated = await curateMemory(memory);

        // Save curated memory
        saveCuratedMemory(curated, curatedDir);

        // Generate training pair if suitable
        const pair = toTrainingPair(curated);
        if (pair) {
          saveTrainingPair(pair, trainingFile);
          trainingPairs++;
        }

        // Mark original as curated
        markAsCurated(memory.id, memory.timestamp);

        processed++;
      } catch (error) {
        console.error(`[Curator] Failed to process memory ${memory.id}:`, error);
      }
    }

    console.log(`[Curator] Processed ${processed} memories, generated ${trainingPairs} training pairs`);

    auditAction({
      event: 'curator_completed',
      details: {
        processed,
        trainingPairs,
        outputFile: trainingFile,
      },
    });

  } catch (error) {
    console.error('[Curator] Fatal error:', error);
    auditAction({
      event: 'curator_error',
      details: { error: (error as Error).message },
    });
    process.exit(1);
  } finally {
    releaseLock(lockName);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main as runCurator };
