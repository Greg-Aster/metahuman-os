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
import { systemPaths } from '../../packages/core/src/paths.js';

interface TrainingDataConfig {
  memoryTypes: {
    percentages: Record<string, number>;
  };
}

/**
 * Load training data configuration from etc/training-data.json
 * This controls which memory types are included and their sampling weights
 */
function loadTrainingDataConfig(): TrainingDataConfig {
  const configPath = path.join(systemPaths.etc, 'training-data.json');

  const defaults: TrainingDataConfig = {
    memoryTypes: {
      percentages: {
        conversation: 50,
        observation: 30,
        therapy_session: 15,
        reflection: 2,
        reflection_summary: 1,
        inner_dialogue: 1,
        dream: 0,
        curiosity_question: 1,
        decision: 0,
        journal: 0,
        summary: 0,
      },
    },
  };

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      console.log('[curated-aggregator] Loaded training data config from etc/training-data.json');

      if (config.memoryTypes?.percentages) {
        console.log('[curated-aggregator] Memory type percentages:');
        for (const [type, pct] of Object.entries(config.memoryTypes.percentages)) {
          if ((pct as number) > 0) {
            console.log(`  - ${type}: ${pct}%`);
          }
        }
      }

      return {
        memoryTypes: {
          percentages: config.memoryTypes?.percentages || defaults.memoryTypes.percentages,
        },
      };
    }
  } catch (error) {
    console.warn('[curated-aggregator] Failed to load training data config, using defaults:', error);
  }

  console.log('[curated-aggregator] Using default training data config (user-focused)');
  return defaults;
}

/**
 * Filter and sample samples according to training data config percentages
 * This ensures the training data is weighted toward user inputs
 */
function sampleBySourceType(samples: CuratedSample[], config: TrainingDataConfig, maxTotal: number): CuratedSample[] {
  const rawPercentages = config.memoryTypes.percentages;

  // Filter out non-numeric values (like _comment fields in JSON)
  const percentages: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawPercentages)) {
    if (typeof value === 'number') {
      percentages[key] = value;
    }
  }

  // Group samples by source_type
  const byType: Record<string, CuratedSample[]> = {};
  for (const sample of samples) {
    const type = sample.metadata.source_type || 'unknown';
    if (!byType[type]) byType[type] = [];
    byType[type].push(sample);
  }

  console.log('[curated-aggregator] Samples by source_type before filtering:');
  for (const [type, items] of Object.entries(byType)) {
    console.log(`  - ${type}: ${items.length}`);
  }

  // Calculate how many to take from each type based on percentages
  const filtered: CuratedSample[] = [];
  const totalPct = Object.values(percentages).reduce((sum, p) => sum + p, 0);

  if (totalPct === 0) {
    console.warn('[curated-aggregator] All percentages are 0, returning empty dataset');
    return [];
  }

  // Track which types we've processed
  const processedTypes = new Set<string>();

  for (const [type, pct] of Object.entries(percentages)) {
    processedTypes.add(type);
    const targetCount = Math.round((pct / totalPct) * maxTotal);
    const available = byType[type] || [];

    if (targetCount === 0 || available.length === 0) continue;

    // Shuffle and take up to targetCount
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const taken = shuffled.slice(0, Math.min(targetCount, available.length));
    filtered.push(...taken);

    if (taken.length > 0) {
      console.log(`[curated-aggregator] Sampled ${taken.length}/${available.length} ${type} samples (target: ${targetCount} at ${pct}%)`);
    }
  }

  // Handle unmapped types (action, fragment, unknown, etc.) - include them under 'conversation' quota
  // This ensures we don't lose valuable training data that has non-standard source_type values
  const unmappedTypes = Object.keys(byType).filter(t => !processedTypes.has(t));
  if (unmappedTypes.length > 0) {
    console.log(`[curated-aggregator] Found unmapped source types: ${unmappedTypes.join(', ')}`);
    // Include unmapped types proportionally to remaining quota
    const currentCount = filtered.length;
    const remainingQuota = Math.max(0, maxTotal - currentCount);
    if (remainingQuota > 0) {
      const unmappedSamples: CuratedSample[] = [];
      for (const type of unmappedTypes) {
        unmappedSamples.push(...byType[type]);
      }
      const shuffled = [...unmappedSamples].sort(() => Math.random() - 0.5);
      const taken = shuffled.slice(0, Math.min(remainingQuota, unmappedSamples.length));
      filtered.push(...taken);
      if (taken.length > 0) {
        console.log(`[curated-aggregator] Added ${taken.length} samples from unmapped types`);
      }
    }
  }

  console.log(`[curated-aggregator] Total after filtering: ${filtered.length} samples (from ${samples.length} total)`);

  // Final shuffle to mix types
  return filtered.sort(() => Math.random() - 0.5);
}

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

      // Normalize legacy files missing cognitiveMode (pre-Nov 24, 2025)
      if (!conversation.cognitiveMode) {
        conversation.cognitiveMode = 'dual'; // Default for legacy files
        console.warn(`[curated-aggregator] Legacy file ${file} missing cognitiveMode, defaulting to 'dual'`);
      }

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

  // Load training data config for memory type filtering
  const trainingDataConfig = loadTrainingDataConfig();

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

  // Convert to training samples (no max limit yet - we'll filter after)
  const rawSamples = convertToTrainingSamples(conversations, { modeFilter });
  console.log(`[curated-aggregator] Generated ${rawSamples.length} raw training samples`);

  // Apply memory type filtering based on user-configured percentages
  // This ensures training data is weighted toward user inputs (conversations, observations)
  const targetSamples = maxSamples || rawSamples.length;
  const samples = sampleBySourceType(rawSamples, trainingDataConfig, targetSamples);

  if (samples.length === 0) {
    console.error('[curated-aggregator] ERROR: No samples remaining after type filtering!');
    console.error('Check your memory type percentages in etc/training-data.json');
    process.exit(1);
  }

  // Show mode distribution
  const modeCounts = samples.reduce((acc, s) => {
    acc[s.mode] = (acc[s.mode] || 0) + 1;
    return acc;
  }, {} as Record<CognitiveMode, number>);

  console.log(`[curated-aggregator] Mode distribution after filtering:`);
  for (const [mode, count] of Object.entries(modeCounts)) {
    console.log(`  - ${mode}: ${count} samples (${Math.round((count / samples.length) * 100)}%)`);
  }

  // Show source_type distribution after filtering
  const typeCounts = samples.reduce((acc, s) => {
    const type = s.metadata.source_type || 'unknown';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log(`[curated-aggregator] Source type distribution after filtering:`);
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`  - ${type}: ${count} samples (${Math.round((count / samples.length) * 100)}%)`);
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
