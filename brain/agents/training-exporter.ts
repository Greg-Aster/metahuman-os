/**
 * Training Exporter - Generate JSONL dataset for fine-tuning
 *
 * Converts schema-applied samples to JSONL format:
 * {"input": "...", "output": "..."}
 *
 * Validates:
 * - Proper JSON escaping
 * - No malformed records
 * - Each record standalone
 * - No mode contamination
 */

import fs from 'node:fs';
import path from 'node:path';
import { audit } from '../../packages/core/src/audit.js';
import { validateJSONLDataset, validateModeContamination } from '../../packages/core/src/mode-validator.js';
import type { FormattedSample, SchemaAppliedSample } from '../../packages/core/src/schema-manager.js';

interface TrainingRecord {
  input: string;
  output: string;
}

/**
 * Convert schema-applied sample to training record
 */
function toTrainingRecord(sample: SchemaAppliedSample): TrainingRecord {
  return {
    input: sample.input,
    output: sample.output,
  };
}

/**
 * Export samples to JSONL format
 */
function exportToJSONL(samples: SchemaAppliedSample[]): string {
  const lines: string[] = [];

  for (const sample of samples) {
    const record = toTrainingRecord(sample);
    const jsonLine = JSON.stringify(record);
    lines.push(jsonLine);
  }

  return lines.join('\n');
}

/**
 * Validate schema-applied samples before export
 */
function validateSamples(samples: any[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Convert to FormattedSample format for validation (use raw_input/raw_output)
  const formattedSamples: FormattedSample[] = samples.map(s => ({
    mode: s.mode,
    input: s.raw_input || s.input,
    output: s.raw_output || s.output,
    metadata: s.metadata,
  }));

  // Check for mode contamination
  const modeValidation = validateModeContamination(formattedSamples);

  if (!modeValidation.valid) {
    errors.push(...modeValidation.errors.map(e => `${e.sampleId}: ${e.message}`));
  }

  // Log warnings
  if (modeValidation.warnings.length > 0) {
    console.warn('[training-exporter] Warnings:');
    for (const warning of modeValidation.warnings) {
      console.warn(`  - ${warning}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Main exporter function
 */
async function main() {
  const args = process.argv.slice(2);
  let inputPath: string | null = null;
  let outputPath: string | null = null;
  let skipValidation = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && i + 1 < args.length) {
      inputPath = args[i + 1];
    } else if (args[i] === '--output' && i + 1 < args.length) {
      outputPath = args[i + 1];
    } else if (args[i] === '--skip-validation') {
      skipValidation = true;
    }
  }

  if (!inputPath || !outputPath) {
    console.error('[training-exporter] ERROR: --input and --output are required');
    console.error('\\nUsage: tsx brain/agents/training-exporter.ts --input <path> --output <path> [--skip-validation]');
    process.exit(1);
  }

  console.log(`[training-exporter] Loading schema-applied samples from: ${inputPath}`);

  // Load schema-applied samples
  if (!fs.existsSync(inputPath)) {
    console.error(`[training-exporter] ERROR: Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(inputPath, 'utf-8');
  const samples = JSON.parse(content) as SchemaAppliedSample[];

  console.log(`[training-exporter] Loaded ${samples.length} schema-applied samples`);

  // Validate samples (unless skipped)
  if (!skipValidation) {
    console.log(`[training-exporter] Validating samples...`);
    const validation = validateSamples(samples);

    if (!validation.valid) {
      console.error(`[training-exporter] Validation failed with ${validation.errors.length} errors:`);
      for (const error of validation.errors.slice(0, 10)) {
        console.error(`  - ${error}`);
      }
      if (validation.errors.length > 10) {
        console.error(`  ... and ${validation.errors.length - 10} more errors`);
      }
      process.exit(1);
    }

    console.log(`[training-exporter] Validation passed ✓`);
  }

  // Export to JSONL
  console.log(`[training-exporter] Exporting to JSONL...`);
  const jsonlContent = exportToJSONL(samples);

  // Validate JSONL format
  const jsonlValidation = validateJSONLDataset(jsonlContent);

  if (!jsonlValidation.valid) {
    console.error(`[training-exporter] JSONL validation failed with ${jsonlValidation.errors.length} errors:`);
    for (const error of jsonlValidation.errors.slice(0, 10)) {
      console.error(`  - ${error.message}`);
    }
    process.exit(1);
  }

  // Log warnings
  if (jsonlValidation.warnings.length > 0) {
    console.warn('[training-exporter] JSONL warnings:');
    for (const warning of jsonlValidation.warnings) {
      console.warn(`  - ${warning}`);
    }
  }

  // Write output
  const outputDir = path.dirname(outputPath);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, jsonlContent);

  console.log(`[training-exporter] Wrote ${samples.length} training records to: ${outputPath}`);
  console.log(`[training-exporter] Dataset size: ${(jsonlContent.length / 1024).toFixed(2)} KB`);

  audit({
    level: 'info',
    category: 'action',
    event: 'training_export_completed',
    details: {
      inputPath,
      outputPath,
      totalSamples: samples.length,
      datasetSizeKB: Math.round(jsonlContent.length / 1024),
    },
    actor: 'training-exporter',
  });
}

main().catch(err => {
  console.error('[training-exporter] Fatal error:', err);
  process.exit(1);
});
