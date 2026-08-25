/**
 * RVC (Retrieval-based Voice Conversion) Management Commands
 * Install, configure, and manage RVC voice cloning via Applio
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  ROOT,
  getRVCTrainingStatus,
  listRVCSamples,
  startRVCTraining,
  type RVCTrainingOptions,
} from '@metahuman/core';

const RVC_DIR = path.join(ROOT, 'external', 'applio-rvc');

export async function rvcCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'install':
      await installRVC();
      break;
    case 'train':
      await trainVoice(args.slice(1));
      break;
    case 'status':
      await checkStatus(args.slice(1));
      break;
    case 'uninstall':
      await uninstallRVC();
      break;
    default:
      showHelp();
  }
}

function showHelp(): void {
  console.log(`
RVC Voice Conversion Management

Usage: mh rvc <command> [options]

Commands:
  install              Install RVC (Applio) and dependencies
  train [options]      Train a voice model from exported samples
  status [--name]      Check installation and training status
  uninstall            Remove RVC installation

Examples:
  mh rvc install                              # Install RVC
  mh rvc train --name greg                    # Train model named "greg"
  mh rvc train --name greg --device cuda      # Select the training device
`);
}

async function installRVC(): Promise<void> {
  console.log('Starting RVC (Applio) installation...\n');

  const scriptPath = path.join(ROOT, 'bin', 'install-rvc.sh');

  if (!fs.existsSync(scriptPath)) {
    console.error('✗ Installation script not found:', scriptPath);
    process.exit(1);
  }

  return new Promise((resolve, reject) => {
    const install = spawn('bash', [scriptPath], {
      cwd: ROOT,
      stdio: 'inherit',
    });

    install.on('close', (code) => {
      if (code === 0) {
        console.log('\n✓ RVC installation completed successfully!');
        resolve();
      } else {
        console.error(`\n✗ Installation failed with code ${code}`);
        reject(new Error(`Installation failed with code ${code}`));
      }
    });

    install.on('error', (err) => {
      console.error('✗ Failed to run installation script:', err.message);
      reject(err);
    });
  });
}

async function trainVoice(args: string[]): Promise<void> {
  console.log('Training RVC voice model...\n');

  if (!fs.existsSync(RVC_DIR)) {
    console.error('✗ RVC not installed');
    console.error('  Run: mh rvc install');
    process.exit(1);
  }

  const getArg = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const parseInteger = (flag: string, min: number): number | undefined => {
    const raw = getArg(flag);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) {
      throw new Error(`${flag} must be an integer of at least ${min}`);
    }
    return value;
  };

  const modelName = getArg('--name') || 'default';
  const rawDevice = getArg('--device');
  if (rawDevice && !['auto', 'cpu', 'cuda'].includes(rawDevice)) {
    throw new Error('--device must be auto, cpu, or cuda');
  }

  const options: RVCTrainingOptions = {
    totalEpochs: parseInteger('--epochs', 1),
    saveEveryEpoch: parseInteger('--save-every', 1),
    batchSize: parseInteger('--batch-size', 1),
    device: rawDevice as RVCTrainingOptions['device'],
  };
  const result = startRVCTraining(modelName, options);
  if (!result.success) throw new Error(result.error || 'RVC training could not start');
  console.log(`✓ RVC training started for ${modelName}`);
}

async function checkStatus(args: string[]): Promise<void> {
  console.log('RVC Installation Status\n');

  // Check installation
  const installed = fs.existsSync(RVC_DIR);
  console.log(`Installation: ${installed ? '✓ Installed' : '✗ Not installed'}`);

  if (!installed) {
    console.log('\nRun: mh rvc install');
    return;
  }

  // Check venv
  const venvExists = fs.existsSync(path.join(RVC_DIR, 'venv'));
  console.log(`Python venv:  ${venvExists ? '✓ Created' : '✗ Missing'}`);

  const cliExists = fs.existsSync(path.join(RVC_DIR, 'core.py'));
  console.log(`Applio CLI:   ${cliExists ? '✓ Ready' : '✗ Missing'}`);

  const nameIndex = args.indexOf('--name');
  const modelName = nameIndex >= 0 && args[nameIndex + 1] ? args[nameIndex + 1] : 'default';
  const samples = listRVCSamples(modelName);
  const totalDuration = samples.reduce((sum, sample) => sum + sample.duration, 0);
  const training = getRVCTrainingStatus(modelName);
  console.log(`\nModel:          ${modelName}`);
  console.log(`Training:       ${training.status}${training.progress ? ` (${training.progress}%)` : ''}`);
  console.log(`Exported data:  ${samples.length} samples / ${(totalDuration / 60).toFixed(1)} minutes`);
  if (training.modelPath) console.log(`Model path:     ${training.modelPath}`);

  // Show disk usage
  const rvcSize = getDirSize(RVC_DIR);
  console.log(`\nDisk usage: ${formatBytes(rvcSize)}`);
}

async function uninstallRVC(): Promise<void> {
  console.log('Uninstalling RVC...\n');

  if (!fs.existsSync(RVC_DIR)) {
    console.log('RVC is not installed');
    return;
  }

  console.log(`Removing: ${RVC_DIR}`);
  fs.rmSync(RVC_DIR, { recursive: true, force: true });

  console.log('✓ RVC uninstalled');
}

// Helper functions

function getDirSize(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;

  let size = 0;
  const stack = [dirPath];

  while (stack.length > 0) {
    const current = stack.pop()!;
    try {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
        } else if (entry.isFile()) {
          size += fs.statSync(fullPath).size;
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  return size;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
