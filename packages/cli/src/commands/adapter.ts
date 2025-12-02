/**
 * Adapter Management Commands
 * Manage LoRA datasets, training, and activation
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { ROOT, systemPaths, audit, setActiveAdapter } from '@metahuman/core';
import type { ActiveAdapterInfo } from '@metahuman/core';

interface ApprovalMetadata {
  approvedAt: string;
  approvedBy: string;
  pairCount: number;
  notes: string;
}

export function adapterList() {
  console.log('LoRA Adapter Datasets\n');

  const adaptersDir = path.join(ROOT, 'out', 'adapters');

  if (!fs.existsSync(adaptersDir)) {
    console.log('No adapter datasets found.');
    console.log('Run sleep-service with adapters.lora: true to generate datasets.');
    return;
  }

  const dates = fs.readdirSync(adaptersDir)
    .filter(d => fs.statSync(path.join(adaptersDir, d)).isDirectory())
    .sort()
    .reverse();

  if (dates.length === 0) {
    console.log('No adapter datasets found.');
    return;
  }

  console.log(`Found ${dates.length} dataset(s):\n`);

  for (const date of dates) {
    const datasetDir = path.join(adaptersDir, date);
    const jsonlPath = path.join(datasetDir, 'instructions.jsonl');
    const approvedPath = path.join(datasetDir, 'approved.json');
    const evalPath = path.join(datasetDir, 'eval.json');
    const adapterPath = path.join(datasetDir, 'adapter_model.safetensors');

    let status = '🟡 Pending Review';
    let details = '';

    if (fs.existsSync(adapterPath)) {
      status = '✅ Trained';
      if (fs.existsSync(evalPath)) {
        const evalResult = JSON.parse(fs.readFileSync(evalPath, 'utf-8'));
        details = ` (eval: ${evalResult.score?.toFixed(3) || 'N/A'})`;
      }
    } else if (fs.existsSync(approvedPath)) {
      status = '🟢 Approved';
      const approval = JSON.parse(fs.readFileSync(approvedPath, 'utf-8'));
      details = ` (${approval.pairCount} pairs)`;
    }

    let pairCount = 0;
    if (fs.existsSync(jsonlPath)) {
      const content = fs.readFileSync(jsonlPath, 'utf-8');
      pairCount = content.trim().split('\n').length;
    }

    console.log(`  ${date}  ${status}${details || ` (${pairCount} pairs)`}`);
  }

  console.log('');
  console.log('Commands:');
  console.log('  mh adapter review <date>   - Review and approve dataset');
  console.log('  mh adapter approve <date>  - Approve dataset for training');
  console.log('  mh adapter reject <date>   - Reject and archive dataset');
}

export function adapterReview(date: string) {
  console.log(`Reviewing LoRA Dataset: ${date}\n`);

  const datasetDir = path.join(ROOT, 'out', 'adapters', date);
  const jsonlPath = path.join(datasetDir, 'instructions.jsonl');

  if (!fs.existsSync(jsonlPath)) {
    console.error(`Dataset not found: ${date}`);
    console.log('Run `mh adapter list` to see available datasets.');
    process.exit(1);
  }

  const content = fs.readFileSync(jsonlPath, 'utf-8');
  const lines = content.trim().split('\n');
  const pairs = lines.map(line => JSON.parse(line));

  console.log(`Total Pairs: ${pairs.length}\n`);

  // Show first 5 examples
  console.log('Sample Pairs (first 5):\n');

  for (let i = 0; i < Math.min(5, pairs.length); i++) {
    const pair = pairs[i];
    console.log(`--- Pair ${i + 1} ---`);
    console.log(`Instruction: ${pair.instruction}`);
    console.log(`Input: ${pair.input?.slice(0, 100)}${pair.input?.length > 100 ? '...' : ''}`);
    console.log(`Output: ${pair.output?.slice(0, 100)}${pair.output?.length > 100 ? '...' : ''}`);
    console.log(`Meta: ${JSON.stringify(pair.meta || {})}`);
    console.log('');
  }

  // Analyze dataset composition
  const types = new Map<string, number>();
  const confidences = new Map<string, number>();

  for (const pair of pairs) {
    const meta = pair.meta || {};
    const tags = meta.tags || [];
    const confidence = meta.confidence || 'unknown';

    // Count by type (first tag)
    const type = tags[0] || 'untagged';
    types.set(type, (types.get(type) || 0) + 1);

    // Count by confidence
    confidences.set(confidence, (confidences.get(confidence) || 0) + 1);
  }

  console.log('Dataset Composition:\n');
  console.log('By Type:');
  for (const [type, count] of Array.from(types.entries()).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / pairs.length) * 100).toFixed(1);
    console.log(`  ${type}: ${count} (${pct}%)`);
  }

  console.log('\nBy Confidence:');
  for (const [conf, count] of Array.from(confidences.entries()).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / pairs.length) * 100).toFixed(1);
    console.log(`  ${conf}: ${count} (${pct}%)`);
  }

  console.log('\n---\n');
  console.log(`Full dataset: ${jsonlPath}`);
  console.log('\nNext steps:');
  console.log(`  mh adapter approve ${date}  - Approve for training`);
  console.log(`  mh adapter reject ${date}   - Reject and archive`);
}

export function adapterApprove(date: string, notes: string = '') {
  const datasetDir = path.join(ROOT, 'out', 'adapters', date);
  const jsonlPath = path.join(datasetDir, 'instructions.jsonl');
  const approvedPath = path.join(datasetDir, 'approved.json');

  if (!fs.existsSync(jsonlPath)) {
    console.error(`Dataset not found: ${date}`);
    process.exit(1);
  }

  if (fs.existsSync(approvedPath)) {
    console.log(`Dataset ${date} is already approved.`);
    return;
  }

  const content = fs.readFileSync(jsonlPath, 'utf-8');
  const pairCount = content.trim().split('\n').length;

  const approval: ApprovalMetadata = {
    approvedAt: new Date().toISOString(),
    approvedBy: process.env.USER || 'unknown',
    pairCount,
    notes: notes || 'Approved via CLI',
  };

  fs.writeFileSync(approvedPath, JSON.stringify(approval, null, 2));

  audit({
    level: 'info',
    category: 'action',
    event: 'lora_dataset_approved',
    details: { date, pairCount, approvedBy: approval.approvedBy },
    actor: 'cli',
  });

  console.log(`✓ Dataset ${date} approved for training (${pairCount} pairs)`);
  console.log(`\nNext step: Run LoRA training`);
  console.log(`  mh adapter train ${date}`);
}

export function adapterReject(date: string, reason: string = '') {
  const datasetDir = path.join(ROOT, 'out', 'adapters', date);
  const jsonlPath = path.join(datasetDir, 'instructions.jsonl');

  if (!fs.existsSync(jsonlPath)) {
    console.error(`Dataset not found: ${date}`);
    process.exit(1);
  }

  // Archive the dataset
  const archiveDir = path.join(ROOT, 'out', 'adapters', '_rejected');
  fs.mkdirSync(archiveDir, { recursive: true});

  const archivePath = path.join(archiveDir, date);
  fs.renameSync(datasetDir, archivePath);

  // Log rejection reason
  const rejectionMeta = {
    rejectedAt: new Date().toISOString(),
    rejectedBy: process.env.USER || 'unknown',
    reason: reason || 'Not specified',
  };

  fs.writeFileSync(
    path.join(archivePath, 'rejected.json'),
    JSON.stringify(rejectionMeta, null, 2)
  );

  audit({
    level: 'info',
    category: 'action',
    event: 'lora_dataset_rejected',
    details: { date, reason: rejectionMeta.reason },
    actor: 'cli',
  });

  console.log(`✓ Dataset ${date} rejected and archived`);
  console.log(`  Reason: ${rejectionMeta.reason}`);
  console.log(`  Archive: ${archivePath}`);
}

export function adapterTrain(date: string) {
  console.log(`Training LoRA Adapter: ${date}\n`);

  const datasetDir = path.join(ROOT, 'out', 'adapters', date);
  const approvedPath = path.join(datasetDir, 'approved.json');

  if (!fs.existsSync(approvedPath)) {
    console.error(`Dataset ${date} is not approved for training.`);
    console.log('Run `mh adapter approve <date>` first.');
    process.exit(1);
  }

  const trainerPath = path.join(systemPaths.brain, 'agents', 'lora-trainer.ts');

  if (!fs.existsSync(trainerPath)) {
    console.error('lora-trainer agent not found.');
    console.log('This feature is not yet implemented.');
    console.log('See docs/train-lora.md for manual training steps.');
    process.exit(1);
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'lora_training_started',
    details: { date },
    actor: 'cli',
  });

  console.log('Starting LoRA training agent...\n');

  const child = spawn('tsx', [trainerPath, date], {
    stdio: 'inherit',
    cwd: ROOT,
  });

  child.on('error', (err) => {
    console.error(`Failed to run lora-trainer: ${err.message}`);
    process.exit(1);
  });

  child.on('close', (code) => {
    if (code === 0) {
      console.log('\n✓ LoRA training completed successfully');
    } else {
      console.error(`\nlora-trainer exited with code ${code}`);
      process.exit(code || 1);
    }
  });
}

export function adapterEval(date: string) {
  console.log(`Evaluating LoRA Adapter: ${date}\n`);

  const datasetDir = path.join(ROOT, 'out', 'adapters', date);
  const evalAgentPath = path.join(systemPaths.brain, 'agents', 'eval-adapter.ts');

  if (!fs.existsSync(evalAgentPath)) {
    console.error('eval-adapter agent not found.');
    process.exit(1);
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'adapter_eval_started',
    details: { date },
    actor: 'cli',
  });

  console.log('Starting adapter evaluation...\n');

  const child = spawn('tsx', [evalAgentPath, date], {
    stdio: 'inherit',
    cwd: ROOT,
  });

  child.on('error', (err) => {
    console.error(`Failed to run eval-adapter: ${err.message}`);
    process.exit(1);
  });

  child.on('close', (code) => {
    if (code === 0) {
      console.log('\n✓ Evaluation completed successfully');
    } else {
      console.error(`\neval-adapter exited with code ${code}`);
      process.exit(code || 1);
    }
  });
}

export function adapterActivate(date: string) {
  console.log(`Activating LoRA Adapter: ${date}\n`);

  const datasetDir = path.join(ROOT, 'out', 'adapters', date);
  const evalPath = path.join(datasetDir, 'eval.json');
  const adapterPath = path.join(datasetDir, 'adapter_model.safetensors');
  const modelfilePath = path.join(datasetDir, 'Modelfile');

  if (!fs.existsSync(evalPath)) {
    console.error(`Adapter ${date} has not been evaluated.`);
    console.log('Run `mh adapter eval <date>` first.');
    process.exit(1);
  }

  const evalResult = JSON.parse(fs.readFileSync(evalPath, 'utf-8'));

  if (!evalResult.passed) {
    console.warn(`⚠ Adapter ${date} did not pass evaluation (score: ${evalResult.score.toFixed(3)})`);
    console.log('Activation cancelled. Review training quality and try again.');
    process.exit(1);
  }

  const modelName = `greg-${date}`;
  const ggufAdapterPath = path.join(datasetDir, 'adapter.gguf');

  // Check if GGUF adapter exists, if not try to convert
  if (!fs.existsSync(ggufAdapterPath)) {
    console.log('⚠ GGUF adapter not found. Converting from safetensors...\n');
    try {
      execSync(`tsx ${path.join(systemPaths.brain, 'agents', 'gguf-converter.ts')} ${date}`, {
        stdio: 'inherit',
        cwd: ROOT,
      });
    } catch (error) {
      console.error(`\n✗ GGUF conversion failed: ${(error as Error).message}`);
      console.log('\nManual conversion required:');
      console.log(`  cd vendor/llama.cpp`);
      console.log(`  python convert_lora_to_gguf.py ${datasetDir} --outfile ${ggufAdapterPath}\n`);
      process.exit(1);
    }
  }

  // Check for historical merged adapter (dual-adapter system)
  const historyMergedPath = path.join(ROOT, 'out', 'adapters', 'history-merged', 'adapter-merged.gguf');
  const hasHistoricalAdapter = fs.existsSync(historyMergedPath);

  // Create Modelfile with GGUF adapter(s)
  const baseModel = process.env.METAHUMAN_BASE_MODEL || 'dolphin-mistral:latest';

  let modelfile = `# MetaHuman OS LoRA Adapter - ${date}
FROM ${baseModel}
`;

  // Add historical adapter first (if exists) for dual-adapter mode
  if (hasHistoricalAdapter) {
    modelfile += `ADAPTER ${historyMergedPath}\n`;
    console.log(`✓ Including historical adapter: ${historyMergedPath}`);
  }

  // Add recent adapter (always included)
  modelfile += `ADAPTER ${ggufAdapterPath}\n`;
  console.log(`✓ Including recent adapter: ${ggufAdapterPath}`);

  fs.writeFileSync(modelfilePath, modelfile);
  console.log(`Created Modelfile: ${modelfilePath}`);

  // Try to load into Ollama
  console.log(`Loading adapter into Ollama: ${modelName}...`);

  const activatedAt = new Date().toISOString();

  try {
    execSync(`ollama create ${modelName} -f "${modelfilePath}"`, {
      stdio: 'inherit',
      cwd: ROOT,
    });

    console.log(`✓ Ollama model created: ${modelName}\n`);

    const activeInfo: ActiveAdapterInfo = {
      modelName,
      activatedAt,
      adapterPath,
      ggufAdapterPath,
      evalScore: evalResult.score,
      dataset: date,
      modelfilePath,
      status: 'loaded',
      activatedBy: 'cli',
      trainingMethod: 'manual',
      baseModel,
      isDualAdapter: hasHistoricalAdapter,
      dual: hasHistoricalAdapter,
    };
    setActiveAdapter(activeInfo);

    audit({
      level: 'info',
      category: 'action',
      event: 'adapter_activated',
      details: {
        date,
        modelName,
        evalScore: evalResult.score,
        status: 'loaded',
        dualAdapter: hasHistoricalAdapter,
        historicalAdapterPath: hasHistoricalAdapter ? historyMergedPath : undefined,
      },
      actor: 'cli',
    });

    console.log(`✓ Adapter activated: ${modelName}`);
    console.log(`  Mode: ${hasHistoricalAdapter ? 'Dual-adapter (historical + recent)' : 'Single-adapter (recent only)'}`);
    console.log(`  Eval score: ${evalResult.score.toFixed(3)}`);
    console.log(`  Status: loaded`);
    console.log(`  Metadata stored in etc/models.json\n`);
    if (hasHistoricalAdapter) {
      console.log('✓ Dual-adapter system active: Long-term memory preserved!');
    } else {
      console.log('⚠ Single-adapter mode: Run `mh adapter merge` to create historical adapter for long-term memory.');
    }
    console.log('\nThe adapter is now active and will be used for all LLM interactions.');
  } catch (error) {
    console.error(`\n✗ Failed to load adapter into Ollama: ${(error as Error).message}`);
    console.log('\nManual activation required:');
    console.log(`  ollama create ${modelName} -f "${modelfilePath}"\n`);

    const standbyInfo: ActiveAdapterInfo = {
      modelName,
      activatedAt,
      adapterPath,
      ggufAdapterPath,
      evalScore: evalResult.score,
      dataset: date,
      modelfilePath,
      status: 'ready_for_ollama_load',
      activatedBy: 'cli',
      trainingMethod: 'manual',
      baseModel,
      isDualAdapter: hasHistoricalAdapter,
      dual: hasHistoricalAdapter,
    };
    setActiveAdapter(standbyInfo);

    console.log('After running the command above, the adapter will be active.');
    process.exit(1);
  }
}

export function adapterMerge() {
  console.log('Merging historical LoRA adapters...\n');

  const agentPath = path.join(systemPaths.brain, 'agents', 'adapter-merger.ts');

  if (!fs.existsSync(agentPath)) {
    console.error('adapter-merger.ts not found');
    process.exit(1);
  }

  const child = spawn('tsx', [agentPath], {
    stdio: 'inherit',
    cwd: ROOT,
  });

  child.on('error', (err) => {
    console.error('Failed to run adapter-merger:', err);
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      console.error(`adapter-merger exited with code ${code}`);
      process.exit(code || 1);
    }
  });
}

export function adapterCommand(args: string[]) {
  const subcommand = args[0];

  switch (subcommand) {
    case 'list':
      adapterList();
      break;
    case 'merge':
      adapterMerge();
      break;
    case 'review':
      if (!args[1]) {
        console.error('Missing date argument. Usage: mh adapter review <date>');
        process.exit(1);
      }
      adapterReview(args[1]);
      break;
    case 'approve':
      if (!args[1]) {
        console.error('Missing date argument. Usage: mh adapter approve <date> [notes]');
        process.exit(1);
      }
      adapterApprove(args[1], args.slice(2).join(' '));
      break;
    case 'reject':
      if (!args[1]) {
        console.error('Missing date argument. Usage: mh adapter reject <date> [reason]');
        process.exit(1);
      }
      adapterReject(args[1], args.slice(2).join(' '));
      break;
    case 'train':
      if (!args[1]) {
        console.error('Missing date argument. Usage: mh adapter train <date>');
        process.exit(1);
      }
      adapterTrain(args[1]);
      break;
    case 'eval':
      if (!args[1]) {
        console.error('Missing date argument. Usage: mh adapter eval <date>');
        process.exit(1);
      }
      adapterEval(args[1]);
      break;
    case 'activate':
      if (!args[1]) {
        console.error('Missing date argument. Usage: mh adapter activate <date>');
        process.exit(1);
      }
      adapterActivate(args[1]);
      break;
    case undefined:
      console.log('Usage: mh adapter <command>');
      console.log('');
      console.log('Commands:');
      console.log('  list              - List all datasets (pending, approved, trained)');
      console.log('  merge             - Merge historical adapters into single consolidated adapter');
      console.log('  review <date>     - Review dataset and show sample pairs');
      console.log('  approve <date>    - Approve dataset for training');
      console.log('  reject <date>     - Reject and archive dataset');
      console.log('  train <date>      - Train LoRA adapter (requires approval)');
      console.log('  eval <date>       - Evaluate trained adapter');
      console.log('  activate <date>   - Activate adapter for use (requires passing eval)');
      break;
    default:
      console.log(`Unknown adapter command: ${subcommand}`);
      console.log('Run `mh adapter` for usage.');
      process.exit(1);
  }
}
