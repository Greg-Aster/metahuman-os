import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'
import {
  audit,
  buildVLLMStartConfig,
  detectAvailableBackends,
  ensureBackendRunning,
  getAdaptersToLoad,
  getProfilePaths,
  getUserContext,
  getVllmLoraConfig,
  listUsers,
  loadBackendConfig,
  ollama,
  switchBackend,
  systemPaths,
  vllm,
} from '@metahuman/core'

function getDefaultUsername(): string {
  try {
    const owner = listUsers().find(user => user.role === 'owner')
    return owner?.username || 'default'
  } catch {
    return 'default'
  }
}
async function buildCliVLLMStartConfig(
  config = loadBackendConfig(),
  model?: string,
  gpuMemoryUtilization?: number,
) {
  const startConfig = buildVLLMStartConfig(config, model, gpuMemoryUtilization)
  const loraProfile = getProfilePaths(getUserContext()?.username || getDefaultUsername())
  const loraConfig = getVllmLoraConfig(loraProfile.etc)

  return {
    ...startConfig,
    loraModules: await getAdaptersToLoad(
      loraProfile.out,
      loraProfile.etc,
      startConfig.artifact?.displayName || startConfig.servedModelName || startConfig.model,
    ),
    maxLoraRank: loraConfig.maxLoraRank,
    maxLoras: loraConfig.maxLoras,
    maxCpuLoras: loraConfig.maxCpuLoras,
    loraDtype: loraConfig.loraDtype,
  }
}

export async function ollamaCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand) {
    console.error('Usage: mh ollama <subcommand> [args]');
    console.error('\nSubcommands:');
    console.error('  status              Check if Ollama is running');
    console.error('  list                List installed models');
    console.error('  pull <model>        Install a model');
    console.error('  delete <model>      Remove a model');
    console.error('  info <model>        Show model details');
    console.error('  chat <model>        Interactive chat session');
    console.error('  ask <model> "text"  One-shot question');
    process.exit(1);
  }

  try {
    switch (subcommand) {
      case 'status': {
        const running = await ollama.isRunning();
        if (running) {
          const ver = await ollama.version();
          console.log(`✓ Ollama is running (v${ver.version})`);
          console.log(`  Endpoint: http://localhost:11434`);
        } else {
          console.log('✗ Ollama is not running');
          console.log('  Start with: ollama serve');
        }
        break;
      }

      case 'list': {
        const models = await ollama.listModels();
        if (models.length === 0) {
          console.log('No models installed');
          console.log('\nInstall a model with: mh ollama pull phi3:mini');
        } else {
          console.log(`Installed Models (${models.length}):\n`);
          models.forEach(m => {
            const size = (m.size / 1e9).toFixed(2);
            console.log(`  ${m.name}`);
            console.log(`    Size: ${size} GB`);
            console.log(`    Modified: ${new Date(m.modified_at).toLocaleString()}`);
            if (m.details) {
              console.log(`    Family: ${m.details.family}`);
              console.log(`    Parameters: ${m.details.parameter_size}`);
            }
            console.log('');
          });
        }
        break;
      }

      case 'pull': {
        const modelName = args[1];
        if (!modelName) {
          console.error('Usage: mh ollama pull <model-name>');
          console.error('Example: mh ollama pull phi3:mini');
          process.exit(1);
        }

        console.log(`Pulling model: ${modelName}...`);
        await ollama.pullModel(modelName, (status) => {
          process.stdout.write(`\r${status}              `);
        });
        console.log(`\n✓ Model ${modelName} installed`);
        break;
      }

      case 'delete': {
        const modelName = args[1];
        if (!modelName) {
          console.error('Usage: mh ollama delete <model-name>');
          process.exit(1);
        }

        console.log(`Deleting model: ${modelName}...`);
        await ollama.deleteModel(modelName);
        console.log(`✓ Model ${modelName} deleted`);
        break;
      }

      case 'info': {
        const modelName = args[1];
        if (!modelName) {
          console.error('Usage: mh ollama info <model-name>');
          process.exit(1);
        }

        const info = await ollama.showModel(modelName);
        console.log(`Model: ${modelName}\n`);
        console.log(JSON.stringify(info, null, 2));
        break;
      }

      case 'chat': {
        const modelName = args[1];
        if (!modelName) {
          console.error('Usage: mh ollama chat <model-name>');
          console.error('Example: mh ollama chat phi3:mini');
          process.exit(1);
        }

        console.log(`Starting chat with ${modelName}...`);
        console.log('Type "exit" or "quit" to end the session.\n');

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

        const chat = async () => {
          rl.question('You: ', async (input: string) => {
            if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
              console.log('Goodbye!');
              rl.close();
              return;
            }

            messages.push({ role: 'user', content: input });

            try {
              const response = await ollama.chat(modelName, messages);
              console.log(`\n${modelName}: ${response.message.content}\n`);
              messages.push({ role: 'assistant', content: response.message.content });

              // Audit the chat
              audit({
                level: 'info',
                category: 'action',
                event: 'ollama_chat',
                details: { model: modelName, messageCount: messages.length },
                actor: 'human',
              });

              chat();
            } catch (error) {
              console.error(`Error: ${(error as Error).message}`);
              chat();
            }
          });
        };

        chat();
        break;
      }

      case 'ask': {
        const modelName = args[1];
        const question = args.slice(2).join(' ');

        if (!modelName || !question) {
          console.error('Usage: mh ollama ask <model> "your question"');
          console.error('Example: mh ollama ask phi3:mini "What is TypeScript?"');
          process.exit(1);
        }

        console.log(`Asking ${modelName}...\n`);
        const response = await ollama.generate(modelName, question);
        console.log(response.response);

        // Audit the query
        audit({
          level: 'info',
          category: 'action',
          event: 'ollama_ask',
          details: { model: modelName, questionLength: question.length },
          actor: 'human',
        });
        break;
      }

      case 'doctor': {
        try {
          console.log('Ollama diagnostics:\n');
          const running = await ollama.isRunning();
          console.log(`- Running: ${running ? 'yes' : 'no'}`);
          if (!running) {
            console.log('  Start with: ollama serve');
            process.exit(1);
          }
          const ver = await ollama.version();
          console.log(`- Version: ${ver.version}`);
          const models = await ollama.listModels();
          console.log(`- Installed models: ${models.map(m => m.name).join(', ') || '(none)'}`);

          // Load preferred chat model from etc/models.json if present
          const modelsCfg = path.join(systemPaths.root, 'etc', 'models.json');
          let preferred = 'phi3:mini';
          if (fs.existsSync(modelsCfg)) {
            try {
              const registry = JSON.parse(fs.readFileSync(modelsCfg, 'utf8'));
              const fallbackId = registry.defaults?.fallback || 'default.fallback';
              const fallbackModel = registry.models?.[fallbackId];
              preferred = fallbackModel?.model || 'phi3:mini';
            } catch {}
          }
          const embedModel = 'nomic-embed-text';

          console.log(`- Preferred chat model: ${preferred}`);
          console.log(`- Embedding model: ${embedModel}`);

          const hasPreferred = models.some((m: any) => m.name === preferred);
          const hasEmbed = models.some((m: any) => m.name === embedModel);
          if (!hasPreferred) console.log(`  WARN: Chat model not installed. Install: mh ollama pull ${preferred}`);
          if (!hasEmbed) console.log(`  WARN: Embedding model not installed. Install: mh ollama pull ${embedModel}`);

          // Smoke test chat
          try {
            const resp = await ollama.generate(preferred, 'Say "ok".', { temperature: 0 });
            console.log(`- Chat test: ok (${Math.min(resp.response.length, 20)} chars)`);
          } catch (e) {
            console.log(`- Chat test: FAILED (${(e as Error).message})`);
          }

          // Smoke test embeddings
          try {
            const emb = await ollama.embeddings(embedModel, 'hello world');
            console.log(`- Embeddings test: ok (dim=${emb.embedding.length})`);
          } catch (e) {
            console.log(`- Embeddings test: FAILED (${(e as Error).message})`);
          }
        } catch (e) {
          console.error('Doctor failed:', (e as Error).message);
          process.exit(1);
        }
        break;
      }

      default:
        console.error(`Unknown subcommand: ${subcommand}`);
        console.error('Run: mh ollama (without args) for help');
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

export async function vllmCommand(args: string[]): Promise<void> {
  const subcommand = args[0] || '';

  if (!subcommand) {
    console.log(`
vLLM Management — Control local vLLM server
============================================

Usage: mh vllm <subcommand> [options]

Subcommands:
  status              Check if vLLM server is running
  start [options]     Start vLLM server
  stop                Stop vLLM server
  restart             Restart vLLM server

Start Options:
  --model <id>        HuggingFace model ID (default: from config)
  --gpu-util <0-1>    GPU memory utilization (default: 0.9)

Examples:
  mh vllm status
  mh vllm start --model Qwen/Qwen2.5-14B-Instruct
  mh vllm start --gpu-util 0.8
  mh vllm stop
`);
    return;
  }

  try {
    switch (subcommand) {
      case 'status': {
        const health = await vllm.getHealth();
        const config = loadBackendConfig();
        if (health.status === 'healthy' || health.status === 'starting') {
          console.log(`✅ vLLM server is ${health.status}`);
          console.log(`  - Endpoint: ${config.vllm.endpoint}`);
          console.log(`  - Model: ${health.model || '(unknown)'}`);
        } else {
          console.log(`❌ vLLM server is ${health.status}`);
        }
        break;
      }

      case 'start': {
        const config = loadBackendConfig();

        // Parse options
        let model = config.vllm.model;
        let gpuUtil = config.vllm.gpuMemoryUtilization;

        for (let i = 1; i < args.length; i++) {
          if (args[i] === '--model' && args[i + 1]) {
            model = args[++i];
          } else if (args[i] === '--gpu-util' && args[i + 1]) {
            gpuUtil = parseFloat(args[++i]);
          }
        }

        console.log(`Starting vLLM server with model: ${model}...`);
        console.log(`  GPU memory utilization: ${gpuUtil}`);

        const result = await vllm.startServer(await buildCliVLLMStartConfig(config, model, gpuUtil));

        if (result.success) {
          console.log(`✅ vLLM server started (PID: ${result.pid})`);
          console.log('  Note: Server may take a few minutes to load the model.');
        } else {
          console.error(`❌ Failed to start vLLM server: ${result.error}`);
          process.exit(1);
        }
        break;
      }

      case 'stop': {
        console.log('Stopping vLLM server...');
        await vllm.stopServer();
        console.log('✅ vLLM server stopped');
        break;
      }

      case 'restart': {
        const config = loadBackendConfig();

        console.log('Restarting vLLM server...');
        await vllm.stopServer();

        const result = await vllm.startServer(await buildCliVLLMStartConfig(config));

        if (result.success) {
          console.log(`✅ vLLM server restarted (PID: ${result.pid})`);
        } else {
          console.error(`❌ Failed to restart vLLM server: ${result.error}`);
          process.exit(1);
        }
        break;
      }

      default:
        console.error(`Unknown subcommand: ${subcommand}`);
        console.error('Run: mh vllm (without args) for help');
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

export async function backendCommand(args: string[]): Promise<void> {
  const subcommand = args[0] || '';

  if (!subcommand) {
    console.log(`
LLM Backend Management — Switch between Ollama and vLLM
========================================================

Usage: mh backend <subcommand> [options]

Subcommands:
  status              Show current backend status and configuration
  start               Start the configured backend
  switch <backend>    Switch to a different backend (ollama|vllm)
  detect              Detect available backends on the system

Examples:
  mh backend status
  mh backend start
  mh backend switch ollama
  mh backend switch vllm
  mh backend detect
`);
    return;
  }

  try {
    switch (subcommand) {
      case 'status': {
        const available = await detectAvailableBackends();
        const config = loadBackendConfig();

        console.log(`\nLLM Backend Status`);
        console.log(`==================`);
        console.log(`Active Backend: ${config.activeBackend.toUpperCase()}`);

        console.log(`\nOllama:`);
        console.log(`  - Status: ${available.ollama.running ? '✅ Running' : available.ollama.installed ? '⚪ Stopped' : '❌ Not installed'}`);
        console.log(`  - Endpoint: ${config.ollama.endpoint}`);
        if (available.ollama.model) {
          console.log(`  - Model: ${available.ollama.model}`);
        }
        if (config.activeBackend === 'ollama') {
          console.log(`  - [ACTIVE]`);
        }

        console.log(`\nvLLM:`);
        console.log(`  - Status: ${available.vllm.running ? '✅ Running' : available.vllm.installed ? '⚪ Stopped' : '❌ Not installed'}`);
        console.log(`  - Endpoint: ${config.vllm.endpoint}`);
        if (available.vllm.model) {
          console.log(`  - Model: ${available.vllm.model}`);
        }
        if (config.activeBackend === 'vllm') {
          console.log(`  - [ACTIVE]`);
        }
        break;
      }

      case 'start': {
        const config = loadBackendConfig();
        console.log(`Starting configured backend: ${config.activeBackend}...`);
        const shouldPrepareVllm = config.activeBackend === 'vllm'
          || (config.activeBackend === 'auto' && config.preferredLocalBackend === 'vllm');
        const result = await ensureBackendRunning({
          forceStart: true,
          vllmStartConfig: shouldPrepareVllm
            ? await buildCliVLLMStartConfig(config)
            : undefined,
        });

        if (!result.running) {
          console.error(`❌ Failed to start ${config.activeBackend}: ${result.error || 'unknown error'}`);
          process.exit(1);
        }

        console.log(`✅ Configured backend is running: ${config.activeBackend}`);
        break;
      }

      case 'switch': {
        const backend = args[1] as 'ollama' | 'vllm';
        if (!backend || !['ollama', 'vllm'].includes(backend)) {
          console.error('Usage: mh backend switch <ollama|vllm>');
          process.exit(1);
        }

        console.log(`Switching to ${backend}...`);
        const result = await switchBackend(backend, { actor: 'cli' });

        if (result.success) {
          console.log(`✅ Switched to ${backend}`);
        } else {
          console.error(`❌ Failed to switch: ${result.error}`);
          process.exit(1);
        }
        break;
      }

      case 'detect': {
        console.log('Detecting available backends...');
        const available = await detectAvailableBackends();

        console.log(`\nAvailable Backends:`);
        console.log(`  Ollama: ${available.ollama.installed ? '✅ Available' : '❌ Not available'}`);
        if (available.ollama.installed) {
          console.log(`    - Running: ${available.ollama.running ? 'Yes' : 'No'}`);
          if (available.ollama.model) {
            console.log(`    - Model: ${available.ollama.model}`);
          }
        }

        console.log(`  vLLM: ${available.vllm.installed ? '✅ Available' : '❌ Not available'}`);
        if (available.vllm.installed) {
          console.log(`    - Running: ${available.vllm.running ? 'Yes' : 'No'}`);
          if (available.vllm.model) {
            console.log(`    - Model: ${available.vllm.model}`);
          }
        }
        break;
      }

      default:
        console.error(`Unknown subcommand: ${subcommand}`);
        console.error('Run: mh backend (without args) for help');
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}
