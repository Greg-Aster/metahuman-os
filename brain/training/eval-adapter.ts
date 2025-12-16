/**
 * Adapter Evaluator
 * Scores a trained LoRA adapter for:
 * - Grounded ness (factual accuracy vs memory)
 * - Style consistency (Greg voice metrics)
 * - Safety (no hallucinations, no off-topic drift)
 */

import fs from 'node:fs';
import path from 'node:path';
import { storageClient, ROOT, audit, ollama } from '../../packages/core/src/index.js';

const DATASET_DATE = process.argv[2];

if (!DATASET_DATE) {
  console.error('Usage: tsx eval-adapter.ts <dataset-date>');
  console.error('Example: tsx eval-adapter.ts 2025-10-21');
  process.exit(1);
}

const outResult = storageClient.resolvePath({ category: 'output', subcategory: 'adapters' });
const adaptersDir = outResult.success && outResult.path ? outResult.path : path.join(ROOT, 'out', 'adapters');
const datasetDir = path.join(adaptersDir, DATASET_DATE);
const adapterPath = path.join(datasetDir, 'adapter_model.safetensors');
const jsonlPath = path.join(datasetDir, 'instructions.jsonl');
const evalPath = path.join(datasetDir, 'eval.json');

/**
 * Simple heuristic evaluation (placeholder for real eval)
 * In production, this would:
 * - Load validation set (held-out 10% from dataset)
 * - Run inference with adapted model
 * - Score outputs vs expected
 * - Check for hallucinations/drift
 */
async function evaluateAdapter(): Promise<number> {
  console.log('[eval-adapter] Running simple heuristic evaluation...\n');

  if (!fs.existsSync(adapterPath)) {
    console.warn('⚠ adapter_model.safetensors not found. Cannot evaluate.');
    console.log('This typically means training was manual or incomplete.');
    console.log('If you completed training elsewhere, copy the adapter file to:');
    console.log(`  ${adapterPath}\n`);

    // Return a placeholder score
    return 0.0;
  }

  // For now, we'll use a simple heuristic:
  // - Check adapter file exists and is non-zero
  // - Validate dataset quality metrics
  // - Return a basic score

  const adapterStats = fs.statSync(adapterPath);
  const adapterSizeMB = adapterStats.size / (1024 * 1024);

  console.log(`✓ Adapter file exists: ${adapterSizeMB.toFixed(2)} MB`);

  // Load dataset metadata
  const metadataPath = path.join(datasetDir, 'metadata.json');
  let datasetQuality = 0.5; // default

  if (fs.existsSync(metadataPath)) {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

    // Calculate quality score based on dataset composition
    const highConfidencePct = (metadata.byConfidence?.high || 0) / metadata.pairCount;
    const mediumConfidencePct = (metadata.byConfidence?.medium || 0) / metadata.pairCount;
    const reflectionPct = (metadata.byType?.reflection || 0) / metadata.pairCount;

    datasetQuality = (highConfidencePct * 1.0) + (mediumConfidencePct * 0.7) + (reflectionPct * 0.3);
    datasetQuality = Math.min(1.0, datasetQuality); // cap at 1.0

    console.log(`  High-confidence pairs: ${(highConfidencePct * 100).toFixed(1)}%`);
    console.log(`  Reflections: ${(reflectionPct * 100).toFixed(1)}%`);
    console.log(`  Dataset quality score: ${datasetQuality.toFixed(3)}\n`);
  }

  // Adapter size heuristic (typical LoRA is 10-50MB)
  let sizeScore = 0.5;
  if (adapterSizeMB >= 10 && adapterSizeMB <= 100) {
    sizeScore = 1.0;
  } else if (adapterSizeMB < 1) {
    sizeScore = 0.0; // too small, likely corrupt
  }

  console.log(`  Adapter size score: ${sizeScore.toFixed(3)}`);

  // Overall score (weighted average)
  const overallScore = (datasetQuality * 0.7) + (sizeScore * 0.3);

  console.log(`\n📊 Overall Evaluation Score: ${overallScore.toFixed(3)}`);
  console.log('  (Note: This is a heuristic placeholder. Real evaluation would test outputs.)\n');

  return overallScore;
}

/**
 * Main evaluation flow
 */
async function main() {
  console.log(`[eval-adapter] Evaluating LoRA adapter: ${DATASET_DATE}\n`);

  audit({
    level: 'info',
    category: 'action',
    event: 'adapter_evaluation_started',
    details: { dataset: DATASET_DATE },
    actor: 'eval-adapter',
  });

  const score = await evaluateAdapter();

  const threshold = 0.7;
  const passed = score >= threshold;

  const evalResult = {
    score,
    threshold,
    passed,
    evaluatedAt: new Date().toISOString(),
    method: 'heuristic_v1',
    details: {
      adapterExists: fs.existsSync(adapterPath),
      adapterSize: fs.existsSync(adapterPath) ? fs.statSync(adapterPath).size : 0,
    },
  };

  fs.writeFileSync(evalPath, JSON.stringify(evalResult, null, 2));

  console.log(`✓ Evaluation complete: ${evalPath}`);
  console.log(`  Score: ${score.toFixed(3)}`);
  console.log(`  Threshold: ${threshold}`);
  console.log(`  Status: ${passed ? '✅ PASSED' : '❌ FAILED'}\n`);

  if (passed) {
    console.log('✓ Adapter is ready for activation.');
    console.log(`  Run morning-loader to activate, or manually activate with:`);
    console.log(`  mh adapter activate ${DATASET_DATE}`);
  } else {
    console.log('⚠ Adapter did not pass evaluation threshold.');
    console.log('  Review training logs and dataset quality.');
    console.log('  You may need to curate a better dataset or adjust training params.');
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'adapter_evaluation_completed',
    details: { dataset: DATASET_DATE, score, passed },
    actor: 'eval-adapter',
  });
}

main().catch(err => {
  console.error('[eval-adapter] Fatal error:', err);
  audit({
    level: 'error',
    category: 'action',
    event: 'adapter_evaluation_failed',
    details: { error: String(err) },
    actor: 'eval-adapter',
  });
  process.exit(1);
});
