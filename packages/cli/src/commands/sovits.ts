/**
 * GPT-SoVITS Management Commands
 * Install, configure, and manage GPT-SoVITS TTS server
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import {
  ROOT,
  generateSpeech,
  getSovitsServerStatus,
  startSovitsServer,
  stopSovitsServer,
  systemPaths,
} from '@metahuman/core';

const SOVITS_DIR = path.join(ROOT, 'external', 'gpt-sovits');

export async function sovitsCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case 'install':
      await installSoVITS();
      break;
    case 'start':
      await startServer(args.slice(1));
      break;
    case 'stop':
      await stopServer();
      break;
    case 'restart':
      await stopServer();
      await startServer(args.slice(1));
      break;
    case 'status':
      await checkStatus();
      break;
    case 'logs':
      await showLogs(args.slice(1));
      break;
    case 'download-models':
      await downloadModels();
      break;
    case 'test':
      await testServer(args.slice(1));
      break;
    case 'uninstall':
      await uninstallSoVITS();
      break;
    default:
      showHelp();
  }
}

function showHelp(): void {
  console.log(`
GPT-SoVITS TTS Server Management

Usage: mh sovits <command> [options]

Commands:
  install              Install GPT-SoVITS and dependencies
  start [--port]       Start the GPT-SoVITS server (default port: 9880)
  stop                 Stop the running server
  restart [--port]     Restart the server
  status               Check server status and health
  logs [--tail N]      Show server logs (default: last 50 lines)
  download-models      Download pre-trained models
  test [text]          Test server with sample text
  uninstall            Remove GPT-SoVITS installation

Examples:
  mh sovits install                    # Install GPT-SoVITS
  mh sovits start                      # Start server on port 9880
  mh sovits start --port 8000          # Start server on custom port
  mh sovits test "Hello world"         # Test synthesis
  mh sovits logs --tail 100            # Show last 100 log lines
`);
}

async function installSoVITS(): Promise<void> {
  console.log('Starting GPT-SoVITS installation...\n');

  const scriptPath = path.join(ROOT, 'bin', 'install-sovits.sh');

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
        console.log('\n✓ GPT-SoVITS installation completed successfully!');
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

async function startServer(args: string[]): Promise<void> {
  const portIndex = args.indexOf('--port');
  const portValue = portIndex !== -1 ? args[portIndex + 1] : undefined;
  if (portIndex !== -1 && !portValue) throw new Error('--port requires a value');

  const port = portValue === undefined ? 9880 : Number(portValue);
  const result = await startSovitsServer(port);
  if (!result.success) throw new Error(result.error ?? 'GPT-SoVITS did not start');

  console.log(`✓ ${result.message}`);
  console.log(`  PID: ${result.pid}`);
  console.log(`  Logs: ${path.join(systemPaths.logs, 'run', 'sovits.log')}`);
}

async function stopServer(): Promise<void> {
  const result = await stopSovitsServer();
  if (!result.success) throw new Error(result.error ?? 'GPT-SoVITS did not stop');
  console.log(`✓ ${result.message}`);
}

async function checkStatus(): Promise<void> {
  console.log('GPT-SoVITS Server Status\n');

  // Check installation
  const installed = fs.existsSync(SOVITS_DIR);
  console.log(`Installation: ${installed ? '✓ Installed' : '✗ Not installed'}`);

  if (!installed) {
    console.log('\nRun: mh sovits install');
    return;
  }

  // Check if running
  const status = await getSovitsServerStatus();
  console.log(`Server:       ${status.running ? '✓ Running' : '✗ Stopped'}`);

  if (status.running) {
    console.log(`PID:          ${status.pid}`);
    console.log(`Port:         ${status.port}`);
    console.log(`Health:       ${status.healthy ? '✓ Healthy' : '⚠ Warming up or unhealthy'}`);
  }

  // Show disk usage
  const sovitsSize = getDirSize(SOVITS_DIR);
  console.log(`Disk usage:   ${formatBytes(sovitsSize)}`);

  console.log('\nConfiguration:');
  const voiceConfig = path.join(systemPaths.etc, 'voice.json');
  if (fs.existsSync(voiceConfig)) {
    const config = JSON.parse(fs.readFileSync(voiceConfig, 'utf-8'));
    console.log(`  Provider:     ${config.tts.provider}`);
    if (config.tts.sovits) {
      console.log(`  Server URL:   ${config.tts.sovits.serverUrl}`);
      console.log(`  Speaker ID:   ${config.tts.sovits.speakerId}`);
      console.log(`  Auto-fallback: ${config.tts.sovits.autoFallbackToPiper ? 'Enabled' : 'Disabled'}`);
    }
  }
}

async function showLogs(args: string[]): Promise<void> {
  const logFile = path.join(systemPaths.logs, 'run', 'sovits.log');

  if (!fs.existsSync(logFile)) {
    console.log('No log file found');
    return;
  }

  const tailIndex = args.indexOf('--tail');
  const lines = tailIndex !== -1 && args[tailIndex + 1] ? parseInt(args[tailIndex + 1]) : 50;

  try {
    const tail = execSync(`tail -n ${lines} "${logFile}"`, { encoding: 'utf-8' });
    console.log(tail);
  } catch (error) {
    console.error('Error reading logs:', (error as Error).message);
  }
}

async function downloadModels(): Promise<void> {
  console.log('Downloading GPT-SoVITS pre-trained models...\n');
  console.log('Note: This will download several GB of data\n');

  if (!fs.existsSync(SOVITS_DIR)) {
    console.error('✗ GPT-SoVITS not installed');
    console.error('  Run: mh sovits install');
    process.exit(1);
  }

  // Model download URLs - matches paths expected by api.py
  const models = [
    {
      name: 'GPT Base Model (s1bert25hz)',
      url: 'https://huggingface.co/lj1995/GPT-SoVITS/resolve/main/s1bert25hz-2kh-longer-epoch%3D68e-step%3D50232.ckpt',
      dest: path.join(SOVITS_DIR, 'GPT_SoVITS', 'pretrained_models', 's1bert25hz-2kh-longer-epoch=68e-step=50232.ckpt'),
    },
    {
      name: 'SoVITS Base Model (s2G488k)',
      url: 'https://huggingface.co/lj1995/GPT-SoVITS/resolve/main/s2G488k.pth',
      dest: path.join(SOVITS_DIR, 'GPT_SoVITS', 'pretrained_models', 's2G488k.pth'),
    },
    {
      name: 'Chinese RoBERTa Model',
      url: 'https://huggingface.co/hfl/chinese-roberta-wwm-ext-large/resolve/main/pytorch_model.bin',
      dest: path.join(SOVITS_DIR, 'GPT_SoVITS', 'pretrained_models', 'chinese-roberta-wwm-ext-large', 'pytorch_model.bin'),
    },
    {
      name: 'Chinese RoBERTa Config',
      url: 'https://huggingface.co/hfl/chinese-roberta-wwm-ext-large/resolve/main/config.json',
      dest: path.join(SOVITS_DIR, 'GPT_SoVITS', 'pretrained_models', 'chinese-roberta-wwm-ext-large', 'config.json'),
    },
    {
      name: 'Chinese RoBERTa Tokenizer',
      url: 'https://huggingface.co/hfl/chinese-roberta-wwm-ext-large/resolve/main/tokenizer.json',
      dest: path.join(SOVITS_DIR, 'GPT_SoVITS', 'pretrained_models', 'chinese-roberta-wwm-ext-large', 'tokenizer.json'),
    },
    {
      name: 'Chinese RoBERTa Vocab',
      url: 'https://huggingface.co/hfl/chinese-roberta-wwm-ext-large/resolve/main/vocab.txt',
      dest: path.join(SOVITS_DIR, 'GPT_SoVITS', 'pretrained_models', 'chinese-roberta-wwm-ext-large', 'vocab.txt'),
    },
    {
      name: 'Chinese RoBERTa Tokenizer Config',
      url: 'https://huggingface.co/hfl/chinese-roberta-wwm-ext-large/resolve/main/tokenizer_config.json',
      dest: path.join(SOVITS_DIR, 'GPT_SoVITS', 'pretrained_models', 'chinese-roberta-wwm-ext-large', 'tokenizer_config.json'),
    },
    {
      name: 'Chinese HuBERT Base Model',
      url: 'https://huggingface.co/TencentGameMate/chinese-hubert-base/resolve/main/pytorch_model.bin',
      dest: path.join(SOVITS_DIR, 'GPT_SoVITS', 'pretrained_models', 'chinese-hubert-base', 'pytorch_model.bin'),
    },
    {
      name: 'Chinese HuBERT Config',
      url: 'https://huggingface.co/TencentGameMate/chinese-hubert-base/resolve/main/config.json',
      dest: path.join(SOVITS_DIR, 'GPT_SoVITS', 'pretrained_models', 'chinese-hubert-base', 'config.json'),
    },
    {
      name: 'Chinese HuBERT Preprocessor Config',
      url: 'https://huggingface.co/TencentGameMate/chinese-hubert-base/resolve/main/preprocessor_config.json',
      dest: path.join(SOVITS_DIR, 'GPT_SoVITS', 'pretrained_models', 'chinese-hubert-base', 'preprocessor_config.json'),
    },
    {
      name: 'Chinese RoBERTa Special Tokens Map',
      url: 'https://huggingface.co/hfl/chinese-roberta-wwm-ext-large/resolve/main/special_tokens_map.json',
      dest: path.join(SOVITS_DIR, 'GPT_SoVITS', 'pretrained_models', 'chinese-roberta-wwm-ext-large', 'special_tokens_map.json'),
    },
  ];

  for (const model of models) {
    console.log(`Downloading ${model.name}...`);
    const dir = path.dirname(model.dest);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(model.dest)) {
      console.log(`  ✓ Already exists, skipping`);
      continue;
    }

    try {
      // Use curl for download with progress
      execSync(`curl -L -o "${model.dest}" "${model.url}"`, {
        stdio: 'inherit',
        cwd: ROOT,
      });
      console.log(`  ✓ Downloaded\n`);
    } catch (error) {
      console.error(`  ✗ Failed to download: ${(error as Error).message}\n`);
    }
  }

  console.log('✓ Model download complete');
}

async function testServer(args: string[]): Promise<void> {
  const testText = args.join(' ') || 'Hello, this is a test of GPT-SoVITS text to speech.';

  console.log('Testing GPT-SoVITS server...\n');
  console.log(`Text: "${testText}"\n`);

  const status = await getSovitsServerStatus();
  if (!status.running) {
    console.error('✗ Server is not running');
    console.error('  Start it with: mh sovits start');
    return;
  }

  try {
    const audio = await generateSpeech(testText, { provider: 'gpt-sovits' });
    console.log('✓ Speech generated successfully');
    console.log(`  Audio size: ${formatBytes(audio.byteLength)}`);
  } catch (error) {
    console.error('✗ Test failed:', (error as Error).message);
  }
}

async function uninstallSoVITS(): Promise<void> {
  console.log('Uninstalling GPT-SoVITS...\n');

  // Stop server if running
  await stopServer();

  if (!fs.existsSync(SOVITS_DIR)) {
    console.log('GPT-SoVITS is not installed');
    return;
  }

  console.log(`Removing: ${SOVITS_DIR}`);
  fs.rmSync(SOVITS_DIR, { recursive: true, force: true });

  console.log('✓ GPT-SoVITS uninstalled');
}

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
