/**
 * RVC (Retrieval-based Voice Conversion) Management Commands
 * Install, configure, and manage RVC voice cloning via Applio
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { paths } from '@metahuman/core';

const RVC_DIR = path.join(paths.root, 'external', 'applio-rvc');

export async function rvcCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'install':
      await installRVC();
      break;
    case 'train':
      await trainVoice(args.slice(1));
      break;
    case 'test':
      await testInference(args.slice(1));
      break;
    case 'status':
      await checkStatus();
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
  train [--name]       Train a new RVC voice model from audio samples
  test [--model]       Test voice conversion with a sample
  status               Check RVC installation status
  uninstall            Remove RVC installation

Examples:
  mh rvc install                              # Install RVC
  mh rvc train --name greg                    # Train model named "greg"
  mh rvc test --model greg --input test.wav  # Test conversion
`);
}

async function installRVC(): Promise<void> {
  console.log('Starting RVC (Applio) installation...\n');

  const scriptPath = path.join(paths.root, 'bin', 'install-rvc.sh');

  if (!fs.existsSync(scriptPath)) {
    console.error('✗ Installation script not found:', scriptPath);
    process.exit(1);
  }

  return new Promise((resolve, reject) => {
    const install = spawn('bash', [scriptPath], {
      cwd: paths.root,
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

  // Parse arguments
  const nameIndex = args.indexOf('--name');
  const modelName = nameIndex !== -1 && args[nameIndex + 1] ? args[nameIndex + 1] : 'default';

  console.log(`Model name: ${modelName}`);
  console.log('\nNote: RVC training requires audio samples to be prepared first.');
  console.log('      Use the Voice Training widget in the web UI to collect samples.');
  console.log('\nTraining workflow:');
  console.log('  1. Collect voice samples (10-15 minutes of clean audio)');
  console.log('  2. Export samples to training dataset');
  console.log('  3. Run this command to train the RVC model');
  console.log('\nTraining is not yet fully automated. Please use external RVC tools for now.');
}

async function testInference(args: string[]): Promise<void> {
  console.log('Testing RVC voice conversion...\n');

  if (!fs.existsSync(RVC_DIR)) {
    console.error('✗ RVC not installed');
    console.error('  Run: mh rvc install');
    process.exit(1);
  }

  // Parse arguments
  const modelIndex = args.indexOf('--model');
  const modelName = modelIndex !== -1 && args[modelIndex + 1] ? args[modelIndex + 1] : 'default';

  const inputIndex = args.indexOf('--input');
  const inputFile = inputIndex !== -1 && args[inputIndex + 1] ? args[inputIndex + 1] : null;

  if (!inputFile) {
    console.error('✗ Missing --input argument');
    console.error('  Usage: mh rvc test --model <name> --input <audio-file>');
    process.exit(1);
  }

  if (!fs.existsSync(inputFile)) {
    console.error(`✗ Input file not found: ${inputFile}`);
    process.exit(1);
  }

  const modelPath = path.join(paths.root, 'out', 'voices', 'rvc', modelName, 'models', `${modelName}.pth`);
  if (!fs.existsSync(modelPath)) {
    console.error(`✗ Model not found: ${modelPath}`);
    console.error('  Train a model first with: mh rvc train --name ' + modelName);
    process.exit(1);
  }

  const outputFile = path.join(paths.root, 'out', 'voices', 'rvc', `test-output-${Date.now()}.wav`);

  console.log(`Input:  ${inputFile}`);
  console.log(`Model:  ${modelPath}`);
  console.log(`Output: ${outputFile}`);
  console.log('');

  const venvPython = path.join(RVC_DIR, 'venv', 'bin', 'python3');
  const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python3';
  const inferScript = path.join(RVC_DIR, 'infer.py');

  return new Promise((resolve, reject) => {
    const infer = spawn(pythonBin, [
      inferScript,
      '--input', inputFile,
      '--output', outputFile,
      '--model', modelPath,
      '--pitch', '0',
    ], {
      cwd: RVC_DIR,
      stdio: 'inherit',
    });

    infer.on('close', (code) => {
      if (code === 0) {
        console.log('\n✓ Voice conversion completed!');
        console.log(`  Output saved to: ${outputFile}`);
        resolve();
      } else {
        console.error(`\n✗ Inference failed with code ${code}`);
        reject(new Error(`Inference failed with code ${code}`));
      }
    });

    infer.on('error', (err) => {
      console.error('✗ Failed to run inference:', err.message);
      reject(err);
    });
  });
}

async function checkStatus(): Promise<void> {
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

  // Check inference script
  const inferScriptExists = fs.existsSync(path.join(RVC_DIR, 'infer.py'));
  console.log(`Infer script: ${inferScriptExists ? '✓ Ready' : '✗ Missing'}`);

  // List trained models
  const modelsDir = path.join(paths.root, 'out', 'voices', 'rvc');
  if (fs.existsSync(modelsDir)) {
    const models = fs.readdirSync(modelsDir)
      .filter(f => {
        const modelPath = path.join(modelsDir, f, 'models', `${f}.pth`);
        return fs.existsSync(modelPath);
      });

    console.log(`\nTrained models: ${models.length}`);
    if (models.length > 0) {
      models.forEach(m => {
        const modelPath = path.join(modelsDir, m, 'models', `${m}.pth`);
        const stats = fs.statSync(modelPath);
        console.log(`  - ${m} (${formatBytes(stats.size)})`);
      });
    }
  } else {
    console.log('\nTrained models: 0');
  }

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
