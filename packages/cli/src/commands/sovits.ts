/**
 * GPT-SoVITS Management Commands
 * Install, configure, and manage GPT-SoVITS TTS server
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { paths } from '@metahuman/core';

const SOVITS_DIR = path.join(paths.root, 'external', 'gpt-sovits');
const SOVITS_PID_FILE = path.join(paths.root, 'logs', 'run', 'sovits.pid');

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

  const scriptPath = path.join(paths.root, 'bin', 'install-sovits.sh');

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
  // Check if already running
  if (isServerRunning()) {
    console.log('✗ GPT-SoVITS server is already running');
    console.log('  Use "mh sovits stop" to stop it first');
    process.exit(1);
  }

  // Check installation
  if (!fs.existsSync(SOVITS_DIR)) {
    console.error('✗ GPT-SoVITS not installed');
    console.error('  Run: mh sovits install');
    process.exit(1);
  }

  // Use virtual environment Python if available, otherwise system Python
  const venvPython = path.join(SOVITS_DIR, 'venv', 'bin', 'python3');
  let pythonBin = 'python3';

  if (fs.existsSync(venvPython)) {
    pythonBin = venvPython;
    console.log('Using GPT-SoVITS virtual environment');
  } else {
    // Fallback to system Python
    const pythonCandidates = ['python3.11', 'python3.10', 'python3.9', 'python3', 'python'];
    for (const cmd of pythonCandidates) {
      try {
        execSync(`command -v ${cmd}`, { encoding: 'utf-8' });
        pythonBin = cmd;
        break;
      } catch {
        // Try next candidate
      }
    }
    console.log('Warning: Using system Python (virtual environment not found)');
  }

  // Parse arguments
  const portIndex = args.indexOf('--port');
  const port = portIndex !== -1 && args[portIndex + 1] ? args[portIndex + 1] : '9880';

  console.log(`Starting GPT-SoVITS server on port ${port}...`);

  // Ensure log directory exists
  const logDir = path.join(paths.root, 'logs', 'run');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logFile = path.join(logDir, 'sovits.log');

  // Open log file descriptor (not stream - streams cause ERR_INVALID_ARG_VALUE)
  const logFd = fs.openSync(logFile, 'a');

  // Start server in background using system Python
  const serverScript = path.join(SOVITS_DIR, 'api.py'); // Adjust path based on actual GPT-SoVITS structure

  const serverProcess = spawn(
    pythonBin,
    [serverScript, '--port', port],
    {
      cwd: SOVITS_DIR,
      detached: true,
      stdio: ['ignore', logFd, logFd],
    }
  );

  // Close file descriptor in parent (child has its own copy)
  fs.closeSync(logFd);

  // Save PID as JSON to match API format
  fs.writeFileSync(
    SOVITS_PID_FILE,
    JSON.stringify({
      pid: serverProcess.pid,
      port: Number(port),
      startTime: new Date().toISOString(),
    })
  );

  serverProcess.unref();

  console.log(`✓ Server started (PID: ${serverProcess.pid})`);
  console.log(`  Logs: ${logFile}`);
  console.log(`  Server URL: http://localhost:${port}/`);
  console.log(`\nWaiting for server to be ready...`);

  // Wait for server to be ready
  await waitForServer(port, 30);
}

async function waitForServer(port: string, timeoutSeconds: number): Promise<void> {
  const startTime = Date.now();
  const timeout = timeoutSeconds * 1000;

  while (Date.now() - startTime < timeout) {
    try {
      // GPT-SoVITS doesn't have /health endpoint, check root instead
      const response = await fetch(`http://localhost:${port}/`);
      // Server responds even with error (400 is expected without reference audio)
      if (response.status >= 200 && response.status < 500) {
        console.log('✓ Server is ready!');
        return;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.warn('⚠ Server may not be fully ready yet');
  console.log('  Check logs with: mh sovits logs');
}

async function stopServer(): Promise<void> {
  if (!isServerRunning()) {
    console.log('✗ GPT-SoVITS server is not running');
    return;
  }

  const pidData = JSON.parse(fs.readFileSync(SOVITS_PID_FILE, 'utf-8'));
  const pid = pidData.pid;
  console.log(`Stopping GPT-SoVITS server (PID: ${pid})...`);

  try {
    process.kill(pid, 'SIGTERM');

    // Wait a moment for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Force kill if still running
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already stopped
    }

    fs.unlinkSync(SOVITS_PID_FILE);
    console.log('✓ Server stopped');
  } catch (error) {
    console.error('✗ Failed to stop server:', (error as Error).message);
    // Clean up stale PID file
    if (fs.existsSync(SOVITS_PID_FILE)) {
      fs.unlinkSync(SOVITS_PID_FILE);
    }
  }
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
  const running = isServerRunning();
  console.log(`Server:       ${running ? '✓ Running' : '✗ Stopped'}`);

  if (running) {
    const pidData = JSON.parse(fs.readFileSync(SOVITS_PID_FILE, 'utf-8'));
    console.log(`PID:          ${pidData.pid}`);

    // Try to get server info
    try {
      const response = await fetch('http://localhost:9880/health', {
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        console.log(`Health:       ✓ Healthy`);
        const data = await response.json();
        if (data.version) {
          console.log(`Version:      ${data.version}`);
        }
      } else {
        console.log(`Health:       ⚠ Unhealthy (HTTP ${response.status})`);
      }
    } catch (error) {
      console.log(`Health:       ✗ Not responding`);
    }
  }

  // Show disk usage
  const sovitsSize = getDirSize(SOVITS_DIR);
  console.log(`Disk usage:   ${formatBytes(sovitsSize)}`);

  console.log('\nConfiguration:');
  const voiceConfig = path.join(paths.etc, 'voice.json');
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
  const logFile = path.join(paths.root, 'logs', 'run', 'sovits.log');

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
        cwd: paths.root,
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

  if (!isServerRunning()) {
    console.error('✗ Server is not running');
    console.error('  Start it with: mh sovits start');
    process.exit(1);
  }

  try {
    const response = await fetch('http://localhost:9880/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: testText,
        text_lang: 'en',
        ref_text_free: true,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (response.ok) {
      const audioData = await response.arrayBuffer();
      console.log(`✓ Server responded successfully`);
      console.log(`  Audio size: ${formatBytes(audioData.byteLength)}`);
      console.log(`  Content-Type: ${response.headers.get('content-type')}`);
    } else {
      console.error(`✗ Server error: HTTP ${response.status}`);
      const text = await response.text();
      console.error(`  ${text}`);
    }
  } catch (error) {
    console.error('✗ Test failed:', (error as Error).message);
  }
}

async function uninstallSoVITS(): Promise<void> {
  console.log('Uninstalling GPT-SoVITS...\n');

  // Stop server if running
  if (isServerRunning()) {
    await stopServer();
  }

  if (!fs.existsSync(SOVITS_DIR)) {
    console.log('GPT-SoVITS is not installed');
    return;
  }

  console.log(`Removing: ${SOVITS_DIR}`);
  fs.rmSync(SOVITS_DIR, { recursive: true, force: true });

  console.log('✓ GPT-SoVITS uninstalled');
}

// Helper functions

function isServerRunning(): boolean {
  if (!fs.existsSync(SOVITS_PID_FILE)) {
    return false;
  }

  try {
    const pidData = JSON.parse(fs.readFileSync(SOVITS_PID_FILE, 'utf-8'));
    const pid = pidData.pid;

    process.kill(pid, 0); // Signal 0 checks if process exists
    return true;
  } catch {
    // Process doesn't exist or PID file is invalid, clean up stale PID file
    fs.unlinkSync(SOVITS_PID_FILE);
    return false;
  }
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
