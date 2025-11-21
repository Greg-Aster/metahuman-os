/**
 * User-Aware Adapter Builder Agent with Curator Integration
 *
 * Builds high-quality curated instruction→response pairs from user-specific data:
 * - Therapy sessions (highest priority)
 * - Episodic memories
 * - Chat conversations
 *
 * Uses configurable curator model to evaluate, filter, and improve training samples.
 */

import fs from 'node:fs';
import path from 'node:path';
import { audit, callLLM, systemPaths } from '../../packages/core/src/index.js';
import { getUserContext, withUserContext } from '../../packages/core/src/context.js';
import { requireUserInfo } from '../../packages/core/src/user-resolver.js';
import {
  collectAllUserData,
  loadPersonaData,
  extractTherapyInsights,
  generateAllVariedPrompts,
  type RawTrainingSample,
} from '../../packages/core/src/user-data-collector.js';
import {
  CURATOR_SYSTEM_PROMPT,
  buildBatchCurationPrompt,
  buildPersonaSummary,
  type CurationCriteria,
  type CuratedSample,
} from '../../packages/core/src/curator-prompts.js';

/**
 * Training data configuration interface
 */
interface TrainingDataConfig {
  curator: {
    batchSize: number;
    qualityThreshold: number;
    temperature: number;
  };
  collection: {
    maxDays: number;
    maxSamplesPerSource: number;
  };
  memoryTypes: {
    enabled: string[];
    priorities: Record<string, number>;
  };
}

/**
 * Load training data configuration from etc/training-data.json
 */
function loadTrainingConfig(): TrainingDataConfig {
  const configPath = path.join(systemPaths.etc, 'training-data.json');

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      console.log('[adapter-builder] Loaded training data config from etc/training-data.json');
      console.log(`[adapter-builder] - Batch size: ${config.curator.batchSize}`);
      console.log(`[adapter-builder] - Max samples per source: ${config.collection.maxSamplesPerSource}`);
      console.log(`[adapter-builder] - Quality threshold: ${config.curator.qualityThreshold}`);
      return config;
    }
  } catch (error) {
    console.warn('[adapter-builder] Failed to load config, using defaults:', error);
  }

  // Default configuration (Phase 2 optimal settings)
  console.log('[adapter-builder] Using default Phase 2 optimal settings');
  return {
    curator: {
      batchSize: 100,
      qualityThreshold: 6.0,
      temperature: 0.3,
    },
    collection: {
      maxDays: 999999,
      maxSamplesPerSource: 3000,
    },
    memoryTypes: {
      enabled: [
        'conversation',
        'observation',
        'reflection',
        'reflection_summary',
        'inner_dialogue',
        'decision',
        'dream',
        'journal',
        'curiosity_question',
        'summary',
      ],
      priorities: {
        therapy_session: 10,
        conversation: 9,
        inner_dialogue: 8,
        reflection: 7,
      },
    },
  };
}

/**
 * Statistics for curation process
 */
interface CurationStats {
  totalReviewed: number;
  totalFiltered: number;
  totalKept: number;
  averageQuality: number;
  bySource: Record<string, { count: number; avgQuality: number }>;
}

/**
 * Curate a batch of training samples using the curator model
 *
 * Sends samples to curator with comprehensive instructions,
 * receives back quality-scored and improved samples.
 */
async function curateBatch(
  samples: RawTrainingSample[],
  personaSummary: string,
  config: TrainingDataConfig,
  therapyInsights?: string
): Promise<CuratedSample[]> {
  if (samples.length === 0) {
    return [];
  }

  // Build curator prompt with batch of samples
  const batchPrompt = buildBatchCurationPrompt(samples, personaSummary, therapyInsights);

  try {
    // Call curator model (configurable via status widget)
    const response = await callLLM({
      role: 'curator',
      messages: [
        { role: 'system', content: CURATOR_SYSTEM_PROMPT },
        { role: 'user', content: batchPrompt },
      ],
      options: {
        temperature: config.curator.temperature,
        response_format: { type: 'json_object' },
      },
    });

    // Parse curator's response
    const result = JSON.parse(response.content);

    if (!result.samples || !Array.isArray(result.samples)) {
      console.warn('[adapter-builder] Curator returned invalid format, using original samples');
      // Fallback: return samples with default quality scores
      return samples.map((s) => ({
        ...s,
        quality_score: 5.0,
        improvements_made: [],
      }));
    }

    return result.samples as CuratedSample[];
  } catch (error) {
    console.error('[adapter-builder] Curator error:', error);
    console.warn('[adapter-builder] Using original samples without curation');

    // Fallback: return samples with default quality scores
    return samples.map((s) => ({
      ...s,
      quality_score: 5.0,
      improvements_made: [],
    }));
  }
}

/**
 * Process all user data through curator in batches
 */
async function curateAllData(
  rawSamples: RawTrainingSample[],
  personaSummary: string,
  config: TrainingDataConfig,
  therapyInsights?: string
): Promise<{ curated: CuratedSample[]; stats: CurationStats }> {
  const stats: CurationStats = {
    totalReviewed: 0,
    totalFiltered: 0,
    totalKept: 0,
    averageQuality: 0,
    bySource: {},
  };

  const allCurated: CuratedSample[] = [];

  console.log(`[adapter-builder] Starting curation of ${rawSamples.length} samples...`);

  // Process in batches
  for (let i = 0; i < rawSamples.length; i += config.curator.batchSize) {
    const batch = rawSamples.slice(i, i + config.curator.batchSize);
    console.log(`[adapter-builder] Curating batch ${Math.floor(i / config.curator.batchSize) + 1}/${Math.ceil(rawSamples.length / config.curator.batchSize)} (${batch.length} samples)...`);

    const curated = await curateBatch(batch, personaSummary, config, therapyInsights);
    allCurated.push(...curated);

    stats.totalReviewed += batch.length;
  }

  // Filter by quality threshold
  const kept: CuratedSample[] = [];
  let totalQuality = 0;

  for (const sample of allCurated) {
    const score = sample.quality_score || 0;

    // Always keep therapy sessions (highest quality data source)
    // Apply threshold to other sources
    const isTherapy = sample.metadata?.source === 'therapy_session';
    const meetsThreshold = score >= config.curator.qualityThreshold;

    if (isTherapy || meetsThreshold) {
      kept.push(sample);
      totalQuality += score;

      // Track by source
      const source = sample.metadata?.source || 'unknown';
      if (!stats.bySource[source]) {
        stats.bySource[source] = { count: 0, avgQuality: 0 };
      }
      stats.bySource[source].count++;
    }
  }

  stats.totalKept = kept.length;
  stats.totalFiltered = stats.totalReviewed - stats.totalKept;
  stats.averageQuality = stats.totalKept > 0 ? totalQuality / stats.totalKept : 0;

  // Calculate average quality by source
  for (const source of Object.keys(stats.bySource)) {
    const sourceSamples = kept.filter((s) => s.metadata?.source === source);
    const sourceTotal = sourceSamples.reduce((sum, s) => sum + (s.quality_score || 0), 0);
    stats.bySource[source].avgQuality = sourceTotal / sourceSamples.length;
  }

  return { curated: kept, stats };
}

/**
 * Write curated dataset to JSONL format
 */
function writeCuratedDataset(
  samples: CuratedSample[],
  outputDir: string,
  stats: CurationStats,
  config: TrainingDataConfig
): string {
  fs.mkdirSync(outputDir, { recursive: true });

  // Write instructions.jsonl (training format)
  const instructionsPath = path.join(outputDir, 'instructions.jsonl');
  const lines = samples.map((s) =>
    JSON.stringify({
      instruction: s.instruction,
      input: s.input || '',
      output: s.output,
    })
  );
  fs.writeFileSync(instructionsPath, lines.join('\n'), 'utf-8');

  // Write metadata with quality scores
  const metadataPath = path.join(outputDir, 'metadata.json');
  const metadata = {
    pairCount: samples.length,
    createdAt: new Date().toISOString(),
    qualityThreshold: config.curator.qualityThreshold,
    averageQuality: stats.averageQuality,
    bySource: stats.bySource,
    samples: samples.map((s) => ({
      instruction: s.instruction.substring(0, 100),
      quality_score: s.quality_score,
      improvements_made: s.improvements_made,
      source: s.metadata?.source,
      category: s.metadata?.category,
    })),
  };
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

  // Write curation statistics
  const statsPath = path.join(outputDir, 'curation-stats.json');
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2), 'utf-8');

  console.log(`\n[adapter-builder] Curation Statistics:`);
  console.log(`  Reviewed: ${stats.totalReviewed} samples`);
  console.log(`  Filtered out: ${stats.totalFiltered} samples (${((stats.totalFiltered / stats.totalReviewed) * 100).toFixed(1)}%)`);
  console.log(`  Kept: ${stats.totalKept} samples`);
  console.log(`  Average quality score: ${stats.averageQuality.toFixed(2)}/10`);
  console.log(`\n  Breakdown by source:`);
  for (const [source, data] of Object.entries(stats.bySource)) {
    console.log(`    - ${source}: ${data.count} samples (avg quality: ${data.avgQuality.toFixed(2)})`);
  }

  return instructionsPath;
}

/**
 * Main adapter builder entry point (runs within user context)
 */
async function mainWithContext() {
  const ctx = getUserContext();

  if (!ctx) {
    console.error('[adapter-builder] ERROR: No user context found.');
    console.error('[adapter-builder] This agent must be run with user context.');
    process.exit(1);
  }

  console.log(`[adapter-builder] Building curated dataset for user: ${ctx.username}`);

  if (!ctx.profilePaths) {
    console.error('[adapter-builder] ERROR: User context missing profilePaths');
    process.exit(1);
  }

  // Load training data configuration
  const config = loadTrainingConfig();

  await audit({
    level: 'info',
    category: 'action',
    event: 'adapter_builder_started',
    actor: ctx.username,
    details: {
      userId: ctx.userId,
      username: ctx.username,
      config: {
        batchSize: config.curator.batchSize,
        maxSamples: config.collection.maxSamplesPerSource,
        qualityThreshold: config.curator.qualityThreshold,
      },
    },
  });

  // Step 1: Load context data FIRST (needed for prompt generation)
  const profileRoot = ctx.profilePaths.root;
  const personaData = loadPersonaData(profileRoot);
  const personaSummary = buildPersonaSummary(personaData);

  const therapyDir = path.join(profileRoot, 'persona', 'therapy');
  const therapyInsights = extractTherapyInsights(therapyDir);

  // Step 2: Generate varied prompts using LLM for maximum diversity (BEFORE data collection)
  console.log(`[adapter-builder] Pre-generating varied prompts for all memory types...`);
  await generateAllVariedPrompts(therapyInsights);

  // Step 3: Collect all user data (now uses generated prompts)
  const rawSamples = collectAllUserData(profileRoot, {
    maxDays: config.collection.maxDays,
    maxSamplesPerSource: config.collection.maxSamplesPerSource,
  });

  if (rawSamples.length === 0) {
    console.warn('[adapter-builder] No training data found.');
    console.warn('[adapter-builder] Ensure user has:');
    console.warn('[adapter-builder]   - Therapy sessions in persona/therapy/');
    console.warn('[adapter-builder]   - Episodic memories in memory/episodic/');
    console.warn('[adapter-builder]   - Chat conversations in memory/training/');

    await audit({
      level: 'warn',
      category: 'action',
      event: 'adapter_builder_no_data',
      actor: ctx.username,
      details: { reason: 'no_data_found' },
    });

    process.exit(1);
  }

  console.log(`[adapter-builder] Collected ${rawSamples.length} raw training samples`);
  console.log(`[adapter-builder] Starting curation process with curator model...`);
  if (therapyInsights) {
    console.log(`[adapter-builder] Using therapy session insights to guide curation`);
  }

  // Curate data in batches
  const { curated, stats } = await curateAllData(rawSamples, personaSummary, config, therapyInsights);

  if (curated.length === 0) {
    console.error('[adapter-builder] ERROR: No samples passed quality threshold.');
    console.error(`[adapter-builder] Quality threshold: ${config.curator.qualityThreshold}/10`);

    await audit({
      level: 'error',
      category: 'action',
      event: 'adapter_builder_failed',
      actor: ctx.username,
      details: { reason: 'all_samples_filtered', threshold: config.curator.qualityThreshold },
    });

    process.exit(1);
  }

  // Write curated dataset to user-specific output directory
  const timestamp = new Date().toISOString().split('T')[0];
  const outputDir = path.join(profileRoot, 'out', 'adapters', timestamp);
  const datasetPath = writeCuratedDataset(curated, outputDir, stats, config);

  await audit({
    level: 'info',
    category: 'action',
    event: 'adapter_builder_completed',
    actor: ctx.username,
    details: {
      userId: ctx.userId,
      username: ctx.username,
      sampleCount: curated.length,
      datasetPath,
      averageQuality: stats.averageQuality,
      outputDir,
    },
  });

  console.log(`\n[adapter-builder] SUCCESS: Curated dataset written to:`);
  console.log(`  ${datasetPath}`);
  console.log(`\n[adapter-builder] Dataset contains ${curated.length} high-quality samples`);
  console.log(`[adapter-builder] Ready for LoRA training!`);
}

/**
 * CLI entry point - parses --username and establishes user context
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
    console.error('[adapter-builder] ERROR: --username <name> is required');
    console.error('\nUsage: npx tsx brain/agents/adapter-builder.ts --username <username>');
    process.exit(1);
  }

  const userInfo = requireUserInfo(username);
  console.log(`[adapter-builder] Starting for user: ${username}`);

  await withUserContext(userInfo, mainWithContext);
}

// Run main
main().catch((err: Error) => {
  console.error('[adapter-builder] Fatal error:', err);
  audit({
    level: 'error',
    category: 'action',
    event: 'adapter_builder_failed',
    actor: 'adapter-builder',
    details: { error: String(err), stack: err.stack },
  });
  process.exit(1);
});
