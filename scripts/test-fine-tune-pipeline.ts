/**
 * Test Fine-Tune Pipeline
 *
 * Tests the cognitive mode fine-tuning pipeline on a small sample
 * of memories to validate all stages work correctly.
 *
 * Usage:
 *   tsx scripts/test-fine-tune-pipeline.ts --username greggles [--max 100]
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { systemPaths } from '../packages/core/src/index.js';
import { validateModeContamination, calculateQualityMetrics } from '../packages/core/src/mode-validator.js';
import type { FormattedSample, CuratedSample } from '../packages/core/src/mode-validator.js';

async function runCommand(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    console.log(`\n[test] Running: ${command} ${args.join(' ')}`);

    const child = spawn(command, args, {
      cwd: systemPaths.root,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('close', (code) => resolve(code || 0));
  });
}

async function main() {
  const args = process.argv.slice(2);
  let username: string | null = null;
  let maxSamples = 100; // Small sample for testing

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      username = args[i + 1];
    } else if (args[i] === '--max' && i + 1 < args.length) {
      maxSamples = parseInt(args[i + 1], 10);
    }
  }

  if (!username) {
    console.error('ERROR: --username <name> is required');
    console.error('\nUsage: tsx scripts/test-fine-tune-pipeline.ts --username <username> [--max <count>]');
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  FINE-TUNE PIPELINE TEST');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  User: ${username}`);
  console.log(`  Max samples: ${maxSamples}`);
  console.log(`  Test run: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Create test output directory
  const testDir = path.join(systemPaths.root, 'test-fine-tune-output');
  fs.mkdirSync(testDir, { recursive: true });

  const CURATED_PATH = path.join(testDir, 'curated_memories.json');
  const FORMATTED_PATH = path.join(testDir, 'formatted_samples.json');
  const DATASET_PATH = path.join(testDir, 'fine_tune_dataset.jsonl');

  try {
    // Step 1: Curate memories
    console.log('\n█████ STEP 1: CURATING MEMORIES █████\n');
    const curatorCode = await runCommand('tsx', [
      path.join(systemPaths.brain, 'agents', 'memory-curator.ts'),
      '--username', username,
      '--output', CURATED_PATH,
      '--max', String(maxSamples),
    ]);

    if (curatorCode !== 0) {
      throw new Error('Memory curation failed');
    }

    // Validate curation output
    if (!fs.existsSync(CURATED_PATH)) {
      throw new Error(`Curation output not found: ${CURATED_PATH}`);
    }

    const curatedContent = fs.readFileSync(CURATED_PATH, 'utf-8');
    const curatedSamples = JSON.parse(curatedContent) as CuratedSample[];

    console.log(`\n✓ Curation successful: ${curatedSamples.length} samples generated`);

    // Calculate quality metrics
    const metrics = calculateQualityMetrics(curatedSamples);
    console.log('\n📊 CURATION QUALITY METRICS:');
    console.log(`  - Total samples: ${metrics.totalSamples}`);
    console.log(`  - Avg assistant length: ${metrics.avgAssistantLength} words`);
    console.log(`  - Short samples (≤40 words): ${metrics.shortSamplesPercent}%`);
    console.log(`  - Long samples (>100 words): ${metrics.longSamplesPercent}%`);
    console.log(`  - Filler detected: ${metrics.fillerDetectedPercent}%`);
    console.log(`  - Mode distribution:`);
    console.log(`    - Dual: ${metrics.byMode.dual} samples (${metrics.modeDistribution.dual}%)`);
    console.log(`    - Emulation: ${metrics.byMode.emulation} samples (${metrics.modeDistribution.emulation}%)`);
    console.log(`    - Agent: ${metrics.byMode.agent} samples (${metrics.modeDistribution.agent}%)`);

    // Step 2: Format samples
    console.log('\n\n█████ STEP 2: FORMATTING SAMPLES █████\n');
    const formatterCode = await runCommand('tsx', [
      path.join(systemPaths.brain, 'agents', 'mode-formatter.ts'),
      '--input', CURATED_PATH,
      '--output', FORMATTED_PATH,
    ]);

    if (formatterCode !== 0) {
      throw new Error('Mode formatting failed');
    }

    if (!fs.existsSync(FORMATTED_PATH)) {
      throw new Error(`Formatted output not found: ${FORMATTED_PATH}`);
    }

    const formattedContent = fs.readFileSync(FORMATTED_PATH, 'utf-8');
    const formattedSamples = JSON.parse(formattedContent) as FormattedSample[];

    console.log(`\n✓ Formatting successful: ${formattedSamples.length} samples formatted`);

    // Validate mode contamination
    console.log('\n🔍 VALIDATING MODE CONTAMINATION...');
    const validation = validateModeContamination(formattedSamples);

    if (!validation.valid) {
      console.error(`\n❌ MODE CONTAMINATION DETECTED (${validation.errors.length} errors):`);
      for (const error of validation.errors.slice(0, 10)) {
        console.error(`  - ${error.sampleId}: ${error.message}`);
      }
      if (validation.errors.length > 10) {
        console.error(`  ... and ${validation.errors.length - 10} more errors`);
      }
      throw new Error('Mode contamination validation failed');
    }

    console.log('✓ No mode contamination detected');

    if (validation.warnings.length > 0) {
      console.warn('\n⚠️  WARNINGS:');
      for (const warning of validation.warnings) {
        console.warn(`  - ${warning}`);
      }
    }

    // Show sample outputs
    console.log('\n📄 SAMPLE FORMATTED OUTPUTS:\n');
    for (let i = 0; i < Math.min(3, formattedSamples.length); i++) {
      const sample = formattedSamples[i];
      console.log(`  [${sample.mode.toUpperCase()}]`);
      console.log(`    Input:  ${sample.input.slice(0, 80)}${sample.input.length > 80 ? '...' : ''}`);
      console.log(`    Output: ${sample.output.slice(0, 80)}${sample.output.length > 80 ? '...' : ''}`);
      console.log('');
    }

    // Step 3: Export to JSONL (with schema application inside)
    console.log('\n█████ STEP 3: EXPORTING TO JSONL █████\n');

    // First apply schema
    console.log('Applying Qwen schema...');
    const { applySchemaBatch } = await import('../packages/core/src/schema-manager.js');
    const schemaAppliedSamples = applySchemaBatch(formattedSamples, 'qwen3-coder:30b');

    const SCHEMA_PATH = path.join(testDir, 'schema_applied.json');
    fs.writeFileSync(SCHEMA_PATH, JSON.stringify(schemaAppliedSamples, null, 2));
    console.log(`✓ Schema applied: ${schemaAppliedSamples.length} samples`);

    // Then export
    const exporterCode = await runCommand('tsx', [
      path.join(systemPaths.brain, 'agents', 'training-exporter.ts'),
      '--input', SCHEMA_PATH,
      '--output', DATASET_PATH,
    ]);

    if (exporterCode !== 0) {
      throw new Error('Training export failed');
    }

    if (!fs.existsSync(DATASET_PATH)) {
      throw new Error(`Dataset output not found: ${DATASET_PATH}`);
    }

    const datasetContent = fs.readFileSync(DATASET_PATH, 'utf-8');
    const datasetLines = datasetContent.split('\n').filter(Boolean);

    console.log(`\n✓ Export successful: ${datasetLines.length} training records`);

    // Show sample JSONL lines
    console.log('\n📄 SAMPLE JSONL RECORDS:\n');
    for (let i = 0; i < Math.min(2, datasetLines.length); i++) {
      const line = datasetLines[i];
      const parsed = JSON.parse(line);
      console.log(`  Line ${i + 1}:`);
      console.log(`    Input:  ${parsed.input.slice(0, 100)}${parsed.input.length > 100 ? '...' : ''}`);
      console.log(`    Output: ${parsed.output.slice(0, 100)}${parsed.output.length > 100 ? '...' : ''}`);
      console.log('');
    }

    // Final summary
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  ✅ PIPELINE TEST COMPLETE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  Total samples: ${datasetLines.length}`);
    console.log(`  Dataset size: ${(datasetContent.length / 1024).toFixed(2)} KB`);
    console.log(`  Avg assistant length: ${metrics.avgAssistantLength} words`);
    console.log(`  Filler detected: ${metrics.fillerDetectedPercent}%`);
    console.log(`  Mode distribution:`);
    console.log(`    - Dual: ${metrics.modeDistribution.dual}%`);
    console.log(`    - Emulation: ${metrics.modeDistribution.emulation}%`);
    console.log(`    - Agent: ${metrics.modeDistribution.agent}%`);
    console.log('\n  Output files:');
    console.log(`    - Curated: ${CURATED_PATH}`);
    console.log(`    - Formatted: ${FORMATTED_PATH}`);
    console.log(`    - Schema: ${SCHEMA_PATH}`);
    console.log(`    - Dataset: ${DATASET_PATH}`);
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n═══════════════════════════════════════════════════════════');
    console.error('  ❌ PIPELINE TEST FAILED');
    console.error('═══════════════════════════════════════════════════════════');
    console.error(`  Error: ${(error as Error).message}`);
    console.error('═══════════════════════════════════════════════════════════\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
