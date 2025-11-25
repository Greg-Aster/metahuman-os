/**
 * Curated Aggregator - Aggregates LLM-curated conversations for training
 *
 * This agent replaces the old memory-curator.ts by reading from the
 * curated conversations directory (output of curator.ts) and converting
 * them into the training format expected by the rest of the pipeline.
 *
 * Input: /memory/curated/conversations/*.json (from curator.ts)
 * Output: CuratedSample[] format for mode-formatter
 */

import fs from 'node:fs';
import path from 'node:path';
import { withUserContext, getUserContext } from '../../packages/core/src/context.js';
import { requireUserInfo } from '../../packages/core/src/user-resolver.js';
import { audit } from '../../packages/core/src/audit.js';

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
    curated_at?: string;
    [key: string]: any;
  };
}

interface CuratedConversation {
  id: string;
  originalTimestamp: string;
  conversationalEssence: string;
  context: string;
  userMessage: string;
  assistantResponse: string;
  curatedAt: string;
  flags: string[];
  suitableForTraining: boolean;
  cognitiveMode: CognitiveMode;
  memoryType: string;
}

/**
 * Load all curated conversations from the conversations directory
 */
function loadCuratedConversations(curatedDir: string): CuratedConversation[] {
  const conversations: CuratedConversation[] = [];

  if (!fs.existsSync(curatedDir)) {
    console.warn(`[curated-aggregator] Curated directory not found: ${curatedDir}`);
    return conversations;
  }

  const files = fs.readdirSync(curatedDir);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const filePath = path.join(curatedDir, file);

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const conversation = JSON.parse(content) as CuratedConversation;

      // Only include conversations marked suitable for training
      if (conversation.suitableForTraining) {
        conversations.push(conversation);
      }
    } catch (error) {
      console.warn(`[curated-aggregator] Failed to load conversation ${file}:`, (error as Error).message);
    }
  }

  return conversations;
}

/**
 * Convert curated conversations to training samples
 */
function convertToTrainingSamples(
  conversations: CuratedConversation[],
  options: {
    maxSamples?: number;
    modeFilter?: CognitiveMode;
  } = {}
): CuratedSample[] {
  const samples: CuratedSample[] = [];

  for (const conversation of conversations) {
    // Apply mode filter if specified
    if (options.modeFilter && conversation.cognitiveMode !== options.modeFilter) {
      continue;
    }

    // Determine if this is a long output (based on word count)
    const assistantWords = conversation.assistantResponse.split(/\s+/).length;
    const isLongOutput = assistantWords > 40;

    // Dual-consciousness mode: Flip the pairs (as in old curator)
    // This trains the model to internalize user patterns
    const finalUserText = conversation.cognitiveMode === 'dual'
      ? conversation.assistantResponse
      : conversation.userMessage;

    const finalAssistantText = conversation.cognitiveMode === 'dual'
      ? conversation.userMessage
      : conversation.assistantResponse;

    samples.push({
      mode: conversation.cognitiveMode,
      user_text: finalUserText,
      assistant_text: finalAssistantText,
      metadata: {
        original_id: conversation.id,
        source_type: conversation.memoryType,
        multi_turn: false, // Curator output is always single-turn pairs
        long_output: isLongOutput,
        timestamp: conversation.originalTimestamp,
        curated_at: conversation.curatedAt,
        pair_flipped: conversation.cognitiveMode === 'dual',
        conversational_essence: conversation.conversationalEssence,
        context: conversation.context,
      },
    });

    // Stop if we've reached max samples
    if (options.maxSamples && samples.length >= options.maxSamples) {
      break;
    }
  }

  return samples;
}

/**
 * Main aggregator function
 */
async function mainWithContext() {
  const ctx = getUserContext();

  if (!ctx || !ctx.profilePaths) {
    console.error('[curated-aggregator] ERROR: No user context found');
    process.exit(1);
  }

  // Parse CLI arguments
  const args = process.argv.slice(2);
  let outputPath: string | null = null;
  let maxSamples: number | undefined = undefined;
  let modeFilter: CognitiveMode | undefined = undefined;

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
    }
  }

  if (!outputPath) {
    console.error('[curated-aggregator] ERROR: --output <path> is required');
    console.error('This aggregator must be given an explicit output path by the training orchestrator');
    process.exit(1);
  }

  console.log(`[curated-aggregator] Starting aggregation for user: ${ctx.username}`);
  if (modeFilter) {
    console.log(`[curated-aggregator] Mode filter: ${modeFilter}`);
  }
  if (maxSamples) {
    console.log(`[curated-aggregator] Max samples: ${maxSamples}`);
  }

  // Load curated conversations
  const curatedDir = path.join(ctx.profilePaths.memory, 'curated', 'conversations');
  console.log(`[curated-aggregator] Loading curated conversations from: ${curatedDir}`);

  const conversations = loadCuratedConversations(curatedDir);
  console.log(`[curated-aggregator] Found ${conversations.length} curated conversations`);

  if (conversations.length === 0) {
    console.error('[curated-aggregator] ERROR: No curated conversations found!');
    console.error('Run the curator agent first to generate curated conversations:');
    console.error(`  tsx brain/agents/curator.ts --username ${ctx.username}`);
    process.exit(1);
  }

  // Convert to training samples
  const samples = convertToTrainingSamples(conversations, { maxSamples, modeFilter });
  console.log(`[curated-aggregator] Generated ${samples.length} training samples`);

  // Show mode distribution
  const modeCounts = samples.reduce((acc, s) => {
    acc[s.mode] = (acc[s.mode] || 0) + 1;
    return acc;
  }, {} as Record<CognitiveMode, number>);

  console.log(`[curated-aggregator] Mode distribution:`);
  for (const [mode, count] of Object.entries(modeCounts)) {
    console.log(`  - ${mode}: ${count} samples (${Math.round((count / samples.length) * 100)}%)`);
  }

  // Write output
  fs.writeFileSync(outputPath, JSON.stringify(samples, null, 2));
  console.log(`[curated-aggregator] Wrote ${samples.length} samples to: ${outputPath}`);

  audit({
    category: 'action',
    level: 'info',
    event: 'curated_aggregator_completed',
    actor: ctx.username,
    details: {
      username: ctx.username,
      conversationsLoaded: conversations.length,
      samplesGenerated: samples.length,
      modeFilter,
      maxSamples,
      outputPath,
    },
  });
}

/**
 * Main entry point
 */
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
    console.error('[curated-aggregator] ERROR: --username <name> is required');
    console.error('\nUsage: tsx brain/agents/curated-aggregator.ts --username <username> --output <path> [options]');
    console.error('\nOptions:');
    console.error('  --max <count>           Maximum samples to generate');
    console.error('  --mode <mode>           Filter by cognitive mode (dual|emulation|agent)');
    console.error('\nExample:');
    console.error('  tsx brain/agents/curated-aggregator.ts --username greggles --output out.json --max 5000');
    process.exit(1);
  }

  const userInfo = requireUserInfo(username);
  await withUserContext(userInfo, mainWithContext);
}

main().catch(err => {
  console.error('[curated-aggregator] Fatal error:', err);
  process.exit(1);
});
