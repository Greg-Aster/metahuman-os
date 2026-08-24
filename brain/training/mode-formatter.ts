/**
 * Mode Formatter - Apply cognitive mode formatting rules
 *
 * Transforms curated samples into mode-specific format.
 * Mode labels are preserved in metadata for tracking purposes.
 *
 * IMPORTANT: No role prefixes (e.g., <user>:, <assistant>:, <world>:) are added.
 * Role identification is handled by:
 * - ChatML tokens (<|im_start|>user, <|im_start|>assistant) during training
 * - Modelfile TEMPLATE during inference
 *
 * Adding role prefixes here causes double-tagging (e.g., <|im_start|>user<user>: text)
 */

import fs from 'node:fs';
import path from 'node:path';
import { audit } from '@metahuman/core/audit';
import type {
  CognitiveMode,
  CuratedSample,
  FormattedSample,
} from '@metahuman/core/schema-manager';

/**
 * Apply dual mode formatting
 * User text = AI's internal thought
 * Assistant text = external world response
 *
 * NOTE: No role prefixes are added here. Role identification is handled by:
 * - ChatML tokens (<|im_start|>user, <|im_start|>assistant) during training via Unsloth
 * - Modelfile TEMPLATE during inference via Ollama
 */
function formatDualMode(sample: CuratedSample): FormattedSample {
  return {
    mode: 'dual',
    input: sample.user_text,
    output: sample.assistant_text,
    metadata: sample.metadata,
  };
}

/**
 * Apply emulation mode formatting
 * Standard user → assistant conversation
 *
 * NOTE: No role prefixes added - ChatML handles role identification
 */
function formatEmulationMode(sample: CuratedSample): FormattedSample {
  return {
    mode: 'emulation',
    input: sample.user_text,
    output: sample.assistant_text,
    metadata: sample.metadata,
  };
}

/**
 * Apply agent mode formatting
 * Instruction → action/result
 *
 * NOTE: No role prefixes added - ChatML handles role identification
 */
function formatAgentMode(sample: CuratedSample): FormattedSample {
  return {
    mode: 'agent',
    input: sample.user_text,
    output: sample.assistant_text,
    metadata: sample.metadata,
  };
}

/**
 * Format a single curated sample based on its mode
 */
function formatSample(sample: CuratedSample): FormattedSample {
  if (sample.mode !== 'dual' && sample.mode !== 'emulation' && sample.mode !== 'agent') {
    throw new Error(`Invalid cognitive mode "${String(sample.mode)}" for sample ${sample.metadata.original_id || 'unknown'}`);
  }
  if (typeof sample.user_text !== 'string' || !sample.user_text.trim()) {
    throw new Error(`Invalid user text for sample ${sample.metadata.original_id || 'unknown'}`);
  }
  if (typeof sample.assistant_text !== 'string' || !sample.assistant_text.trim()) {
    throw new Error(`Invalid assistant text for sample ${sample.metadata.original_id || 'unknown'}`);
  }

  switch (sample.mode) {
    case 'dual':
      return formatDualMode(sample);
    case 'emulation':
      return formatEmulationMode(sample);
    case 'agent':
      return formatAgentMode(sample);
  }
}

/**
 * Format all curated samples
 */
function formatSamples(samples: CuratedSample[]): FormattedSample[] {
  console.log(`[mode-formatter] Formatting ${samples.length} samples`);

  const formatted: FormattedSample[] = [];
  const modeCounts: Record<CognitiveMode, number> = { dual: 0, emulation: 0, agent: 0 };

  for (const sample of samples) {
    const formattedSample = formatSample(sample);
    formatted.push(formattedSample);

    if (sample.mode in modeCounts) {
      modeCounts[sample.mode]++;
    }
  }

  console.log(`[mode-formatter] Mode distribution:`);
  console.log(`  - Dual: ${modeCounts.dual} samples`);
  console.log(`  - Emulation: ${modeCounts.emulation} samples`);
  console.log(`  - Agent: ${modeCounts.agent} samples`);

  return formatted;
}

/**
 * Main formatter function
 */
async function main() {
  const args = process.argv.slice(2);
  let inputPath: string | null = null;
  let outputPath: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && i + 1 < args.length) {
      inputPath = args[i + 1];
    } else if (args[i] === '--output' && i + 1 < args.length) {
      outputPath = args[i + 1];
    }
  }

  if (!inputPath || !outputPath) {
    console.error('[mode-formatter] ERROR: --input and --output are required');
    console.error('\nUsage: tsx brain/training/mode-formatter.ts --input <path> --output <path>');
    process.exit(1);
  }

  console.log(`[mode-formatter] Loading curated samples from: ${inputPath}`);

  // Load curated samples
  if (!fs.existsSync(inputPath)) {
    console.error(`[mode-formatter] ERROR: Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(inputPath, 'utf-8');
  const curatedSamples = JSON.parse(content) as CuratedSample[];

  console.log(`[mode-formatter] Loaded ${curatedSamples.length} curated samples`);

  // Format samples
  const formattedSamples = formatSamples(curatedSamples);

  // Write output
  const outputDir = path.dirname(outputPath);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(formattedSamples, null, 2));

  console.log(`[mode-formatter] Wrote ${formattedSamples.length} formatted samples to: ${outputPath}`);

  audit({
    level: 'info',
    category: 'action',
    event: 'mode_formatting_completed',
    details: {
      inputPath,
      outputPath,
      totalSamples: formattedSamples.length,
    },
    actor: 'mode-formatter',
  });
}

main().catch(err => {
  console.error('[mode-formatter] Fatal error:', err);
  process.exit(1);
});
