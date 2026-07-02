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
import { withUserContext, getUserContext } from '@metahuman/core/context';
import { requireUserInfo } from '@metahuman/core/user-resolver';
import { audit } from '@metahuman/core/audit';
import { systemPaths } from '@metahuman/core/paths';

interface TrainingDataConfig {
  memoryTypes: {
    percentages: Record<string, number>;
  };
}

/**
 * Load training data configuration from etc/training.json (unified config)
 * This controls which memory types are included and their sampling weights
 */
function loadTrainingDataConfig(): TrainingDataConfig {
  const configPath = path.join(systemPaths.etc, 'training.json');

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
      console.log('[curated-aggregator] Loaded training config from etc/training.json');

      // Support both old flat structure and new nested structure
      const percentages = config.data?.memoryTypes?.percentages || config.memoryTypes?.percentages;

      if (percentages) {
        console.log('[curated-aggregator] Memory type percentages:');
        for (const [type, pct] of Object.entries(percentages)) {
          if (typeof pct === 'number' && pct > 0) {
            console.log(`  - ${type}: ${pct}%`);
          }
        }
      }

      return {
        memoryTypes: {
          percentages: percentages || defaults.memoryTypes.percentages,
        },
      };
    }
  } catch (error) {
    console.warn('[curated-aggregator] Failed to load training config, using defaults:', error);
  }

  console.log('[curated-aggregator] Using default training data config (user-focused)');
  return defaults;
}

/**
 * Filter and sample samples using "pie chart" logic:
 * 1. PRIMARY types (conversation, observation, therapy_session) = 100% included (user voice)
 * 2. SECONDARY types (reflection, inner_dialogue, etc.) = capped as percentage OF primary
 *
 * This ensures we never throw away valuable user-generated content while
 * limiting LLM-generated content to a reasonable supplemental ratio.
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

  // PRIMARY types: user-generated content - include 100%
  const primaryTypes = ['conversation', 'observation', 'therapy_session', 'journal'];
  // SECONDARY types: LLM-generated or supplemental - cap as percentage of primary
  const secondaryTypes = ['reflection', 'reflection_summary', 'inner_dialogue', 'dream', 'curiosity_question', 'decision', 'summary'];

  const filtered: CuratedSample[] = [];
  const processedTypes = new Set<string>();

  // Step 1: Include ALL primary types (user voice = most valuable)
  let primaryCount = 0;
  for (const type of primaryTypes) {
    processedTypes.add(type);
    const available = byType[type] || [];
    if (available.length > 0) {
      filtered.push(...available);
      primaryCount += available.length;
      console.log(`[curated-aggregator] PRIMARY: Included ALL ${available.length} ${type} samples (100%)`);
    }
  }

  console.log(`[curated-aggregator] Total primary (user voice) samples: ${primaryCount}`);

  // Step 2: Add secondary types as a RATIO of primary data
  // If primary = 800, and inner_dialogue has 3% weight, we add 800 * 0.03 = 24 samples
  // This prevents LLM-generated content from overwhelming user voice
  const secondaryPctTotal = secondaryTypes.reduce((sum, t) => sum + (percentages[t] || 0), 0);

  if (secondaryPctTotal > 0 && primaryCount > 0) {
    for (const type of secondaryTypes) {
      processedTypes.add(type);
      const pct = percentages[type] || 0;
      if (pct === 0) continue;

      const available = byType[type] || [];
      if (available.length === 0) continue;

      // Calculate target as percentage of primary data
      // e.g., if primary=800 and inner_dialogue=3%, target = 800 * 0.03 = 24
      const targetCount = Math.round(primaryCount * (pct / 100));

      if (targetCount === 0) continue;

      // Shuffle and take up to targetCount
      const shuffled = [...available].sort(() => Math.random() - 0.5);
      const taken = shuffled.slice(0, Math.min(targetCount, available.length));
      filtered.push(...taken);

      if (taken.length > 0) {
        console.log(`[curated-aggregator] SECONDARY: Sampled ${taken.length}/${available.length} ${type} samples (${pct}% of primary = target ${targetCount})`);
      }
    }
  }

  // Step 3: Handle unmapped types - include them as primary (assume user content)
  const unmappedTypes = Object.keys(byType).filter(t => !processedTypes.has(t));
  if (unmappedTypes.length > 0) {
    console.log(`[curated-aggregator] Found unmapped source types: ${unmappedTypes.join(', ')}`);
    for (const type of unmappedTypes) {
      const available = byType[type] || [];
      if (available.length > 0) {
        filtered.push(...available);
        console.log(`[curated-aggregator] UNMAPPED: Included ALL ${available.length} ${type} samples (treated as primary)`);
      }
    }
  }

  // Step 4: Apply maxTotal cap if needed (safety limit)
  let finalSamples = filtered;
  if (filtered.length > maxTotal) {
    console.log(`[curated-aggregator] Applying maxTotal cap: ${filtered.length} -> ${maxTotal}`);
    // Shuffle and cap, but this should rarely happen with new logic
    finalSamples = [...filtered].sort(() => Math.random() - 0.5).slice(0, maxTotal);
  }

  console.log(`[curated-aggregator] Total after filtering: ${finalSamples.length} samples (from ${samples.length} total)`);

  // Final shuffle to mix types
  return finalSamples.sort(() => Math.random() - 0.5);
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
    console.error('Check your memory type percentages in etc/training.json → data.memoryTypes.percentages');
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
