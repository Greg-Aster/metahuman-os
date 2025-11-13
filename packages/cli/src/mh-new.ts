#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import fg from 'fast-glob';
import {
  paths,
  today,
  loadPersonaCore,
  loadDecisionRules,
  getIdentitySummary,
  setTrustLevel,
  captureEvent,
  createTask,
  updateTaskStatus,
  listActiveTasks,
  searchMemory,
  audit,
  auditDataChange,
  auditSecurity,
  ollama,
  listAvailableAgents,
  getAgentLogs,
  getAgentStats,
  getProcessingStatus,
  registerAgent,
  unregisterAgent,
  isAgentRunning,
  getRunningAgents,
  stopAgent,
  buildMemoryIndex,
  queryIndex,
  getIndexStatus,
  buildRagContext,
  // Voice training utilities
  getTrainingProgress,
  listVoiceSamples,
  deleteVoiceSample,
  exportTrainingDataset,
  // Multi-user support
  withUserContext,
  listUsers,
  getUserByUsername,
  getUserContext,
  type UserContext,
  // Runtime mode
  isHeadless,
} from '@metahuman/core';
import { personaCommand } from './commands/persona.js';
import { adapterCommand } from './commands/adapter.js';
import { sovitsCommand } from './commands/sovits.js';
import { rvcCommand } from './commands/rvc.js';

const agentScriptOverrides: Record<string, string> = {
  curiosity: 'curiosity-service.ts',
};

function ensureInitialized(): void {
  const required = [
    paths.personaCore,
    paths.personaDecisionRules,
    paths.personaRoutines,
    paths.personaRelationships,
  ];

  for (const file of required) {
    if (!fs.existsSync(file)) {
      console.error('MetaHuman not initialized. Run: mh init');
      process.exit(1);
    }
  }
}

function countEventsForYear(year: string): number {
  if (!fs.existsSync(paths.episodic)) return 0;

  let count = 0;
  const stack: string[] = [paths.episodic];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          const tsYear = data?.timestamp ? new Date(data.timestamp).getFullYear().toString() : '';
          if (tsYear === year) {
            count++;
          }
        } catch {
          // ignore malformed files
        }
      }
    }
  }

  return count;
}

function init(): void {
  // Create all required directories
  const dirs = [
    paths.persona,
    paths.episodic,
    paths.semantic,
    paths.procedural,
    paths.preferences,
    paths.inbox,
    paths.inboxArchive,
    paths.audioInbox,
    paths.audioTranscripts,
    paths.audioArchive,
    paths.tasks + '/active',
    paths.tasks + '/completed',
    paths.tasks + '/projects',
    paths.agents,
    paths.skills,
    paths.policies,
    paths.decisions,
    paths.actions,
    paths.sync,
    paths.logs + '/audit',
    paths.out,
  ];

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }

  console.log('✓ Directory structure created');

  // Copy template files to create working configs
  const templateMappings = [
    // Persona templates
    { template: paths.persona + '/core.json.template', target: paths.personaCore },
    { template: paths.persona + '/relationships.json.template', target: paths.persona + '/relationships.json' },
    { template: paths.persona + '/routines.json.template', target: paths.persona + '/routines.json' },
    { template: paths.persona + '/decision-rules.json.template', target: paths.persona + '/decision-rules.json' },
    // etc/ config templates (agent.json is now deprecated - use models.json instead)
    { template: paths.root + '/etc/boredom.json.template', target: paths.root + '/etc/boredom.json' },
    { template: paths.root + '/etc/audio.json.template', target: paths.root + '/etc/audio.json' },
    { template: paths.root + '/etc/sleep.json.template', target: paths.root + '/etc/sleep.json' },
    { template: paths.root + '/etc/voice.json.template', target: paths.root + '/etc/voice.json' },
    { template: paths.root + '/etc/autonomy.json.template', target: paths.root + '/etc/autonomy.json' },
    { template: paths.root + '/etc/ingestor.json.template', target: paths.root + '/etc/ingestor.json' },
    { template: paths.root + '/etc/logging.json.template', target: paths.root + '/etc/logging.json' },
  ];

  let copiedFiles = 0;
  let skippedFiles = 0;

  for (const { template, target } of templateMappings) {
    // Only copy if template exists and target doesn't
    if (fs.existsSync(template) && !fs.existsSync(target)) {
      try {
        fs.copyFileSync(template, target);
        copiedFiles++;
      } catch (error) {
        console.log(`  ! Failed to copy ${path.basename(template)}`);
      }
    } else if (fs.existsSync(target)) {
      skippedFiles++;
    }
  }

  if (copiedFiles > 0) {
    console.log(`✓ Copied ${copiedFiles} template files to create working configs`);
  }
  if (skippedFiles > 0) {
    console.log(`✓ Skipped ${skippedFiles} files (already exist)`);
  }

  // Check if persona files exist
  if (fs.existsSync(paths.personaCore)) {
    console.log('\n📝 Next steps:');
    console.log('  1. Edit persona/core.json with your details');
    console.log('  2. Update persona/routines.json with your schedule');
    console.log('  3. Review etc/*.json for runtime settings');
    console.log('  4. Run: mh status');

    // Audit initialization
    audit({
      level: 'info',
      category: 'system',
      event: 'system_initialized',
      details: { templatesCreated: copiedFiles, filesSkipped: skippedFiles },
      actor: 'human',
    });
  }
}

function status(): void {
  try {
    console.log(getIdentitySummary());

    console.log('\n📊 System Status');
    console.log('================\n');

    const activeTasks = listActiveTasks();
    console.log(`Active Tasks: ${activeTasks.length}`);

    if (activeTasks.length > 0) {
      console.log('\nTop Priority Tasks:');
      activeTasks.slice(0, 5).forEach(task => {
        console.log(`  [${task.priority}] ${task.title} (${task.status})`);
      });
    }

    // Check recent events
    const year = new Date().getFullYear().toString();
    const eventsThisYear = countEventsForYear(year);
    console.log(`\nRecent Events: ${eventsThisYear} this year`);

  } catch (error) {
    console.error('Not initialized. Run: mh init');
  }
}

function startServices(options: { restart?: boolean; force?: boolean } = {}): void {
  const restart = options.restart !== undefined ? options.restart : true;
  const force = options.force ?? false;
  ensureInitialized();

  // Always start headless-watcher (it manages other agents based on mode)
  const alwaysStart = ['headless-watcher'];

  // Only start these agents if NOT in headless mode
  // NOTE: Most agents are managed by scheduler-service via etc/agents.json
  // Only start essential standalone services here
  const conditionalAgents = [
    'scheduler-service',  // Timer bus - manages organizer, curiosity, etc.
    'audio-organizer'     // Audio processing service
  ];

  // Check headless mode for conditional agents
  const defaults = isHeadless()
    ? alwaysStart
    : [...alwaysStart, ...conditionalAgents];

  if (isHeadless()) {
    console.log('⚠️  Headless mode active - starting watcher only');
    console.log('   Other agents will resume when headless mode is disabled');
  }

  const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

  if (restart) {
    const running = getRunningAgents();
    const toRestart = running.filter(agent => defaults.includes(agent.name));
    if (toRestart.length > 0) {
      console.log('• Restarting background agents...');
      for (const agent of toRestart) {
        const result = stopAgent(agent.name, force);
        if (result.success) {
          // Wait up to 5 seconds for the agent to fully stop
          for (let attempt = 0; attempt < 25; attempt += 1) {
            if (!isAgentRunning(agent.name)) break;
            sleep(200);
          }
        } else {
          console.log(result.message);
        }
      }
    }
  }

  const spawnAgent = (agentName: string) => {
    const scriptName = agentScriptOverrides[agentName] ?? `${agentName}.ts`;
    const agentPath = `${paths.brain}/agents/${scriptName}`;

    if (!fs.existsSync(agentPath)) {
      console.warn(`Skipping ${agentName}: not found at ${agentPath}`);
      return;
    }

    // Check if already running using unified registry
    if (isAgentRunning(agentName)) {
      console.log(`• ${agentName} already running`);
      return;
    }

    console.log(`• Starting ${agentName}...`);
    // Use bootstrap wrapper to establish user context for agents
    const bootstrapPath = `${paths.brain}/agents/_bootstrap.ts`;
    const child = spawn('tsx', [bootstrapPath, agentName], {
      detached: true,
      stdio: 'ignore',
      cwd: paths.root,
      env: {
        ...process.env,
        NODE_PATH: [
          `${paths.root}/node_modules`,
          `${paths.root}/packages/cli/node_modules`,
          `${paths.root}/apps/site/node_modules`,
        ].join(':'),
      },
    });

    child.unref();

    // Register in running.json
    if (child.pid) {
      registerAgent(agentName, child.pid);

      audit({
        level: 'info',
        category: 'system',
        event: 'agent_started',
        details: { agent: agentName, pid: child.pid },
        actor: 'system',
      });
    }

    child.on('close', (code: number) => {
      if (code !== 0) console.error(`Agent ${agentName} exited with code ${code}`);
      audit({
        level: code === 0 ? 'info' : 'error',
        category: 'system',
        event: 'agent_stopped',
        details: { agent: agentName, exitCode: code },
        actor: 'system',
      });
      unregisterAgent(agentName);
    });

    child.on('error', (err: Error) => {
      console.error(`Failed to start ${agentName}: ${err.message}`);
      unregisterAgent(agentName);
    });
  };

  defaults.forEach(spawnAgent);
  console.log('Background services started (if not already running).');
}

function capture(args: string[]): void {
  ensureInitialized();

  const content = args.join(' ');
  if (!content) {
    console.error('Usage: mh capture "your observation here"');
    process.exit(1);
  }

  const filepath = captureEvent(content);
  console.log(`✓ Captured to: ${filepath}`);

  // Audit the capture
  auditDataChange({
    type: 'create',
    resource: 'episodic_event',
    path: filepath,
    actor: 'human',
    details: { contentLength: content.length },
  });
}

async function remember(args: string[]): Promise<void> {
  ensureInitialized();

  const query = args.join(' ');
  if (!query) {
    console.error('Usage: mh remember <search query>');
    process.exit(1);
  }

  // Prefer semantic search if index exists
  const status = getIndexStatus();
  if (status.exists) {
    try {
      const list = await queryIndex(query, { topK: 10 });
      if (list.length === 0) {
        console.log('No matches found');
        audit({ level: 'info', category: 'action', event: 'memory_search', details: { mode: 'semantic', query, results: 0 }, actor: 'human' });
        return;
      }
      console.log(`Top matches (semantic, model=${status.model}):\n`);
      list.forEach(({ item, score }) => {
        const rel = item.path.startsWith(paths.root) ? item.path.slice(paths.root.length + 1) : item.path;
        console.log(`  ${(score * 100).toFixed(1).padStart(5)}%  ${rel}`);
        console.log(`      ${item.text.slice(0, 100)}${item.text.length > 100 ? '…' : ''}`);
      });
      const topScore = list.length ? list[0].score : 0;
      audit({ level: 'info', category: 'action', event: 'memory_search', details: { mode: 'semantic', query, results: list.length, topScore }, actor: 'human' });
      return;
    } catch (err) {
      console.error('Semantic search failed, falling back:', (err as Error).message);
    }
  }

  const results = searchMemory(query);
  if (results.length === 0) console.log('No matches found');
  else {
    console.log(`Found ${results.length} matches:\n`);
    results.forEach(r => console.log(`  ${r}`));
  }
  audit({ level: 'info', category: 'action', event: 'memory_search', details: { mode: 'keyword', query, results: results.length }, actor: 'human' });
}

function task(args: string[]): void {
  ensureInitialized();

  const subcommand = args[0];

  if (!subcommand) {
    // List tasks
    const tasks = listActiveTasks();
    if (tasks.length === 0) {
      console.log('No active tasks');
      return;
    }

    console.log('Active Tasks:\n');
    tasks.forEach(t => {
      console.log(`[${t.priority}] ${t.title}`);
      console.log(`    Status: ${t.status} | ID: ${t.id}`);
      if (t.due) console.log(`    Due: ${t.due}`);
      console.log('');
    });
    return;
  }

  if (subcommand === 'add') {
    const title = args.slice(1).join(' ');
    if (!title) {
      console.error('Usage: mh task add "task title"');
      process.exit(1);
    }
    const filepath = createTask(title);
    console.log(`✓ Created: ${filepath}`);

    // Audit task creation
    auditDataChange({
      type: 'create',
      resource: 'task',
      path: filepath,
      actor: 'human',
      details: { title },
    });
  } else if (subcommand === 'done') {
    const taskId = args[1];
    if (!taskId) {
      console.error('Usage: mh task done <task-id>');
      process.exit(1);
    }
    updateTaskStatus(taskId, 'done');
    console.log(`✓ Task completed: ${taskId}`);

    // Audit task completion
    auditDataChange({
      type: 'update',
      resource: 'task',
      path: taskId,
      actor: 'human',
      details: { status: 'done' },
    });
  } else if (subcommand === 'start') {
    const taskId = args[1];
    if (!taskId) {
      console.error('Usage: mh task start <task-id>');
      process.exit(1);
    }
    updateTaskStatus(taskId, 'in_progress');
    console.log(`✓ Task started: ${taskId}`);

    // Audit task start
    auditDataChange({
      type: 'update',
      resource: 'task',
      path: taskId,
      actor: 'human',
      details: { status: 'in_progress' },
    });
  } else {
    console.error('Unknown subcommand. Usage: mh task [list|add|done|start]');
  }
}

function trust(args: string[]): void {
  ensureInitialized();

  const level = args[0];

  if (!level) {
    const rules = loadDecisionRules();
    console.log(`Current trust level: ${rules.trustLevel}`);
    console.log(`\nAvailable modes:`);
    rules.availableModes.forEach((mode: string) => {
      const desc = (rules as any).modeDescription?.[mode] ?? '';
      const current = mode === rules.trustLevel ? ' (current)' : '';
      console.log(`  ${mode}${current}`);
      if (desc) console.log(`    ${desc}`);
    });
    return;
  }

  setTrustLevel(level);
}

function sync(): void {
  ensureInitialized();

  console.log('🔄 Syncing...\n');

  // This would trigger background sync operations
  // For now, just show sync status

  const persona = loadPersonaCore();
  const rules = loadDecisionRules();

  console.log('Identity: ✓');
  console.log(`Trust Level: ${rules.trustLevel}`);
  console.log(`Last Updated: ${persona.lastUpdated}`);

  console.log('\n✓ Sync complete');
}

async function ollamaCmd(args: string[]): Promise<void> {
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
          const fsMod = require('node:fs');
          const pathMod = require('node:path');
          const modelsCfg = path.join(paths.root, 'etc', 'models.json');
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

async function find(args: string[]): Promise<void> {
  const description = args.join(' ');
  if (!description) {
    console.error('Usage: mh find <description of file>');
    console.error('Example: mh find the file that configures the database');
    process.exit(1);
  }

  console.log('🔍 Searching for files and asking the AI...');

  try {
    // 1. Get a list of all files in the project
    const files: string[] = await fg('**/*', { 
        cwd: paths.root,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
        absolute: false, // Use relative paths for a cleaner prompt
    });

    // 2. Construct the prompt
    const systemPrompt = `You are an expert programmer and your task is to find a specific file in a project based on a user's description. From the following list of file paths, please identify the single most likely path that matches the user's request. Respond with only the file path and nothing else.`;

    const userPrompt = `
User Request: "${description}"

File List:
----------
${files.join('\n')}
----------

Based on the user's request, what is the most likely file path?`;

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
    ];

    // 3. Ask the AI
    const model = 'phi3:mini';
    const response = await ollama.chat(model, messages);
    const filePath = response.message.content.trim();

    console.log(`\n🤖 The AI suggests this file:`);
    console.log(filePath);

  } catch (error) {
    console.error(`An error occurred: ${(error as Error).message}`);
  }
}

async function chat(): Promise<void> {
  ensureInitialized();

  const persona = loadPersonaCore();
  const model = 'phi3:mini'; // Or load from config

  const systemPrompt = `
    You are the digital personality extension of ${persona.identity.name}. Your purpose is to act as their parallel intelligence, assisting them in achieving their goals.

    Your personality is defined as: ${persona.personality.description}
    Your core values are: ${persona.values.core.map((v: any) => v.value).join(', ')}
    Your communication style should be: ${persona.personality.communicationStyle}

    Converse with the user, acting as their digital personality extension. Be helpful, proactive, and stay true to their defined persona.
  `.trim();

  console.log(`Connecting to your digital personality extension (${model})...`);
  console.log('Type "exit" or "quit" to end the session.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  const chatLoop = async () => {
    rl.question('You: ', async (input: string) => {
      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        console.log('Disconnected from digital personality extension.');
        rl.close();
        return;
      }

      // Augment with retrieved context if available
      let augmented = input;
      const idxStatus = getIndexStatus();
      if (idxStatus.exists) {
        try {
          const hits = await queryIndex(input, { topK: 8 });
          const threshold = 0.3;
          const filtered = hits.filter(h => h.score >= threshold);
          // If no semantic grounding, answer conservatively and skip model call
          if (filtered.length === 0) {
            const topScore = hits.length > 0 ? hits[0].score : 0;
            audit({
              level: 'info',
              category: 'action',
              event: 'chat_context_retrieved',
              details: { query: input, topScore, used: 0, total: hits.length, threshold, model: idxStatus.model },
              actor: 'system',
            });
            console.log("\ndigital personality extension: I'm not sure — I don't have that in my memory yet.\n");
            return chatLoop();
          }
          const ctx = buildRagContext(filtered, 1800);
          augmented = `${input}\n\n[Context]\n${ctx}`;
          // Audit retrieval
          const topScore = hits.length > 0 ? hits[0].score : 0;
          audit({
            level: 'info',
            category: 'action',
            event: 'chat_context_retrieved',
            details: { query: input, topScore, used: filtered.length, total: hits.length, threshold, model: idxStatus.model },
            actor: 'system',
          });
        } catch {}
      }

      // Reinforce strict grounding per turn
      messages.push({ role: 'system', content: 'Answer only from the provided context. If the context lacks the answer, reply: "I don\'t know".' });
      messages.push({ role: 'user', content: augmented });

      try {
        const response = await ollama.chat(model, messages);
        console.log(`\ndigital personality extension: ${response.message.content}\n`);
        messages.push({ role: 'assistant', content: response.message.content });

        chatLoop();
      } catch (error) {
        console.error(`Error: ${(error as Error).message}`);
        chatLoop();
      }
    });
  };

  chatLoop();
}

function help(): void {
  console.log(`
MetaHuman OS — Command Line Interface
======================================

Usage: mh <command> [options]

Core Commands:
  init                Initialize MetaHuman OS directory structure
  status              Show system status and identity summary
  start               Start background services (organizer, boredom)
  chat                Converse with your digital personality extension (persona-aware)
  sync                Sync state and update models

Memory & Capture:
  capture "text"      Capture an observation or event
  remember <query>    Search across memory (semantic if indexed)
  find <description>  Use AI to find a file by description

Identity & Trust:
  trust               Show current trust level
  trust <level>       Set trust level (observe|suggest|supervised_auto|bounded_auto)

Persona & Adaptation:
  persona status      Show active profile and adapter state
  persona activate    Generate and activate daily profile (run morning-loader)
  persona diff        Compare base persona vs active profile

LoRA Adapters:
  adapter list        List all datasets (pending, approved, trained)
  adapter review <date>   Review dataset and show sample pairs
  adapter approve <date>  Approve dataset for training
  adapter train <date>    Train LoRA adapter (requires approval)

Agents & Automation:
  agent run <name>    Run a background agent (e.g., 'organizer')
  agent list          List available agents
  agent status        Show agent run statistics
  agent logs [name]   View recent agent activity
  agent monitor       Show memory processing status

Ollama & AI:
  ollama status       Check if Ollama is running
  ollama list         List installed models
  ollama pull <model> Install a model (e.g., phi3:mini)
  ollama chat <model> Interactive chat with a raw model (not persona-aware)
  ollama ask <model>  Ask a one-shot question

Audio Processing:
  audio ingest <path> Copy audio files to inbox for transcription
  audio status        Show audio processing status
  audio list          List audio files and transcripts
  audio info <id>     Show details for an audio file

Voice Training:
  voice status        Show voice training progress
  voice list          List collected voice samples
  voice delete <id>   Delete a voice sample
  voice export        Export dataset for training

Indexing:
  index build         Build embeddings index over memory
  index query "text"  Semantic search using the index

Guide:
  guide               Show path to the user guide

Multi-User Management:
  user list           List all registered users
  user whoami         Show current user context
  user info <name>    Show detailed info for a user

Multi-User Usage:
  --user <name>       Run command as specific user (or -u)

Examples:
  mh chat
  mh capture "Met with Sarah about ML project"
  mh agent run organizer
  mh ollama pull phi3:mini

  mh --user alice capture "Had coffee with Bob"
  mh -u bob task add "Review PR"
  mh user list

Security:
  - Admin users (ADMIN_USERS in .env) can modify system files
  - Regular users can only modify files in their own profile
  - All data isolated per user in profiles/<username>/

For more information, see DESIGN.md and ARCHITECTURE.md
`.trim());
}

  function agent(args: string[]): void {
  ensureInitialized();
  const subcommand = args[0];

  if (!subcommand) {
    console.error('Usage: mh agent <subcommand> [args]');
    console.error('\nSubcommands:');
    console.error('  run <name>          Run an agent');
    console.error('  list                List available agents');
    console.error('  status [name]       Show agent statistics');
    console.error('  logs [name]         View recent agent logs');
    console.error('  monitor             Show memory processing status');
    process.exit(1);
  }

  switch (subcommand) {
    case 'run': {
      const agentName = args[1];

      if (!agentName) {
        console.error('Usage: mh agent run <agent-name>');
        process.exit(1);
      }

      // Single-instance guard using running.json registry
      if (isAgentRunning(agentName)) {
        console.error(`Agent '${agentName}' is already running. Use: mh agent stop ${agentName}`);
        process.exit(1);
      }

      const agentPath = `${paths.brain}/agents/${agentName}.ts`;

      if (!fs.existsSync(agentPath)) {
        console.error(`Agent not found: ${agentName} at ${agentPath}`);
        process.exit(1);
      }

      console.log(`Spawning agent: ${agentName}...`);

      // Use bootstrap wrapper to establish user context for agents
      const bootstrapPath = `${paths.brain}/agents/_bootstrap.ts`;
      const child = spawn('tsx', [bootstrapPath, agentName], {
        stdio: 'inherit',
        cwd: paths.root,
        env: {
          ...process.env,
          // Ensure workspace module resolution for agents outside a package context
          NODE_PATH: [
            `${paths.root}/node_modules`,
            `${paths.root}/packages/cli/node_modules`,
            `${paths.root}/apps/site/node_modules`,
          ].join(':'),
        },
      });

      // Register agent in running.json
      if (child.pid) {
        registerAgent(agentName, child.pid);

        audit({
          level: 'info',
          category: 'system',
          event: 'agent_started',
          details: { agent: agentName, pid: child.pid },
          actor: 'system',
        });
      }

      child.on('error', (err: Error) => {
        console.error(`Failed to start agent: ${err.message}`);
        unregisterAgent(agentName);
      });

      child.on('close', (code: number) => {
        if (code !== 0) {
          console.error(`Agent ${agentName} exited with code ${code}`);
        }
        audit({
          level: code === 0 ? 'info' : 'error',
          category: 'system',
          event: 'agent_stopped',
          details: { agent: agentName, exitCode: code },
          actor: 'system',
        });
        unregisterAgent(agentName);
      });
      break;
    }

    case 'list': {
      const agents = listAvailableAgents();
      if (agents.length === 0) {
        console.log('No agents found');
      } else {
        console.log(`Available Agents (${agents.length}):\n`);
        agents.forEach(name => {
          console.log(`  ${name}`);
        });
      }
      break;
    }

    case 'status': {
      const agentName = args[1];

      if (!agentName) {
        const agents = listAvailableAgents();
        console.log('Agent Status Summary:\n');
        agents.forEach(name => {
          const stats = getAgentStats(name);
          console.log(`  ${name}:`);
          console.log(`    Total runs: ${stats.totalRuns}`);
          console.log(`    Successful: ${stats.successfulRuns}`);
          console.log(`    Failed: ${stats.failedRuns}`);
          if (stats.lastRun) {
            console.log(`    Last run: ${new Date(stats.lastRun).toLocaleString()}`);
          }
          console.log('');
        });
      } else {
        const stats = getAgentStats(agentName);
        console.log(`Agent: ${agentName}\n`);
        console.log(`Total runs: ${stats.totalRuns}`);
        console.log(`Successful: ${stats.successfulRuns}`);
        console.log(`Failed: ${stats.failedRuns}`);
        if (stats.lastRun) {
          console.log(`Last run: ${new Date(stats.lastRun).toLocaleString()}`);
        }
      }
      break;
    }

    case 'logs': {
      const agentName = args[1];
      const logs = getAgentLogs(agentName, 20);

      if (logs.length === 0) {
        console.log('No logs found');
      } else {
        console.log(`Recent Agent Logs${agentName ? ` for ${agentName}` : ''}:\n`);
        logs.forEach(log => {
          const time = new Date(log.timestamp).toLocaleTimeString();
          const level = log.level.toUpperCase().padEnd(5);
          console.log(`[${time}] [${level}] ${log.agent}: ${log.message}`);
        });
      }
      break;
    }

    case 'monitor': {
      const status = getProcessingStatus();
      console.log('Memory Processing Status:\n');
      console.log(`Total memories: ${status.totalMemories}`);
      console.log(`Processed: ${status.processedMemories}`);
      console.log(`Unprocessed: ${status.unprocessedMemories}`);

      if (status.totalMemories > 0) {
        const percentage = ((status.processedMemories / status.totalMemories) * 100).toFixed(1);
        console.log(`Completion: ${percentage}%`);
      }
      break;
    }

    case 'ps': {
      const running = getRunningAgents();
      if (running.length === 0) {
        console.log('No agents currently running.');
        break;
      }
      console.log('Running agents:\n');
      for (const agent of running) {
        const uptime = Math.floor((Date.now() - new Date(agent.startTime).getTime()) / 1000);
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const seconds = uptime % 60;
        const uptimeStr = hours > 0 ? `${hours}h ${minutes}m` : minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
        console.log(`  ${agent.name.padEnd(20)} pid=${agent.pid.toString().padEnd(6)} uptime=${uptimeStr.padEnd(10)} started ${agent.startTime}`);
      }
      break;
    }

    case 'stop': {
      const target = args[1];
      const force = args.includes('--force');
      if (!target) {
        console.error('Usage: mh agent stop <name>|--all [--force]');
        process.exit(1);
      }

      const stopOne = (name: string) => {
        const result = stopAgent(name, force);
        if (result.success) {
          console.log(`${result.message} (pid ${result.pid})`);
        } else {
          console.log(result.message);
        }
      };

      if (target === '--all') {
        const running = getRunningAgents();
        if (running.length === 0) {
          console.log('No agents currently running.');
        } else {
          running.forEach(agent => stopOne(agent.name));
        }
      } else {
        stopOne(target);
      }
      break;
    }

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error('Run: mh agent (without args) for help');
      process.exit(1);
  }
}

function ingestCmd(args: string[]): void {
  ensureInitialized();

  const src = args[0];
  if (!src) {
    console.error('Usage: mh ingest <file-or-directory>');
    process.exit(1);
  }

  const abs = path.resolve(process.cwd(), src);
  const copied: string[] = [];

  const copyFile = (p: string) => {
    const name = path.basename(p);
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const destName = `${stamp}-${name}`;
    const dest = path.join(paths.inbox, destName);
    fs.mkdirSync(paths.inbox, { recursive: true });
    fs.copyFileSync(p, dest);
    copied.push(dest);
  };

  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    // Copy first-level files only
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.isFile()) {
        copyFile(path.join(abs, entry.name));
      }
    }
  } else if (stat.isFile()) {
    copyFile(abs);
  } else {
    console.error('Path is neither file nor directory:', abs);
    process.exit(1);
  }

  console.log(`Copied ${copied.length} file(s) to inbox: ${paths.inbox}`);
  console.log('Run: mh agent run ingestor');
}

async function indexCmd(args: string[]): Promise<void> {
  ensureInitialized();
  const sub = args[0];
  if (!sub) {
    console.error('Usage: mh index <build|query> [args]');
    process.exit(1);
  }

  switch (sub) {
    case 'build': {
      console.log('Building memory embeddings index...');
      try {
        const dest = await buildMemoryIndex();
        const status = getIndexStatus();
        console.log(`✓ Index written: ${dest}`);
        console.log(`  Items: ${status.items} | Model: ${status.model} | Provider: ${status.provider}`);
      } catch (err) {
        console.error('Failed to build index:', (err as Error).message);
        console.error('Tip: ensure Ollama is running (ollama serve) and model installed (mh ollama pull nomic-embed-text).');
        process.exit(1);
      }
      break;
    }
    case 'query': {
      const q = args.slice(1).join(' ');
      if (!q) {
        console.error('Usage: mh index query "text"');
        process.exit(1);
      }
      try {
        const results = await queryIndex(q, { topK: 10 });
        if (results.length === 0) {
          console.log('No results');
          return;
        }
        console.log(`Top matches:\n`);
        results.forEach(({ item, score }) => {
          const rel = item.path.startsWith(paths.root) ? item.path.slice(paths.root.length + 1) : item.path;
          console.log(`  ${(score * 100).toFixed(1).padStart(5)}%  ${rel}`);
          console.log(`      ${item.text.slice(0, 120)}${item.text.length > 120 ? '…' : ''}`);
        });
      } catch (err) {
        console.error('Query failed:', (err as Error).message);
        process.exit(1);
      }
      break;
    }
    default:
      console.error(`Unknown subcommand: ${sub}`);
      process.exit(1);
  }
}

function audioCmd(args: string[]): void {
  ensureInitialized();
  const subcommand = args[0];

  if (!subcommand) {
    console.error('Usage: mh audio <subcommand> [args]');
    console.error('\nSubcommands:');
    console.error('  ingest <file-or-dir> Copy audio files to inbox for transcription');
    console.error('  status              Show audio processing status');
    console.error('  list                List audio files in inbox and transcripts');
    console.error('  info <audio-id>     Show details for a specific audio file');
    process.exit(1);
  }

  switch (subcommand) {
    case 'ingest': {
      const src = args[1];
      if (!src) {
        console.error('Usage: mh audio ingest <file-or-directory>');
        console.error('\nExample:');
        console.error('  mh audio ingest recording.wav');
        console.error('  mh audio ingest ~/recordings/');
        process.exit(1);
      }

      const abs = path.resolve(process.cwd(), src);
      const copied: string[] = [];

      const copyFile = (p: string) => {
        const name = path.basename(p);
        const ext = path.extname(p).toLowerCase();

        // Only copy audio files
        const audioExts = ['.wav', '.mp3', '.m4a', '.ogg', '.flac', '.aac', '.wma'];
        if (!audioExts.includes(ext)) {
          console.warn(`Skipping non-audio file: ${name}`);
          return;
        }

        const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
        const destName = `${stamp}-${name}`;
        const dest = path.join(paths.audioInbox, destName);
        fs.mkdirSync(paths.audioInbox, { recursive: true });
        fs.copyFileSync(p, dest);
        copied.push(dest);
      };

      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        // Copy first-level audio files only
        for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
          if (entry.isFile()) {
            copyFile(path.join(abs, entry.name));
          }
        }
      } else if (stat.isFile()) {
        copyFile(abs);
      } else {
        console.error('Path is neither file nor directory:', abs);
        process.exit(1);
      }

      if (copied.length === 0) {
        console.log('No audio files found to ingest.');
        console.log('Supported formats: .wav, .mp3, .m4a, .ogg, .flac, .aac, .wma');
        process.exit(0);
      }

      console.log(`✓ Copied ${copied.length} audio file(s) to inbox: ${paths.audioInbox}`);
      console.log('\n💡 Next steps:');
      console.log('   1. Start the transcriber: mh agent run transcriber');
      console.log('   2. Or wait for nightly processing (if sleep-service is running)');

      // Audit the ingestion
      auditDataChange({
        type: 'create',
        resource: 'audio_inbox',
        path: paths.audioInbox,
        actor: 'human',
        details: { fileCount: copied.length, source: abs },
      });
      break;
    }

    case 'status': {
      // Count files in each stage
      const inboxFiles = fs.existsSync(paths.audioInbox)
        ? fs.readdirSync(paths.audioInbox).filter(f => !f.startsWith('.')).length
        : 0;

      const transcriptFiles = fs.existsSync(paths.audioTranscripts)
        ? fs.readdirSync(paths.audioTranscripts).filter(f => f.endsWith('.txt')).length
        : 0;

      const archiveFiles = fs.existsSync(paths.audioArchive)
        ? fs.readdirSync(paths.audioArchive).filter(f => !f.startsWith('.')).length
        : 0;

      // Count unorganized transcripts
      let unorganizedCount = 0;
      if (fs.existsSync(paths.audioTranscripts)) {
        const metaFiles = fs.readdirSync(paths.audioTranscripts).filter(f => f.endsWith('.meta.json'));
        for (const metaFile of metaFiles) {
          try {
            const metaPath = path.join(paths.audioTranscripts, metaFile);
            const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            if (!metadata.organized) {
              unorganizedCount++;
            }
          } catch {}
        }
      }

      console.log('Audio Processing Status');
      console.log('======================\n');
      console.log(`Inbox (pending transcription):  ${inboxFiles}`);
      console.log(`Transcripts (total):            ${transcriptFiles}`);
      console.log(`  - Unorganized:                ${unorganizedCount}`);
      console.log(`  - Organized:                  ${transcriptFiles - unorganizedCount}`);
      console.log(`Archive (processed):            ${archiveFiles}\n`);

      if (inboxFiles > 0) {
        console.log('💡 Tip: Start the transcriber agent to process inbox files');
        console.log('   Run: mh agent run transcriber');
      }
      if (unorganizedCount > 0) {
        console.log('💡 Tip: Start the audio-organizer agent to create memories');
        console.log('   Run: mh agent run audio-organizer');
      }
      break;
    }

    case 'list': {
      console.log('Audio Files\n');

      // List inbox
      if (fs.existsSync(paths.audioInbox)) {
        const inboxFiles = fs.readdirSync(paths.audioInbox).filter(f => !f.startsWith('.'));
        if (inboxFiles.length > 0) {
          console.log('📥 Inbox (pending transcription):');
          inboxFiles.forEach(f => console.log(`  - ${f}`));
          console.log('');
        }
      }

      // List transcripts
      if (fs.existsSync(paths.audioTranscripts)) {
        const transcriptFiles = fs.readdirSync(paths.audioTranscripts).filter(f => f.endsWith('.txt'));
        if (transcriptFiles.length > 0) {
          console.log('📝 Transcripts:');
          transcriptFiles.forEach(f => {
            const audioId = f.replace('.txt', '');
            const metaPath = path.join(paths.audioTranscripts, `${audioId}.meta.json`);
            let status = '';
            if (fs.existsSync(metaPath)) {
              try {
                const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                status = metadata.organized ? ' ✓ organized' : ' ⏳ pending organization';
              } catch {}
            }
            console.log(`  - ${audioId}${status}`);
          });
        }
      }
      break;
    }

    case 'info': {
      const audioId = args[1];
      if (!audioId) {
        console.error('Usage: mh audio info <audio-id>');
        process.exit(1);
      }

      const metaPath = path.join(paths.audioTranscripts, `${audioId}.meta.json`);
      const transcriptPath = path.join(paths.audioTranscripts, `${audioId}.txt`);

      if (!fs.existsSync(metaPath)) {
        console.error(`Audio file not found: ${audioId}`);
        process.exit(1);
      }

      const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

      console.log(`Audio File: ${audioId}`);
      console.log('='.repeat(50));
      console.log(`Original File:   ${metadata.originalFile}`);
      console.log(`Transcribed At:  ${metadata.transcribedAt}`);
      console.log(`Model:           ${metadata.model}`);
      console.log(`Language:        ${metadata.language}`);
      console.log(`Status:          ${metadata.organized ? 'Organized' : 'Pending organization'}`);

      if (fs.existsSync(transcriptPath)) {
        const transcript = fs.readFileSync(transcriptPath, 'utf8');
        const charCount = transcript.length;
        const wordCount = transcript.split(/\s+/).length;
        console.log(`\nTranscript:      ${charCount} characters, ~${wordCount} words`);
        console.log(`\nPreview:`);
        console.log(transcript.substring(0, 300) + (transcript.length > 300 ? '...' : ''));
      }
      break;
    }

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error('Run: mh audio (without args) for help');
      process.exit(1);
  }
}

function voiceCmd(args: string[]): void {
  ensureInitialized();
  const subcommand = args[0];

  if (!subcommand) {
    console.error('Usage: mh voice <subcommand> [args]');
    console.error('\nSubcommands:');
    console.error('  status              Show voice training progress');
    console.error('  list                List collected voice samples');
    console.error('  delete <id>         Delete a voice sample');
    console.error('  export              Export dataset for training');
    process.exit(1);
  }


  switch (subcommand) {
    case 'status': {
      const progress = getTrainingProgress();

      console.log('Voice Training Progress');
      console.log('======================\n');
      console.log(`Samples collected: ${progress.samplesCollected}`);

      const hours = Math.floor(progress.totalDuration / 3600);
      const minutes = Math.floor((progress.totalDuration % 3600) / 60);
      const seconds = Math.floor(progress.totalDuration % 60);
      const targetHours = Math.floor(progress.targetDuration / 3600);

      console.log(`Total duration: ${hours}h ${minutes}m ${seconds}s / ${targetHours}h 0m 0s`);
      console.log(`Progress: ${progress.percentComplete.toFixed(1)}%`);
      console.log(`Estimated quality: ${(progress.estimatedQuality * 100).toFixed(0)}%`);

      if (progress.readyForTraining) {
        console.log(`\n✓ Ready for training! Run: mh voice export`);
      } else {
        const needed = progress.targetDuration - progress.totalDuration;
        const neededHours = Math.floor(needed / 3600);
        const neededMinutes = Math.floor((needed % 3600) / 60);
        console.log(`\nStatus: Collecting... (need ${neededHours}h ${neededMinutes}m more)`);
      }
      break;
    }

    case 'list': {
      const samples = listVoiceSamples();

      if (samples.length === 0) {
        console.log('No voice samples collected yet.');
        console.log('\nStart having voice conversations to collect samples!');
        break;
      }

      console.log(`Voice Training Samples (${samples.length} total)`);
      console.log('='.repeat(50) + '\n');

      const displayCount = Math.min(samples.length, 20);
      for (let i = 0; i < displayCount; i++) {
        const sample = samples[i];
        const transcript = fs.readFileSync(sample.transcriptPath, 'utf-8');

        console.log(`${i + 1}. ${sample.id}`);
        console.log(`   Duration: ${sample.duration.toFixed(1)}s | Quality: ${(sample.quality * 100).toFixed(0)}%`);
        console.log(`   "${transcript.slice(0, 60)}${transcript.length > 60 ? '...' : ''}"`);
        console.log('');
      }

      if (samples.length > displayCount) {
        console.log(`... and ${samples.length - displayCount} more`);
      }
      break;
    }

    case 'delete': {
      const sampleId = args[1];
      if (!sampleId) {
        console.error('Usage: mh voice delete <sample-id>');
        process.exit(1);
      }

      if (deleteVoiceSample(sampleId)) {
        console.log(`✓ Deleted sample: ${sampleId}`);
      } else {
        console.error(`✗ Failed to delete sample: ${sampleId}`);
        process.exit(1);
      }
      break;
    }

    case 'export': {
      const exportDir = exportTrainingDataset();
      console.log(`✓ Training dataset exported to: ${exportDir}`);
      console.log('\nNext steps:');
      console.log('  1. Train using Piper training tools');
      console.log('  2. Or upload to Google Colab for cloud training');
      console.log('\nSee docs/VOICE_CLONING_PASSIVE.md for training instructions');
      break;
    }

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      console.error('Run: mh voice (without args) for help');
      process.exit(1);
  }
}

/**
 * Extract --user flag from arguments
 * Returns { username, filteredArgs }
 */
function extractUserFlag(args: string[]): { username: string | null; filteredArgs: string[] } {
  const userFlagIndex = args.findIndex(arg => arg === '--user' || arg === '-u');

  if (userFlagIndex === -1) {
    return { username: null, filteredArgs: args };
  }

  const username = args[userFlagIndex + 1];
  if (!username || username.startsWith('-')) {
    console.error('Error: --user flag requires a username');
    process.exit(1);
  }

  // Remove --user and username from args
  const filteredArgs = [
    ...args.slice(0, userFlagIndex),
    ...args.slice(userFlagIndex + 2)
  ];

  return { username, filteredArgs };
}

/**
 * User management commands
 */
function userCmd(args: string[]): void {
  const [subcommand, ...subargs] = args;

  switch (subcommand) {
    case 'list': {
      const users = listUsers();
      console.log('\nRegistered Users:');
      console.log('─'.repeat(50));

      if (users.length === 0) {
        console.log('No users registered yet.');
        console.log('\nTo register a new user, use the web UI at http://localhost:4321');
        return;
      }

      const adminUsers = (process.env.ADMIN_USERS || '').split(',').map(u => u.trim());

      for (const user of users) {
        const isAdmin = adminUsers.includes(user.username);
        const badge = isAdmin ? ' [ADMIN]' : '';
        const roleColor = user.role === 'owner' ? '\x1b[35m' : '\x1b[36m';  // Purple for owner, cyan for guest
        const reset = '\x1b[0m';

        console.log(`${roleColor}●${reset} ${user.username}${badge}`);
        console.log(`  Role: ${user.role}`);
        console.log(`  ID: ${user.id}`);
        if (user.lastLogin) {
          console.log(`  Last Login: ${new Date(user.lastLogin).toLocaleString()}`);
        }
        console.log('');
      }
      break;
    }

    case 'whoami': {
      const ctx = getUserContext();
      if (!ctx) {
        console.log('No user context active (running as system/root)');
        console.log('Use --user <username> to run commands as a specific user');
        return;
      }

      console.log('\nCurrent User Context:');
      console.log('─'.repeat(50));
      console.log(`Username: ${ctx.username}`);
      console.log(`User ID: ${ctx.userId}`);
      console.log(`Role: ${ctx.role}`);

      const adminUsers = (process.env.ADMIN_USERS || '').split(',').map(u => u.trim());
      if (adminUsers.includes(ctx.username)) {
        console.log(`Admin: Yes`);
      }
      break;
    }

    case 'info': {
      const username = subargs[0];
      if (!username) {
        console.error('Error: user info requires a username');
        console.error('Usage: mh user info <username>');
        process.exit(1);
      }

      const user = getUserByUsername(username);
      if (!user) {
        console.error(`Error: User '${username}' not found`);
        process.exit(1);
      }

      const adminUsers = (process.env.ADMIN_USERS || '').split(',').map(u => u.trim());
      const isAdmin = adminUsers.includes(user.username);

      console.log(`\nUser: ${user.username}`);
      console.log('─'.repeat(50));
      console.log(`ID: ${user.id}`);
      console.log(`Role: ${user.role}`);
      console.log(`Admin: ${isAdmin ? 'Yes' : 'No'}`);
      console.log(`Created: ${new Date(user.createdAt).toLocaleString()}`);
      if (user.lastLogin) {
        console.log(`Last Login: ${new Date(user.lastLogin).toLocaleString()}`);
      }
      if (user.metadata?.displayName) {
        console.log(`Display Name: ${user.metadata.displayName}`);
      }
      if (user.metadata?.email) {
        console.log(`Email: ${user.metadata.email}`);
      }

      // Show profile path
      const profilePath = path.join(paths.root, 'profiles', username);
      if (fs.existsSync(profilePath)) {
        console.log(`\nProfile Path: ${profilePath}`);
      }
      break;
    }

    default:
      console.log('User Management Commands:');
      console.log('  mh user list          List all registered users');
      console.log('  mh user whoami        Show current user context');
      console.log('  mh user info <name>   Show detailed info for a user');
      console.log('');
      console.log('Multi-User CLI Usage:');
      console.log('  mh --user <username> <command>    Run command as specific user');
      console.log('  mh -u <username> <command>        Short form');
      console.log('');
      console.log('Examples:');
      console.log('  mh --user alice capture "Had coffee with Bob"');
      console.log('  mh -u bob task add "Review PR"');
      console.log('  mh --user charlie remember "project"');
  }
}

async function main() {
  // Extract --user flag before parsing command
  const allArgs = process.argv.slice(2);
  const { username, filteredArgs } = extractUserFlag(allArgs);
  const [command = 'help', ...args] = filteredArgs;

  // If --user flag is provided, set up user context
  let userContext: UserContext | null = null;
  if (username) {
    const user = getUserByUsername(username);
    if (!user) {
      console.error(`Error: User '${username}' not found`);
      console.error('\nRun: mh user list  (to see all users)');
      process.exit(1);
    }

    userContext = {
      userId: user.id,
      username: user.username,
      role: user.role,
    };

    // Show context info for clarity
    console.log(`\x1b[36m→ Running as user: ${username}\x1b[0m\n`);
  }

  // Execute command (wrap with context if provided)
  const executeCommand = async () => {
    try {
      switch (command) {
      case 'start': {
        const restart = args.includes('--restart') || args.includes('-r') || args.length === 0;
        const force = args.includes('--force') || args.includes('-f');
        startServices({ restart, force });
        break;
      }
      case 'init':
        init();
        break;
      case 'status':
        status();
        break;
      case 'capture':
        capture(args);
        break;
      case 'remember':
        await remember(args);
        break;
      case 'find':
        await find(args);
        break;
      case 'task':
        task(args);
        break;
      case 'trust':
        trust(args);
        break;
      case 'chat':
        await chat();
        break;
      case 'agent':
        agent(args);
        break;
      case 'ingest':
        ingestCmd(args);
        break;
      case 'ollama':
        await ollamaCmd(args);
        break;
      case 'guide':
        console.log(`User Guide: ${paths.root}/docs/USER_GUIDE.md`);
        break;
      case 'sync':
        sync();
        break;
      case 'index':
        await indexCmd(args);
        break;
      case 'audio':
        audioCmd(args);
        break;
      case 'persona':
        personaCommand(args);
        break;
      case 'adapter':
        adapterCommand(args);
        break;
      case 'sovits':
        await sovitsCommand(args);
        break;
      case 'rvc':
        await rvcCommand(args);
        break;
      case 'voice':
        voiceCmd(args);
        break;
      case 'user':
        userCmd(args);
        break;
      case 'help':
      case '--help':
      case '-h':
        help();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.error('Run: mh help');
        process.exit(1);
      }
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  };

  // Wrap with user context if provided
  if (userContext) {
    await withUserContext(userContext, executeCommand);
  } else {
    await executeCommand();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
