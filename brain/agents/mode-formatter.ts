/**
 * Mode Formatter - Apply cognitive mode formatting rules
 *
 * Transforms curated samples into mode-specific format:
 * - Dual: <thought> → <world>
 * - Emulation: <user> → <assistant>
 * - Agent: <instruction> → <action>
 *
 * CRITICAL: Only applies formatting tags, does not modify content.
 */

import fs from 'node:fs';
import path from 'node:path';
import { audit } from '../../packages/core/src/audit.js';

export type CognitiveMode = 'dual' | 'emulation' | 'agent';

export interface CuratedSample {
  mode: CognitiveMode;
  user_text: string;
  assistant_text: string;
  metadata: {
    original_id: string;
    [key: string]: any;
  };
}

export interface FormattedSample {
  mode: CognitiveMode;
  input: string;
  output: string;
  metadata: {
    original_id: string;
    [key: string]: any;
  };
}

/**
 * Apply dual mode formatting
 * User text = AI's internal thought
 * Assistant text = external world response
 */
function formatDualMode(sample: CuratedSample): FormattedSample {
  return {
    mode: 'dual',
    input: `<thought>: ${sample.user_text}`,
    output: `<world>: ${sample.assistant_text}`,
    metadata: sample.metadata,
  };
}

/**
 * Apply emulation mode formatting
 * Standard user → assistant conversation
 */
function formatEmulationMode(sample: CuratedSample): FormattedSample {
  return {
    mode: 'emulation',
    input: `<user>: ${sample.user_text}`,
    output: `<assistant>: ${sample.assistant_text}`,
    metadata: sample.metadata,
  };
}

/**
 * Apply agent mode formatting
 * Instruction → action/result
 */
function formatAgentMode(sample: CuratedSample): FormattedSample {
  return {
    mode: 'agent',
    input: `<instruction>: ${sample.user_text}`,
    output: `<action>: ${sample.assistant_text}`,
    metadata: sample.metadata,
  };
}

/**
 * Format a single curated sample based on its mode
 */
function formatSample(sample: CuratedSample): FormattedSample {
  switch (sample.mode) {
    case 'dual':
      return formatDualMode(sample);
    case 'emulation':
      return formatEmulationMode(sample);
    case 'agent':
      return formatAgentMode(sample);
    default:
      throw new Error(`Unknown cognitive mode: ${sample.mode}`);
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
    console.error('\\nUsage: tsx brain/agents/mode-formatter.ts --input <path> --output <path>');
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
