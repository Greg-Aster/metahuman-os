/**
 * Memory Curator - Clean and prepare memories for fine-tuning
 *
 * Responsibilities:
 * 1. Load episodic memories from user profile
 * 2. Assign cognitive mode based on memory type
 * 3. Clean and trim assistant responses
 * 4. Preserve user input exactly
 * 5. Remove filler phrases
 * 6. Break multi-turn conversations into single pairs
 * 7. Output curated memories with mode metadata
 */

import fs from 'node:fs';
import path from 'node:path';
import { withUserContext, getUserContext } from '../../packages/core/src/context.js';
import { requireUserInfo } from '../../packages/core/src/user-resolver.js';
import { audit } from '../../packages/core/src/audit.js';
import { calculateQualityMetrics } from '../../packages/core/src/mode-validator.js';

export type CognitiveMode = 'dual' | 'emulation' | 'agent';

export interface CuratedSample {
  mode: CognitiveMode;
  user_text: string;
  assistant_text: string;
  metadata: {
    original_id: string;
    source_type: string;
    multi_turn: boolean;
    long_output: boolean;
    timestamp?: string;
    [key: string]: any;
  };
}

interface MemoryRecord {
  id: string;
  type: string;
  timestamp: string;
  content?: string;
  response?: string;
  prompt?: string;
  observation?: string;
  question?: string;
  answer?: string;
  messages?: Array<{ role: string; content: string }>;
  [key: string]: any;
}

// Memory type to cognitive mode mapping
const MODE_MAPPING: Record<string, CognitiveMode> = {
  'inner_dialogue': 'dual',
  'reflection': 'dual',
  'dream': 'dual',
  'conversation': 'emulation',
  'chat': 'emulation',
  'observation': 'emulation',
  'journal': 'emulation',
  'action': 'agent',
  'task': 'agent',
  'tool_use': 'agent',
};

// Filler phrases to remove from assistant responses
const FILLER_PHRASES: RegExp[] = [
  /^(okay|ok|alright|sure)[,;:\-\s]*/i,
  /^so[,;:\s-]*/i,
  /^let me (?:start|think|figure)[^,.!?]*[,;:\-\s]*/i,
  /^i'm just (?:here to|an ai)[^,.!?]*[,;:\-\s]*/i,
  /^as an? (?:ai|language model)[^,.!?]*[,;:\-\s]*/i,
  /^certainly[,;:\-\s]*/i,
  /^here's what[^,.!?]*[,;:\-\s]*/i,
];

const OUTPUT_WORD_LIMIT_SHORT = 40; // Default: 1-3 sentences
const OUTPUT_WORD_LIMIT_LONG = 300; // Long-form allowed

/**
 * Remove filler phrases from text
 */
function cleanFillers(text: string): string {
  let cleaned = text;
  for (const pattern of FILLER_PHRASES) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned.trim();
}

/**
 * Trim text to word limit
 */
function trimToWordLimit(text: string, limit: number): string {
  const words = text.split(/\s+/);
  if (words.length <= limit) return text;

  return words.slice(0, limit).join(' ') + '...';
}

/**
 * Normalize whitespace
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Determine if this sample should be long-form (5-10% of samples)
 */
function shouldBeLongForm(): boolean {
  return Math.random() < 0.075; // 7.5% chance
}

/**
 * Extract user/assistant pairs from memory record
 */
function extractPairs(memory: MemoryRecord): Array<{ user: string; assistant: string }> {
  const pairs: Array<{ user: string; assistant: string }> = [];

  // Handle multi-turn conversations (messages array)
  if (memory.messages && Array.isArray(memory.messages)) {
    let userMsg: string | null = null;

    for (const msg of memory.messages) {
      if (msg.role === 'user') {
        userMsg = msg.content;
      } else if (msg.role === 'assistant' && userMsg) {
        pairs.push({ user: userMsg, assistant: msg.content });
        userMsg = null;
      }
    }
  }
  // Handle simple prompt/response format
  else if (memory.prompt && memory.response) {
    pairs.push({ user: memory.prompt, assistant: memory.response });
  }
  // Handle content/response format
  else if (memory.content && memory.response) {
    pairs.push({ user: memory.content, assistant: memory.response });
  }
  // Handle question/answer format
  else if (memory.question && memory.answer) {
    pairs.push({ user: memory.question, assistant: memory.answer });
  }
  // Handle observation format (create synthetic question)
  else if (memory.observation) {
    pairs.push({
      user: 'What did you observe?',
      assistant: memory.observation,
    });
  }

  return pairs;
}

/**
 * Curate a single assistant response
 */
function curateAssistantText(text: string, allowLongForm: boolean): string {
  // Remove filler phrases
  let cleaned = cleanFillers(text);

  // Normalize whitespace
  cleaned = normalizeWhitespace(cleaned);

  // Trim to appropriate length
  const limit = allowLongForm ? OUTPUT_WORD_LIMIT_LONG : OUTPUT_WORD_LIMIT_SHORT;
  cleaned = trimToWordLimit(cleaned, limit);

  return cleaned;
}

/**
 * Assign cognitive mode based on memory type
 */
function assignMode(memoryType: string): CognitiveMode {
  const type = memoryType.toLowerCase();

  // Check exact match first
  if (type in MODE_MAPPING) {
    return MODE_MAPPING[type];
  }

  // Check partial matches
  for (const [key, mode] of Object.entries(MODE_MAPPING)) {
    if (type.includes(key)) {
      return mode;
    }
  }

  // Default to emulation for unknown types
  return 'emulation';
}

/**
 * Load all episodic memories for a user
 */
function loadEpisodicMemories(episodicDir: string): MemoryRecord[] {
  const memories: MemoryRecord[] = [];

  if (!fs.existsSync(episodicDir)) {
    console.warn(`[memory-curator] Episodic directory not found: ${episodicDir}`);
    return memories;
  }

  /**
   * Recursively walk directory and collect all JSON files
   */
  function walkDirectory(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recurse into subdirectories
        walkDirectory(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        // Load memory file
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const memory = JSON.parse(content) as MemoryRecord;

          // Only include memories with extractable pairs
          const pairs = extractPairs(memory);
          if (pairs.length > 0) {
            memories.push(memory);
          }
        } catch (error) {
          console.warn(`[memory-curator] Failed to load memory ${entry.name}:`, (error as Error).message);
        }
      }
    }
  }

  // Start recursive walk from episodic root
  walkDirectory(episodicDir);

  return memories;
}

/**
 * Curate memories into training samples
 */
function curateMemories(
  memories: MemoryRecord[],
  options: {
    maxSamples?: number;
    modeFilter?: CognitiveMode;
  } = {}
): CuratedSample[] {
  const samples: CuratedSample[] = [];
  let metadataModesUsed = 0;
  let typeModesUsed = 0;

  for (const memory of memories) {
    // Priority: metadata.cognitiveMode → memory type mapping → default to emulation
    let mode: CognitiveMode;
    let modeSource: 'metadata' | 'type';

    if (memory.metadata && memory.metadata.cognitiveMode) {
      // Use explicit cognitive mode from metadata (saved during capture)
      const metaMode = memory.metadata.cognitiveMode;
      if (metaMode === 'dual' || metaMode === 'emulation' || metaMode === 'agent') {
        mode = metaMode;
        modeSource = 'metadata';
        metadataModesUsed++;
      } else {
        // Fall back to type-based assignment if metadata mode is invalid
        mode = assignMode(memory.type);
        modeSource = 'type';
        typeModesUsed++;
      }
    } else {
      // Fall back to type-based assignment if no metadata
      mode = assignMode(memory.type);
      modeSource = 'type';
      typeModesUsed++;
    }

    // Apply mode filter if specified
    if (options.modeFilter && mode !== options.modeFilter) {
      continue;
    }

    // Extract user/assistant pairs
    const pairs = extractPairs(memory);

    for (const pair of pairs) {
      const allowLongForm = shouldBeLongForm();

      // Preserve user text exactly (no modification)
      const userText = normalizeWhitespace(pair.user);

      // Curate assistant text (clean, trim)
      const assistantText = curateAssistantText(pair.assistant, allowLongForm);

      samples.push({
        mode,
        user_text: userText,
        assistant_text: assistantText,
        metadata: {
          original_id: memory.id,
          source_type: memory.type,
          multi_turn: (pairs.length > 1),
          long_output: allowLongForm,
          timestamp: memory.timestamp,
          mode_source: modeSource, // Track if mode came from metadata or type mapping
        },
      });

      // Stop if we've reached max samples
      if (options.maxSamples && samples.length >= options.maxSamples) {
        console.log(`[memory-curator] Mode assignment sources:`);
        console.log(`  - From metadata: ${metadataModesUsed} memories`);
        console.log(`  - From type mapping: ${typeModesUsed} memories`);
        return samples;
      }
    }
  }

  console.log(`[memory-curator] Mode assignment sources:`);
  console.log(`  - From metadata: ${metadataModesUsed} memories`);
  console.log(`  - From type mapping: ${typeModesUsed} memories`);

  return samples;
}

/**
 * Main curator function
 */
async function mainWithContext() {
  const ctx = getUserContext();

  if (!ctx || !ctx.profilePaths) {
    console.error('[memory-curator] ERROR: No user context found');
    process.exit(1);
  }

  // Parse CLI arguments
  const args = process.argv.slice(2);
  let outputPath: string | null = null;
  let maxSamples: number | undefined = undefined;
  let modeFilter: CognitiveMode | undefined = undefined;
  let daysRecent: number | undefined = undefined;
  let oldSamples: number | undefined = undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && i + 1 < args.length) {
      outputPath = args[i + 1];
    } else if (args[i] === '--max' && i + 1 < args.length) {
      maxSamples = parseInt(args[i + 1], 10);
    } else if (args[i] === '--mode' && i + 1 < args.length) {
      const mode = args[i + 1] as CognitiveMode;
      if (['dual', 'emulation', 'agent'].includes(mode)) {
        modeFilter = mode;
      }
    } else if (args[i] === '--days-recent' && i + 1 < args.length) {
      daysRecent = parseInt(args[i + 1], 10);
    } else if (args[i] === '--old-samples' && i + 1 < args.length) {
      oldSamples = parseInt(args[i + 1], 10);
    }
  }

  if (!outputPath) {
    console.error('[memory-curator] ERROR: --output <path> is required');
    process.exit(1);
  }

  console.log(`[memory-curator] Starting curation for user: ${ctx.username}`);
  if (modeFilter) {
    console.log(`[memory-curator] Mode filter: ${modeFilter}`);
  }
  if (maxSamples) {
    console.log(`[memory-curator] Max samples: ${maxSamples}`);
  }

  // Load episodic memories
  const episodicDir = path.join(ctx.profilePaths.memory, 'episodic');
  console.log(`[memory-curator] Loading memories from: ${episodicDir}`);

  let memories: MemoryRecord[];
  let samples: CuratedSample[];

  // Monthly training strategy: mix recent + old samples
  if (daysRecent !== undefined && oldSamples !== undefined) {
    console.log(`[memory-curator] Using monthly training strategy:`);
    console.log(`  - Recent: Last ${daysRecent} days`);
    console.log(`  - Old: ${oldSamples} random samples from before`);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysRecent);

    const allMemories = loadEpisodicMemories(episodicDir);
    const recentMemories: MemoryRecord[] = [];
    const oldMemories: MemoryRecord[] = [];

    for (const memory of allMemories) {
      const memoryDate = new Date(memory.timestamp);
      if (memoryDate >= cutoffDate) {
        recentMemories.push(memory);
      } else {
        oldMemories.push(memory);
      }
    }

    console.log(`[memory-curator] Split memories:`);
    console.log(`  - Recent (${daysRecent} days): ${recentMemories.length} files`);
    console.log(`  - Old (before ${cutoffDate.toISOString().split('T')[0]}): ${oldMemories.length} files`);

    // Randomly sample from old memories
    const shuffled = oldMemories.sort(() => Math.random() - 0.5);
    const sampledOld = shuffled.slice(0, oldSamples);

    console.log(`[memory-curator] Sampled ${sampledOld.length} old memories`);

    // Combine recent + sampled old
    memories = [...recentMemories, ...sampledOld];
    console.log(`[memory-curator] Total memories to curate: ${memories.length}`);

    samples = curateMemories(memories, { maxSamples, modeFilter });
    console.log(`[memory-curator] Generated ${samples.length} training samples`);
    console.log(`  - From recent: ~${Math.round((recentMemories.length / memories.length) * samples.length)}`);
    console.log(`  - From old: ~${Math.round((sampledOld.length / memories.length) * samples.length)}`);
  } else {
    // Default strategy: load all memories
    memories = loadEpisodicMemories(episodicDir);
    console.log(`[memory-curator] Loaded ${memories.length} memory files`);

    samples = curateMemories(memories, { maxSamples, modeFilter });
    console.log(`[memory-curator] Generated ${samples.length} training samples`);
  }

  // Calculate quality metrics
  const metrics = calculateQualityMetrics(samples);
  console.log(`[memory-curator] Quality metrics:`);
  console.log(`  - Avg assistant length: ${metrics.avgAssistantLength} words`);
  console.log(`  - Short samples (<=40 words): ${metrics.shortSamplesPercent}%`);
  console.log(`  - Long samples (>100 words): ${metrics.longSamplesPercent}%`);
  console.log(`  - Filler detected: ${metrics.fillerDetectedPercent}%`);
  console.log(`  - Mode distribution:`);
  console.log(`    - Dual: ${metrics.modeDistribution.dual}%`);
  console.log(`    - Emulation: ${metrics.modeDistribution.emulation}%`);
  console.log(`    - Agent: ${metrics.modeDistribution.agent}%`);

  // Write output
  const outputDir = path.dirname(outputPath);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(samples, null, 2));

  console.log(`[memory-curator] Wrote ${samples.length} curated samples to: ${outputPath}`);

  audit({
    level: 'info',
    category: 'action',
    event: 'memory_curation_completed',
    details: {
      username: ctx.username,
      totalSamples: samples.length,
      metrics,
      outputPath,
    },
    actor: ctx.username,
  });
}

async function main() {
  const args = process.argv.slice(2);
  let username: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      username = args[i + 1];
      break;
    }
  }

  if (!username) {
    console.error('[memory-curator] ERROR: --username <name> is required');
    console.error('\\nUsage: tsx brain/agents/memory-curator.ts --username <username> --output <path> [options]');
    console.error('\\nOptions:');
    console.error('  --max <count>           Maximum samples to generate');
    console.error('  --mode <mode>           Filter by cognitive mode (dual|emulation|agent)');
    console.error('  --days-recent <days>    Use monthly strategy: recent N days');
    console.error('  --old-samples <count>   Use monthly strategy: N random old samples');
    console.error('\\nMonthly training example:');
    console.error('  tsx brain/agents/memory-curator.ts --username greggles --output out.json --days-recent 30 --old-samples 3000');
    process.exit(1);
  }

  const userInfo = requireUserInfo(username);
  await withUserContext(userInfo, mainWithContext);
}

main().catch(err => {
  console.error('[memory-curator] Fatal error:', err);
  process.exit(1);
});
