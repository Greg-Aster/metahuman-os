/**
 * Auto-Approver Agent
 * Automatically approves high-quality datasets based on configurable thresholds
 * Runs in dry-run mode by default for safety
 */

import fs from 'node:fs';
import path from 'node:path';
import { paths, audit } from '../../packages/core/src/index.js';

const DATASET_DATE = process.argv[2];

if (!DATASET_DATE) {
  console.error('Usage: tsx auto-approver.ts <dataset-date>');
  console.error('Example: tsx auto-approver.ts 2025-10-21');
  process.exit(1);
}

interface AutoApprovalConfig {
  enabled: boolean;
  dryRun: boolean;
  thresholds: {
    minPairs: number;
    minHighConfidence: number;
    minReflectionPct: number;
    maxLowConfidence: number;
  };
  alertEmail?: string;
}

interface DatasetMetadata {
  pairCount: number;
  createdAt: string;
  byType: Record<string, number>;
  byConfidence: Record<string, number>;
  avgInputLength: number;
  avgOutputLength: number;
}

/**
 * Load auto-approval configuration
 */
function loadConfig(): AutoApprovalConfig {
  const configPath = path.join(paths.etc, 'auto-approval.json');

  if (!fs.existsSync(configPath)) {
    // Create default config
    const defaultConfig: AutoApprovalConfig = {
      enabled: true,
      dryRun: true,  // Safe default
      thresholds: {
        minPairs: 30,
        minHighConfidence: 0.6,     // 60% high-confidence
        minReflectionPct: 0.2,      // 20% reflections
        maxLowConfidence: 0.2,      // Max 20% low-confidence
      },
      alertEmail: undefined,
    };

    fs.mkdirSync(paths.etc, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));

    console.log(`[auto-approver] Created default config: ${configPath}`);
    return defaultConfig;
  }

  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

/**
 * Load dataset metadata
 */
function loadMetadata(datasetDir: string): DatasetMetadata | null {
  const metadataPath = path.join(datasetDir, 'metadata.json');

  if (!fs.existsSync(metadataPath)) {
    console.error(`[auto-approver] Metadata not found: ${metadataPath}`);
    return null;
  }

  return JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
}

/**
 * Evaluate dataset quality against thresholds
 */
function evaluateDataset(metadata: DatasetMetadata, config: AutoApprovalConfig): {
  decision: 'approve' | 'reject';
  score: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 100;  // Start at 100, deduct for failures

  // Check 1: Minimum pair count
  if (metadata.pairCount < config.thresholds.minPairs) {
    reasons.push(`Too few pairs (${metadata.pairCount} < ${config.thresholds.minPairs})`);
    score -= 30;
  }

  // Check 2: High-confidence ratio
  const highConfCount = metadata.byConfidence.high || 0;
  const highConfPct = highConfCount / metadata.pairCount;

  if (highConfPct < config.thresholds.minHighConfidence) {
    reasons.push(`Low high-confidence ratio (${(highConfPct * 100).toFixed(1)}% < ${config.thresholds.minHighConfidence * 100}%)`);
    score -= 25;
  }

  // Check 3: Reflection percentage
  const reflectionCount = metadata.byType.reflection || 0;
  const reflectionPct = reflectionCount / metadata.pairCount;

  if (reflectionPct < config.thresholds.minReflectionPct) {
    reasons.push(`Low reflection ratio (${(reflectionPct * 100).toFixed(1)}% < ${config.thresholds.minReflectionPct * 100}%)`);
    score -= 20;
  }

  // Check 4: Low-confidence ceiling
  const lowConfCount = metadata.byConfidence.low || 0;
  const lowConfPct = lowConfCount / metadata.pairCount;

  if (lowConfPct > config.thresholds.maxLowConfidence) {
    reasons.push(`Too many low-confidence pairs (${(lowConfPct * 100).toFixed(1)}% > ${config.thresholds.maxLowConfidence * 100}%)`);
    score -= 25;
  }

  // Bonus points for good metrics
  if (metadata.avgInputLength > 50 && metadata.avgOutputLength > 50) {
    score += 5;  // Substantive content
  }

  // Decision: approve if score >= 70
  const decision = score >= 70 ? 'approve' : 'reject';

  return { decision, score, reasons };
}

/**
 * Write approval file
 */
function writeApproval(datasetDir: string, evaluation: any, dryRun: boolean) {
  const approvalData = {
    approvedAt: new Date().toISOString(),
    approvedBy: 'auto-approver',
    autoApproved: true,
    pairCount: evaluation.metadata.pairCount,
    qualityScore: evaluation.score,
    notes: `Auto-approved (score: ${evaluation.score}/100)`,
    dryRun: dryRun,
  };

  if (dryRun) {
    console.log('\n[DRY-RUN] Would write approval file:');
    console.log(JSON.stringify(approvalData, null, 2));
    return;
  }

  const approvalPath = path.join(datasetDir, 'approved.json');
  fs.writeFileSync(approvalPath, JSON.stringify(approvalData, null, 2));

  console.log(`\n✓ Approval written: ${approvalPath}`);
}

/**
 * Main auto-approval logic
 */
async function main() {
  console.log(`[auto-approver] Evaluating dataset: ${DATASET_DATE}\n`);

  const config = loadConfig();

  if (!config.enabled) {
    console.log('[auto-approver] Auto-approval is disabled in config. Exiting.');
    return;
  }

  if (config.dryRun) {
    console.log('[auto-approver] ⚠ Running in DRY-RUN mode (no actual approval)\n');
  }

  const datasetDir = path.join(paths.out, 'adapters', DATASET_DATE);

  if (!fs.existsSync(datasetDir)) {
    console.error(`[auto-approver] Dataset not found: ${datasetDir}`);
    process.exit(1);
  }

  // Check if already approved
  const approvalPath = path.join(datasetDir, 'approved.json');
  if (fs.existsSync(approvalPath)) {
    console.log('[auto-approver] Dataset already approved. Exiting.');
    return;
  }

  // Load metadata
  const metadata = loadMetadata(datasetDir);
  if (!metadata) {
    process.exit(1);
  }

  console.log('Dataset Metadata:');
  console.log(`  Total pairs: ${metadata.pairCount}`);
  console.log(`  By confidence: ${JSON.stringify(metadata.byConfidence)}`);
  console.log(`  By type: ${JSON.stringify(metadata.byType)}`);
  console.log(`  Avg lengths: input=${metadata.avgInputLength}, output=${metadata.avgOutputLength}\n`);

  // Evaluate against thresholds
  const evaluation = evaluateDataset(metadata, config);

  console.log('Quality Evaluation:');
  console.log(`  Decision: ${evaluation.decision.toUpperCase()}`);
  console.log(`  Score: ${evaluation.score}/100`);

  if (evaluation.reasons.length > 0) {
    console.log('  Reasons:');
    evaluation.reasons.forEach(r => console.log(`    - ${r}`));
  } else {
    console.log('  All quality checks passed ✓');
  }

  audit({
    level: 'info',
    category: 'action',
    event: `lora_dataset_auto_${evaluation.decision}`,
    details: {
      dataset: DATASET_DATE,
      decision: evaluation.decision,
      score: evaluation.score,
      reasons: evaluation.reasons,
      dryRun: config.dryRun,
    },
    actor: 'auto-approver',
  });

  if (evaluation.decision === 'approve') {
    writeApproval(datasetDir, { metadata, ...evaluation }, config.dryRun);

    if (!config.dryRun) {
      console.log('\n✓ Dataset auto-approved and ready for training');
      console.log(`  Run: mh adapter train ${DATASET_DATE}`);
    } else {
      console.log('\n[DRY-RUN] Dataset would be auto-approved in live mode');
    }
  } else {
    console.log('\n✗ Dataset auto-rejected (quality thresholds not met)');
    console.log('  Manual review required or improve data quality.');

    if (!config.dryRun) {
      // Write rejection file
      const rejectionData = {
        rejectedAt: new Date().toISOString(),
        rejectedBy: 'auto-approver',
        autoRejected: true,
        score: evaluation.score,
        reasons: evaluation.reasons,
      };

      fs.writeFileSync(
        path.join(datasetDir, 'auto-rejected.json'),
        JSON.stringify(rejectionData, null, 2)
      );
    }
  }
}

main().catch(err => {
  console.error('[auto-approver] Fatal error:', err);
  audit({
    level: 'error',
    category: 'action',
    event: 'auto_approver_failed',
    details: { error: String(err) },
    actor: 'auto-approver',
  });
  process.exit(1);
});
