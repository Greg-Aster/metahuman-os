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
import { getUserContext } from '../../packages/core/src/context.js';
import {
  collectAllUserData,
  loadPersonaData,
  type RawTrainingSample,
} from '../../packages/core/src/user-data-collector.js';
import {
  CURATOR_SYSTEM_PROMPT,
  buildBatchCurationPrompt,
  buildPersonaSummary,
  type CurationCriteria,
  type CuratedSample,
} from '../../packages/core/src/curator-prompts.js';

// Batch processing configuration
const CURATOR_BATCH_SIZE = 50; // Process 50 samples at a time
const QUALITY_THRESHOLD = 6.0; // Minimum weighted quality score (0-10 scale)
const CURATOR_TEMPERATURE = 0.3; // Low temperature for consistent evaluation

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
  personaSummary: string
): Promise<CuratedSample[]> {
  if (samples.length === 0) {
    return [];
  }

  // Build curator prompt with batch of samples
  const batchPrompt = buildBatchCurationPrompt(samples, personaSummary);

  try {
    // Call curator model (configurable via status widget)
    const response = await callLLM({
      role: 'curator',
      messages: [
        { role: 'system', content: CURATOR_SYSTEM_PROMPT },
        { role: 'user', content: batchPrompt },
      ],
      options: {
        temperature: CURATOR_TEMPERATURE,
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
        qualityScore: 5.0,
        criteriaScores: {
          authenticity: 5,
          specificity: 5,
          consistency: 5,
          behavioral: 5,
          density: 5,
        },
        improvementsMade: [],
        curatorNotes: 'Curator failed to process',
      }));
    }

    return result.samples as CuratedSample[];
  } catch (error) {
    console.error('[adapter-builder] Curator error:', error);
    console.warn('[adapter-builder] Using original samples without curation');

    // Fallback: return samples with default quality scores
    return samples.map((s) => ({
      ...s,
      qualityScore: 5.0,
      criteriaScores: {
        authenticity: 5,
        specificity: 5,
        consistency: 5,
        behavioral: 5,
        density: 5,
      },
      improvementsMade: [],
      curatorNotes: 'Curator unavailable',
    }));
  }
}

/**
 * Process all user data through curator in batches
 */
async function curateAllData(
  rawSamples: RawTrainingSample[],
  personaSummary: string
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
  for (let i = 0; i < rawSamples.length; i += CURATOR_BATCH_SIZE) {
    const batch = rawSamples.slice(i, i + CURATOR_BATCH_SIZE);
    console.log(`[adapter-builder] Curating batch ${Math.floor(i / CURATOR_BATCH_SIZE) + 1}/${Math.ceil(rawSamples.length / CURATOR_BATCH_SIZE)} (${batch.length} samples)...`);

    const curated = await curateBatch(batch, personaSummary);
    allCurated.push(...curated);

    stats.totalReviewed += batch.length;
  }

  // Filter by quality threshold
  const kept: CuratedSample[] = [];
  let totalQuality = 0;

  for (const sample of allCurated) {
    const score = sample.qualityScore || 0;

    // Always keep therapy sessions (highest quality data source)
    // Apply threshold to other sources
    const isTherapy = sample.metadata?.source === 'therapy_session';
    const meetsThreshold = score >= QUALITY_THRESHOLD;

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
    const sourceTotal = sourceSamples.reduce((sum, s) => sum + (s.qualityScore || 0), 0);
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
  stats: CurationStats
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
    qualityThreshold: QUALITY_THRESHOLD,
    averageQuality: stats.averageQuality,
    bySource: stats.bySource,
    samples: samples.map((s) => ({
      instruction: s.instruction.substring(0, 100),
      qualityScore: s.qualityScore,
      criteriaScores: s.criteriaScores,
      improvementsMade: s.improvementsMade,
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
 * Main adapter builder entry point
 */
async function main() {
  const ctx = getUserContext();

  if (!ctx) {
    console.error('[adapter-builder] ERROR: No user context found.');
    console.error('[adapter-builder] This agent must be run with user context.');
    console.error('[adapter-builder] Use: withUserContext(userInfo, async () => { ... })');
    process.exit(1);
  }

  console.log(`[adapter-builder] Building curated dataset for user: ${ctx.username}`);

  await audit({
    level: 'info',
    category: 'action',
    event: 'adapter_builder_started',
    actor: ctx.username,
    details: { userId: ctx.userId, username: ctx.username },
  });

  // Collect all user data
  const profileRoot = path.dirname(ctx.profilePaths.personaCore);
  const rawSamples = collectAllUserData(profileRoot, {
    maxDays: 999999, // Use all time (no cutoff)
    maxSamplesPerSource: 1000, // Up to 1000 per source
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

  // Load persona for curator context
  const personaData = loadPersonaData(profileRoot);
  const personaSummary = buildPersonaSummary(personaData);

  console.log(`[adapter-builder] Collected ${rawSamples.length} raw training samples`);
  console.log(`[adapter-builder] Starting curation process with curator model...`);

  // Curate data in batches
  const { curated, stats } = await curateAllData(rawSamples, personaSummary);

  if (curated.length === 0) {
    console.error('[adapter-builder] ERROR: No samples passed quality threshold.');
    console.error('[adapter-builder] Quality threshold: ${QUALITY_THRESHOLD}/10');

    await audit({
      level: 'error',
      category: 'action',
      event: 'adapter_builder_failed',
      actor: ctx.username,
      details: { reason: 'all_samples_filtered', threshold: QUALITY_THRESHOLD },
    });

    process.exit(1);
  }

  // Write curated dataset to user-specific output directory
  const timestamp = new Date().toISOString().split('T')[0];
  const outputDir = path.join(profileRoot, 'out', 'adapters', timestamp);
  const datasetPath = writeCuratedDataset(curated, outputDir, stats);

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

// Run main
main().catch((err) => {
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
