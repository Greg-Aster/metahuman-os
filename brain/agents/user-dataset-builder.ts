/**
 * User-Aware Dataset Builder
 *
 * Builds training datasets for a specific user by:
 * 1. Collecting all episodic memories
 * 2. Collecting therapy session transcripts
 * 3. Collecting chat conversations
 * 4. Using curator model to generate high-quality training samples
 *
 * Usage:
 *   npx tsx brain/agents/user-dataset-builder.ts --username greggles --output out/adapters/2025-11-14/dataset.jsonl
 */

import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../../packages/core/src/index.js';
import { callLLM } from '../../packages/core/src/model-router.js';
import { mkdirpSync } from 'mkdirp';

interface DatasetSample {
  instruction: string;
  input: string;
  output: string;
  metadata?: {
    source: string;
    timestamp?: string;
    confidence?: number;
  };
}

interface Args {
  username: string;
  output: string;
  maxSamples?: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Partial<Args> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && args[i + 1]) {
      result.username = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      result.output = args[i + 1];
      i++;
    } else if (args[i] === '--max' && args[i + 1]) {
      result.maxSamples = parseInt(args[i + 1], 10);
      i++;
    }
  }

  if (!result.username || !result.output) {
    console.error('Usage: tsx user-dataset-builder.ts --username <username> --output <path.jsonl> [--max <count>]');
    process.exit(1);
  }

  return result as Args;
}

function getUserProfilePath(username: string): string {
  return path.join(paths.root, 'profiles', username);
}

/**
 * Collect all episodic memories for the user
 */
function collectEpisodicMemories(username: string): any[] {
  const profilePath = getUserProfilePath(username);
  const episodicPath = path.join(profilePath, 'memory', 'episodic');

  if (!fs.existsSync(episodicPath)) {
    console.warn(`[user-dataset-builder] No episodic memories found for ${username}`);
    return [];
  }

  const memories: any[] = [];

  // Walk through year directories
  const years = fs.readdirSync(episodicPath).filter(name => /^\d{4}$/.test(name));

  for (const year of years) {
    const yearPath = path.join(episodicPath, year);
    const files = fs.readdirSync(yearPath).filter(f => f.endsWith('.json'));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(yearPath, file), 'utf-8');
        const memory = JSON.parse(content);
        memories.push(memory);
      } catch (err) {
        console.warn(`[user-dataset-builder] Failed to read ${file}: ${(err as Error).message}`);
      }
    }
  }

  console.log(`[user-dataset-builder] Collected ${memories.length} episodic memories`);
  return memories;
}

/**
 * Collect therapy session transcripts
 */
function collectTherapySessions(username: string): any[] {
  const profilePath = getUserProfilePath(username);
  const therapyPath = path.join(profilePath, 'persona', 'therapy');

  if (!fs.existsSync(therapyPath)) {
    console.warn(`[user-dataset-builder] No therapy sessions found for ${username}`);
    return [];
  }

  const sessions: any[] = [];
  const files = fs.readdirSync(therapyPath).filter(f => f.startsWith('session-') && f.endsWith('.json'));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(therapyPath, file), 'utf-8');
      const session = JSON.parse(content);
      sessions.push(session);
    } catch (err) {
      console.warn(`[user-dataset-builder] Failed to read ${file}: ${(err as Error).message}`);
    }
  }

  console.log(`[user-dataset-builder] Collected ${sessions.length} therapy sessions`);
  return sessions;
}

/**
 * Collect chat conversations from training data directory
 */
function collectChatConversations(username: string): any[] {
  const profilePath = getUserProfilePath(username);
  const trainingPath = path.join(profilePath, 'memory', 'training');

  if (!fs.existsSync(trainingPath)) {
    console.warn(`[user-dataset-builder] No training data found for ${username}`);
    return [];
  }

  const conversations: any[] = [];

  // Recursively find all .jsonl files
  function walkDir(dir: string) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        walkDir(filePath);
      } else if (file.endsWith('.jsonl')) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              conversations.push(JSON.parse(line));
            } catch {}
          }
        } catch (err) {
          console.warn(`[user-dataset-builder] Failed to read ${file}: ${(err as Error).message}`);
        }
      }
    }
  }

  walkDir(trainingPath);
  console.log(`[user-dataset-builder] Collected ${conversations.length} chat messages`);
  return conversations;
}

/**
 * Use curator model to generate training sample from memory
 */
async function curateMemorySample(memory: any): Promise<DatasetSample | null> {
  try {
    const prompt = `You are a training data curator. Generate a high-quality instruction-response pair from this memory that captures the person's personality, communication style, and thought patterns.

Memory:
Type: ${memory.type}
Content: ${memory.content}
Tags: ${memory.tags?.join(', ') || 'none'}
Timestamp: ${memory.timestamp}

Generate a JSON object with:
- instruction: A question or prompt that would elicit this kind of response
- input: Optional context (usually empty string)
- output: How the person would respond based on this memory

Focus on capturing authentic voice, personality traits, values, and communication patterns.`;

    const response = await callLLM({
      role: 'curator',
      messages: [{ role: 'user', content: prompt }],
    });

    // Extract JSON from response
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[user-dataset-builder] No JSON found in curator response');
      return null;
    }

    const sample = JSON.parse(jsonMatch[0]);

    return {
      instruction: sample.instruction,
      input: sample.input || '',
      output: sample.output,
      metadata: {
        source: 'episodic_memory',
        timestamp: memory.timestamp,
      },
    };
  } catch (err) {
    console.warn(`[user-dataset-builder] Failed to curate memory: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Generate training sample from therapy session Q&A
 */
async function curateTherapyQA(question: string, answer: string, category: string): Promise<DatasetSample> {
  // Therapy sessions are already in Q&A format, just need to format properly
  return {
    instruction: question,
    input: '',
    output: answer,
    metadata: {
      source: 'therapy_session',
      category,
    },
  };
}

/**
 * Main dataset building function
 */
async function buildDataset(args: Args): Promise<void> {
  console.log(`[user-dataset-builder] Building dataset for user: ${args.username}`);
  console.log(`[user-dataset-builder] Output: ${args.output}`);

  const samples: DatasetSample[] = [];

  // 1. Collect therapy sessions (highest quality, use all)
  const therapySessions = collectTherapySessions(args.username);
  for (const session of therapySessions) {
    if (session.questions && session.answers) {
      for (let i = 0; i < session.answers.length; i++) {
        const question = session.questions[i];
        const answer = session.answers[i];

        const sample = await curateTherapyQA(
          question.prompt,
          answer.content,
          question.category
        );
        samples.push(sample);
      }
    }
  }

  console.log(`[user-dataset-builder] Added ${samples.length} therapy Q&A pairs`);

  // 2. Collect and curate episodic memories
  const memories = collectEpisodicMemories(args.username);

  // Filter for high-value memory types
  const valuableMemories = memories.filter(m =>
    m.type === 'conversation' ||
    m.type === 'observation' ||
    m.type === 'reflection' ||
    m.type === 'inner_dialogue'
  );

  console.log(`[user-dataset-builder] Processing ${valuableMemories.length} valuable memories...`);

  let memoryCount = 0;
  for (const memory of valuableMemories) {
    if (args.maxSamples && samples.length >= args.maxSamples) break;

    const sample = await curateMemorySample(memory);
    if (sample) {
      samples.push(sample);
      memoryCount++;

      if (memoryCount % 10 === 0) {
        console.log(`[user-dataset-builder] Curated ${memoryCount} memories...`);
      }
    }
  }

  console.log(`[user-dataset-builder] Curated ${memoryCount} memory samples`);

  // 3. Deduplicate samples
  const seenSamples = new Set<string>();
  const uniqueSamples: DatasetSample[] = [];
  let duplicateCount = 0;

  for (const sample of samples) {
    const fingerprint = JSON.stringify({
      instruction: sample.instruction,
      output: sample.output,
    });

    if (seenSamples.has(fingerprint)) {
      duplicateCount++;
      continue;
    }

    seenSamples.add(fingerprint);
    uniqueSamples.push(sample);
  }

  if (duplicateCount > 0) {
    console.log(`[user-dataset-builder] Removed ${duplicateCount} duplicate samples`);
  }

  // 4. Write output
  mkdirpSync(path.dirname(args.output));
  const outputLines = uniqueSamples.map(s => JSON.stringify(s)).join('\n');
  fs.writeFileSync(args.output, outputLines, 'utf-8');

  console.log(`[user-dataset-builder] ✅ Dataset complete: ${uniqueSamples.length} unique samples`);
  console.log(`[user-dataset-builder] Written to: ${args.output}`);
}

// Main execution
const args = parseArgs();
buildDataset(args).catch(err => {
  console.error('[user-dataset-builder] Fatal error:', err);
  process.exit(1);
});
