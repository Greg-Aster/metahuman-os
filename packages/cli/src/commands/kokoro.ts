/**
 * Kokoro TTS Management Commands
 * Install, configure, and manage Kokoro StyleTTS2 voice synthesis
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import {
  ROOT,
  systemPaths,
  ensureVoiceServiceRunning,
  getVoiceServiceStatus,
  stopVoiceService,
} from '@metahuman/core';
import { createTTSService } from '@metahuman/core';

const KOKORO_DIR = path.join(ROOT, 'external', 'kokoro');

export async function kokoroCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'install':
      await installKokoro();
      break;
    case 'status':
      await checkStatus();
      break;
    case 'serve':
      await manageServer(args.slice(1));
      break;
    case 'voices':
      await listVoices();
      break;
    case 'test':
      await testSynthesis(args.slice(1));
      break;
    case 'train-voicepack':
      await trainVoicepack(args.slice(1));
      break;
    case 'uninstall':
      await uninstallKokoro();
      break;
    default:
      showHelp();
  }
}

function showHelp(): void {
  console.log(`
Kokoro TTS Management

Usage: mh kokoro <command> [options]

Commands:
  install                  Install Kokoro TTS and dependencies
  status                   Check Kokoro installation and server status
  serve <start|stop>       Start or stop the Kokoro FastAPI server
  voices                   List available built-in voices
  test [--text TEXT]       Test synthesis with sample text
  train-voicepack [opts]   Train a custom Kokoro voice pack from collected samples
  uninstall                Remove Kokoro installation

Examples:
  mh kokoro install                       # Install Kokoro
  mh kokoro serve start                   # Start FastAPI server
  mh kokoro voices                        # List all voices
  mh kokoro test --text "Hello world"    # Test synthesis
  mh kokoro status                        # Check status

Server Options:
  mh kokoro serve start [--port 9882] [--lang a]
  mh kokoro serve stop
`);
}

async function installKokoro(): Promise<void> {
  console.log('Starting Kokoro TTS installation...\n');

  const scriptPath = path.join(ROOT, 'bin', 'install-kokoro.sh');

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
        console.log('\n✓ Kokoro installation completed successfully!');
        console.log('\nNext steps:');
        console.log('  1. Enable Kokoro in Voice Settings UI');
        console.log('  2. Test synthesis: mh kokoro test');
        console.log('  3. Start server: mh kokoro serve start');
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

async function checkStatus(): Promise<void> {
  console.log('Kokoro TTS Status\n');
  console.log('─'.repeat(50));

  // Check installation
  const pythonBin = path.join(KOKORO_DIR, 'venv', 'bin', 'python3');
  const installed = fs.existsSync(pythonBin);

  console.log(`Installation:     ${installed ? '✓ Installed' : '✗ Not installed'}`);

  if (!installed) {
    console.log('\nRun: mh kokoro install');
    return;
  }

  console.log(`Directory:        ${KOKORO_DIR}`);

  const status = await getVoiceServiceStatus('kokoro');
  console.log(`Server:           ${status.running ? `✓ Running${status.pid ? ` (PID ${status.pid})` : ''}` : '✗ Not running'}`);
  console.log(`Server Health:    ${status.healthy ? '✓ Healthy' : status.running ? `⚠ ${status.readiness}` : '✗ Stopped'}`);
  console.log(`Server URL:       ${status.url}`);
  if (status.health?.lang) console.log(`Language:         ${status.health.lang}`);

  // Check voices catalog
  const voicesFile = path.join(KOKORO_DIR, 'VOICES.md');
  if (fs.existsSync(voicesFile)) {
    console.log(`Voices Catalog:   ✓ Available`);
  } else {
    console.log(`Voices Catalog:   ⚠ Not found`);
  }

  console.log('\n─'.repeat(50));
}

async function manageServer(args: string[]): Promise<void> {
  const action = args[0];

  if (action === 'start') {
    await startServer(args.slice(1));
  } else if (action === 'stop') {
    await stopServer();
  } else {
    console.error('Usage: mh kokoro serve <start|stop>');
    process.exit(1);
  }
}

async function startServer(args: string[]): Promise<void> {
  if (args.length > 0) {
    console.warn('Port, language, and device are system service settings; configure them in etc/voice-servers.json.');
  }
  const status = await ensureVoiceServiceRunning('kokoro');
  console.log(`✓ Kokoro server start accepted${status.pid ? ` (PID ${status.pid})` : ''}`);
  console.log(`  URL: ${status.url}`);
}

async function stopServer(): Promise<void> {
  try {
    const result = await stopVoiceService('kokoro');
    console.log(`✓ ${result.message}`);
  } catch (err) {
    console.error('✗ Failed to stop server:', (err as Error).message);
    process.exit(1);
  }
}

async function listVoices(): Promise<void> {
  const voicesFile = path.join(KOKORO_DIR, 'VOICES.md');

  if (!fs.existsSync(voicesFile)) {
    console.error('✗ Voice catalog not found');
    console.error('  Run: mh kokoro install');
    process.exit(1);
  }

  console.log('Kokoro Built-in Voices\n');
  console.log('─'.repeat(70));

  const content = fs.readFileSync(voicesFile, 'utf-8');

  // Parse VOICES.md (simple parsing - assumes specific format)
  const lines = content.split('\n');
  const voices: { name: string; lang: string; gender: string; quality: string }[] = [];

  for (const line of lines) {
    // Look for voice entries (format varies, this is a simple heuristic)
    // Example: `af_heart` - English (US), Female, High Quality
    const match = line.match(/`([a-z_]+)`.*?([A-Z][a-z]+).*?(Male|Female).*?(High|Medium|Low)/i);
    if (match) {
      voices.push({
        name: match[1],
        lang: match[2],
        gender: match[3],
        quality: match[4],
      });
    }
  }

  if (voices.length === 0) {
    console.log('No voices parsed. Showing raw catalog:\n');
    console.log(content);
    return;
  }

  // Group by language
  const byLang: Record<string, typeof voices> = {};
  for (const voice of voices) {
    if (!byLang[voice.lang]) byLang[voice.lang] = [];
    byLang[voice.lang].push(voice);
  }

  for (const [lang, voiceList] of Object.entries(byLang)) {
    console.log(`\n${lang}:`);
    for (const voice of voiceList) {
      console.log(`  ${voice.name.padEnd(20)} ${voice.gender.padEnd(8)} ${voice.quality}`);
    }
  }

  console.log('\n─'.repeat(70));
  console.log(`Total: ${voices.length} voices`);
  console.log('\nUsage: Configure voice in etc/voice.json or Voice Settings UI');
}

async function testSynthesis(args: string[]): Promise<void> {
  const textIndex = args.indexOf('--text');
  const text = textIndex !== -1 && args[textIndex + 1]
    ? args[textIndex + 1]
    : 'Hello! This is a test of Kokoro text to speech synthesis.';

  const voiceIndex = args.indexOf('--voice');
  const voice = voiceIndex !== -1 && args[voiceIndex + 1]
    ? args[voiceIndex + 1]
    : 'af_heart';

  console.log(`Testing Kokoro synthesis...`);
  console.log(`  Voice: ${voice}`);
  console.log(`  Text: "${text}"\n`);

  try {
    const service = createTTSService('kokoro');
    const audioBuffer = await service.synthesize(text, { voice });

    const outDir = path.join(ROOT, 'out', 'test-audio');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const outputFile = path.join(outDir, `kokoro-test-${Date.now()}.wav`);
    fs.writeFileSync(outputFile, audioBuffer);

    console.log(`✓ Synthesis successful!`);
    console.log(`  Output: ${outputFile}`);
    console.log(`  Size: ${(audioBuffer.length / 1024).toFixed(1)} KB`);
    console.log(`\nPlay with: aplay ${outputFile}`);
    console.log(`       or: ffplay ${outputFile}`);
  } catch (err) {
    console.error('✗ Synthesis failed:', (err as Error).message);
    process.exit(1);
  }
}

async function trainVoicepack(args: string[]): Promise<void> {
  const getArg = (flag: string, fallback?: string) => {
    const index = args.indexOf(flag);
    if (index !== -1 && args[index + 1]) {
      return args[index + 1];
    }
    return fallback;
  };

  const speaker = getArg('--speaker', 'default');
  const datasetDir = getArg('--dataset', path.join(ROOT, 'out', 'kokoro', 'datasets', speaker));
  const outputPath = getArg('--output', path.join(ROOT, 'out', 'kokoro', 'voicepacks', `${speaker}.pt`));
  const langCode = getArg('--lang', 'a');
  const baseVoice = getArg('--base-voice', 'af_heart');
  const epochs = getArg('--epochs', '120');
  const learningRate = getArg('--learning-rate', '0.0005');
  const device = getArg('--device', 'auto');
  const maxSamples = getArg('--max-samples', '200');
  const regularization = getArg('--regularization');

  if (!fs.existsSync(datasetDir)) {
    console.error(`✗ Dataset directory not found: ${datasetDir}`);
    console.error('  Use the Voice Training UI to copy samples first.');
    process.exit(1);
  }

  const pythonBin = path.join(KOKORO_DIR, 'venv', 'bin', 'python3');
  const trainerScript = path.join(KOKORO_DIR, 'build_voicepack.py');

  if (!fs.existsSync(pythonBin)) {
    console.error('✗ Kokoro virtual environment not found. Run "./bin/install-kokoro.sh" first.');
    process.exit(1);
  }

  if (!fs.existsSync(trainerScript)) {
    console.error('✗ build_voicepack.py not found. Reinstall the Kokoro add-on.');
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const statusFile = path.join(systemPaths.logs, 'run', `kokoro-training-${speaker}.json`);
  const logFile = path.join(systemPaths.logs, 'run', `kokoro-training-${speaker}.log`);
  fs.mkdirSync(path.dirname(statusFile), { recursive: true });

  const trainerArgs = [
    trainerScript,
    '--speaker', speaker,
    '--dataset', datasetDir,
    '--output', outputPath,
    '--lang', langCode,
    '--base-voice', baseVoice,
    '--epochs', epochs,
    '--learning-rate', learningRate,
    '--max-samples', maxSamples,
    '--device', device,
    '--status-file', statusFile,
    '--log-file', logFile,
  ];

  if (regularization) {
    trainerArgs.push('--regularization', regularization);
  }

  console.log('Starting Kokoro voicepack training...\n');
  console.log(`  Speaker:     ${speaker}`);
  console.log(`  Dataset dir: ${datasetDir}`);
  console.log(`  Output:      ${outputPath}`);
  console.log(`  Base voice:  ${baseVoice}`);
  console.log(`  Language:    ${langCode}`);
  console.log(`  Epochs:      ${epochs}`);
  console.log(`  Device:      ${device}`);
  console.log('');

  await new Promise<void>((resolve, reject) => {
    const child = spawn(pythonBin, trainerArgs, {
      cwd: KOKORO_DIR,
      stdio: 'inherit',
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log('\n✓ Kokoro voicepack training completed!');
        console.log(`  Saved to: ${outputPath}`);
        console.log(`  Status:   ${statusFile}`);
        console.log(`  Log:      ${logFile}`);
        resolve();
      } else {
        reject(new Error(`Trainer exited with code ${code}`));
      }
    });

    child.on('error', reject);
  }).catch((error) => {
    console.error('✗ Training failed:', (error as Error).message);
    process.exit(1);
  });
}

async function uninstallKokoro(): Promise<void> {
  console.log('⚠ Uninstalling Kokoro TTS...\n');

  // Stop the shared voice server before removing its installation.
  await stopServer();

  if (!fs.existsSync(KOKORO_DIR)) {
    console.log('⚠ Kokoro is not installed');
    return;
  }

  // Confirm before deleting
  console.log(`This will delete: ${KOKORO_DIR}`);
  console.log('Press Ctrl+C to cancel, or Enter to continue...');

  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => resolve());
  });

  try {
    execSync(`rm -rf "${KOKORO_DIR}"`, { stdio: 'inherit' });
    console.log('\n✓ Kokoro uninstalled successfully');

    // Update addons.json
    const addonsPath = path.join(systemPaths.etc, 'addons.json');
    if (fs.existsSync(addonsPath)) {
      const addons = JSON.parse(fs.readFileSync(addonsPath, 'utf-8'));
      if (addons.addons?.kokoro) {
        addons.addons.kokoro.installed = false;
        addons.addons.kokoro.enabled = false;
        fs.writeFileSync(addonsPath, JSON.stringify(addons, null, 2));
        console.log('✓ Updated addons.json');
      }
    }
  } catch (err) {
    console.error('✗ Uninstall failed:', (err as Error).message);
    process.exit(1);
  }
}
