/**
 * Fine-Tune Command
 *
 * CLI wrapper for the cognitive mode fine-tuning pipeline
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { systemPaths } from '@metahuman/core';

export async function fineTuneCommand(args: string[]): Promise<void> {
  // Parse arguments
  const username = getArg(args, '--username') || process.env.USER || 'greggles';
  const baseModel = getArg(args, '--base-model') || 'qwen3-coder:30b';
  const maxSamples = getArg(args, '--max');
  const modeFilter = getArg(args, '--mode');
  const skipValidation = args.includes('--skip-validation');

  // Show help if requested
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return;
  }

  console.log('Starting cognitive mode fine-tuning pipeline...');
  console.log(`  User: ${username}`);
  console.log(`  Base model: ${baseModel}`);
  if (maxSamples) console.log(`  Max samples: ${maxSamples}`);
  if (modeFilter) console.log(`  Mode filter: ${modeFilter}`);
  console.log('');

  // Build arguments for fine-tune-cycle.ts
  const cycleArgs = [
    '--username', username,
    '--base-model', baseModel,
  ];

  if (maxSamples) {
    cycleArgs.push('--max', maxSamples);
  }

  if (modeFilter) {
    if (!['dual', 'emulation', 'agent'].includes(modeFilter)) {
      console.error(`Invalid mode: ${modeFilter}`);
      console.error('Valid modes: dual, emulation, agent');
      process.exit(1);
    }
    cycleArgs.push('--mode', modeFilter);
  }

  if (skipValidation) {
    cycleArgs.push('--skip-validation');
  }

  // Run fine-tune-cycle.ts
  const scriptPath = path.join(systemPaths.brain, 'agents', 'fine-tune-cycle.ts');

  return new Promise<void>((resolve, reject) => {
    const child = spawn('tsx', [scriptPath, ...cycleArgs], {
      cwd: systemPaths.root,
      stdio: 'inherit',
    });

    child.on('error', (err) => {
      console.error('Failed to start fine-tuning:', err);
      reject(err);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`Fine-tuning failed with exit code ${code}`);
        process.exit(code);
      }
      resolve();
    });
  });
}

function getArg(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1 || index + 1 >= args.length) {
    return undefined;
  }
  return args[index + 1];
}

function showHelp(): void {
  console.log(`
MetaHuman Fine-Tune - Cognitive Mode Training Pipeline

USAGE:
  mh fine-tune [OPTIONS]

OPTIONS:
  --username <name>           User profile to fine-tune (default: current user)
  --base-model <model>        Base model to fine-tune (default: qwen3-coder:30b)
  --max <count>               Maximum samples to process (optional)
  --mode <type>               Filter by cognitive mode: dual, emulation, or agent (optional)
  --skip-validation           Skip dataset validation checks (not recommended)
  -h, --help                  Show this help message

COGNITIVE MODES:
  dual        - Internal monologue mode (<thought> → <world>)
  emulation   - Standard chatbot mode (<user> → <assistant>)
  agent       - Tool-using agent mode (<instruction> → <action>)

EXAMPLES:
  # Full fine-tune with all modes
  mh fine-tune --username greggles

  # Fine-tune only dual mode (personality deepening)
  mh fine-tune --username greggles --mode dual --max 3000

  # Fine-tune with specific base model
  mh fine-tune --username greggles --base-model llama3-70b

PIPELINE STAGES:
  1. Curate memories (clean, assign modes, trim responses)
  2. Format samples (apply mode-specific tags)
  3. Apply schema (model-family wrappers)
  4. Export JSONL (training dataset)
  5. Validate dataset (check for contamination)
  6. (Future) Run remote fine-tuning on RunPod
  7. (Future) Load fine-tuned model to Ollama

For more information, see: docs/fine-tune-implementation-plan.md
`);
}
