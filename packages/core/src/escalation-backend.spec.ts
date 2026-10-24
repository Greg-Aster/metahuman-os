import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mh-escalation-'));
process.env.METAHUMAN_ROOT = root;
fs.mkdirSync(path.join(root, 'etc'));
const configPath = path.join(root, 'etc', 'tool-executor.json');
const { setAuditEnabled } = await import('./audit.js');
setAuditEnabled(false);
const { eventBus } = await import('./infrastructure/event-bus/client.js');
eventBus.disconnect();
const registry = await import('./escalation-backend.js');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('concurrent initialization waits for all supported backends', async () => {
  await Promise.all(Array.from({ length: 8 }, () => registry.ensureBackendsInitialized()));
  assert.deepEqual(registry.listBackends().map(backend => backend.id).sort(), [
    'aider', 'claude-code', 'codex', 'gemini-cli', 'qwen-code',
  ]);
});

const calls: string[] = [];
let receivedOptions: import('./escalation-backend.js').EscalationOptions | undefined;
let receivedPrompt = '';
function installFixtureBackends() {
  calls.length = 0;
  for (const id of ['claude-code', 'codex']) {
    registry.registerBackend({
      id, name: id, description: 'test fixture', supportsStreaming: false,
      async isAvailable() { calls.push(`available:${id}`); return true; },
      isReady() { return true; },
      async start() { calls.push(`start:${id}`); return true; },
      stop() {},
      async execute(prompt, options) { receivedPrompt = prompt; receivedOptions = options; calls.push(`execute:${id}`); return { success: true, output: id }; },
    });
  }
}

test('a retired or unknown explicit provider never invokes the default backend', async () => {
  installFixtureBackends();
  for (const preferredBackend of ['open-interpreter', 'ollama', 'openai', 'missing-provider']) {
    const result = await registry.escalate('fixture', { preferredBackend });
    assert.equal(result.success, false);
    assert.match(result.error || '', /not registered.*Settings/);
  }
  assert.deepEqual(calls, []);
});

test('an unavailable saved default never falls through to another backend', async () => {
  installFixtureBackends();
  for (const config of [
    { activeBackend: 'claude-code', escalation: { defaultBackend: 'open-interpreter' } },
    { activeBackend: 'open-interpreter', escalation: { defaultBackend: null } },
  ]) {
    fs.writeFileSync(configPath, JSON.stringify(config));
    assert.equal(registry.getActiveBackend(), undefined);
    const result = await registry.escalate('fixture');
    assert.equal(result.success, false);
    assert.match(result.error || '', /Choose a supported provider/);
  }
  assert.deepEqual(calls, []);
});

test('supported provider selection still executes only the selected backend', async () => {
  installFixtureBackends();
  fs.writeFileSync(configPath, JSON.stringify({ escalation: { defaultBackend: 'claude-code' } }));
  const result = await registry.escalate('fixture', { preferredBackend: 'codex' });
  assert.equal(result.success, true);
  assert.equal(result.output, 'codex');
  assert.deepEqual(calls, ['available:codex', 'execute:codex']);
});

test('settings reject retired providers and aliases before accessing profile configuration', async () => {
  const { handleSetBigBrotherConfig } = await import('./api/handlers/big-brother-config.js');
  const configBefore = fs.readFileSync(configPath, 'utf8');
  for (const provider of ['open-interpreter', 'ollama', 'openai', 'missing-provider', null]) {
    const result = await handleSetBigBrotherConfig({
      method: 'POST', path: '/api/big-brother-config',
      user: { id: 'fixture', username: 'fixture', role: 'owner', isAuthenticated: true },
      body: { enabled: true, provider },
    } as any);
    assert.equal(result.status, 400);
    assert.match(result.error || '', /Unsupported Big Brother provider/);
  }
  assert.equal(fs.readFileSync(configPath, 'utf8'), configBefore);
  assert.equal(fs.existsSync(path.join(root, 'profiles', 'fixture')), false);
});

test('escalation preserves profile identity and execution options across the terminal boundary', async () => {
  installFixtureBackends();
  const signal = new AbortController().signal;
  await registry.escalate('fixture', { preferredBackend: 'codex', username: 'fixture', signal, timeout: 1234 });
  assert.equal(receivedOptions?.username, 'fixture');
  assert.equal(receivedOptions?.signal, signal);
  assert.equal(receivedOptions?.timeout, 1234);
});

test('settings round-trip model and reasoning while the on/off switch preserves other settings', async () => {
  const { saveUserConfig, loadFreshOperatorConfig } = await import('./config.js');
  const { handleSetBigBrotherConfig, handleGetBigBrotherConfig } = await import('./api/handlers/big-brother-config.js');
  saveUserConfig('operator.json', { bigBrotherMode: {
    enabled: false, provider: 'codex', model: 'gpt-6-luna', reasoningEffort: 'medium',
    delegateAll: false, maxRetries: 3, escalateOnStuck: false,
  } }, 'fixture');
  const req = { method: 'POST', path: '/api/big-brother-config',
    user: { id: 'fixture', username: 'fixture', role: 'owner', isAuthenticated: true } } as any;
  for (const enabled of [true, false, true, false]) {
    const response = await handleSetBigBrotherConfig({ ...req, body: { enabled, delegateAll: enabled } });
    assert.equal(response.status, 200);
    const config = loadFreshOperatorConfig('fixture').bigBrotherMode!;
    assert.equal(config.enabled, enabled);
    assert.equal(config.delegateAll, enabled);
    assert.equal(config.model, 'gpt-6-luna');
    assert.equal(config.reasoningEffort, 'medium');
    assert.equal(config.maxRetries, 3);
    assert.equal(config.escalateOnStuck, false);
  }
  assert.equal((await handleGetBigBrotherConfig(req)).status, 200);
  const changed = await handleSetBigBrotherConfig({ ...req, body: { provider: 'claude-code' } });
  assert.equal(changed.status, 200);
  assert.equal(loadFreshOperatorConfig('fixture').bigBrotherMode?.model, 'sonnet');
});

test('selected provider routes to Big Brother or local independently of the retired global switch', async () => {
  const { saveUserConfig } = await import('./config.js');
  const { handleSetBigBrotherConfig } = await import('./api/handlers/big-brother-config.js');
  const { withUserContext } = await import('./context.js');
  const { callProvider } = await import('./providers/bridge.js');
  installFixtureBackends();
  let localCalls = 0;
  const server = createServer((request, response) => {
    const route = request.url;
    let data;
    if (route === '/health') data = { status: 'ok' };
    else if (route === '/v1/models') data = { data: [{ id: 'local-qwen' }] };
    else {
      assert.equal(route, '/v1/chat/completions');
      localCalls++;
      data = { model: 'local-qwen', choices: [{ message: { content: 'Local reply' } }] };
    }
    request.resume();
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(data));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  fs.writeFileSync(path.join(root, 'etc', 'llm-backend.json'), JSON.stringify({
    activeBackend: 'llama-cpp', llamaCpp: { endpoint, model: 'local-qwen' },
  }));
  saveUserConfig('operator.json', { bigBrotherMode: {
    enabled: false, provider: 'codex', model: 'gpt-6-luna', reasoningEffort: 'medium', delegateAll: false,
  } }, 'fixture');
  try {
    await withUserContext({ userId: 'fixture', username: 'fixture', role: 'owner' }, async () => {
      for (const enabled of [true, false, true, false]) {
        await handleSetBigBrotherConfig({ method: 'POST', path: '/api/big-brother-config',
          user: { username: 'fixture', role: 'owner', isAuthenticated: true },
          body: { enabled: !enabled, delegateAll: !enabled } } as any);
        const schema = { type: 'object', properties: { route: { enum: ['new', 'steer', 'cancel'] } }, required: ['route'] };
        const result = await callProvider(enabled ? 'big-brother' : 'local', [{ role: 'user', content: 'Hi' }], { jsonSchema: schema });
        assert.equal(result.provider, enabled ? 'big-brother' : 'llama-cpp');
        assert.equal(result.model, enabled ? 'gpt-6-luna' : 'local-qwen');
        assert.equal(result.content, enabled ? 'codex' : 'Local reply');
        if (enabled) {
          assert.ok(receivedPrompt.includes(JSON.stringify(schema)), 'CLI must receive the workflow schema including its allowed routing values');
          assert.match(receivedPrompt, /without Markdown fences/);
        }
      }
    });
    assert.equal(localCalls, 2);
    assert.equal(calls.filter(call => call === 'execute:codex').length, 2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('Big Brother preserves JSON-only requests without changing plain-text requests', async () => {
  const { saveUserConfig } = await import('./config.js');
  const { withUserContext } = await import('./context.js');
  const { callProvider } = await import('./providers/bridge.js');
  installFixtureBackends();
  saveUserConfig('operator.json', { bigBrotherMode: {
    enabled: true, provider: 'codex', model: 'gpt-6-luna', reasoningEffort: 'medium', delegateAll: true,
  } }, 'fixture');
  await withUserContext({ userId: 'fixture', username: 'fixture', role: 'owner' }, async () => {
    await callProvider('big-brother', [{ role: 'user', content: 'Hi' }], { format: 'json' });
    assert.match(receivedPrompt, /Return only the final JSON value/);
    await callProvider('big-brother', [{ role: 'user', content: 'Hi' }], {});
    assert.equal(receivedPrompt, '[User]: Hi');
  });
});

test('status-widget assignments route Persona to Big Brother and preserve independent specialist adapters', async () => {
  const { saveUserConfig } = await import('./config.js');
  const { withUserContext } = await import('./context.js');
  const { callLLM } = await import('./model-router.js');
  const { handleAssignModelRole, handleGetModelRegistry } = await import('./api/handlers/model-registry.js');
  const { handleWarmupModel } = await import('./api/handlers/warmup-model.js');
  const { resolveModelForCognitiveMode } = await import('./model-resolver.js');
  installFixtureBackends();
  const requests: any[] = [];
  const server = createServer(async (request, response) => {
    let data: any;
    if (request.url === '/health') data = { status: 'ok' };
    else if (request.url === '/v1/models') data = { data: [{ id: 'qwen-fixture' }] };
    else if (request.url?.startsWith('/lora-adapters?model=')) data = [];
    else {
      assert.equal(request.url, '/v1/chat/completions');
      let body = '';
      for await (const chunk of request) body += chunk;
      requests.push(JSON.parse(body));
      data = { model: 'qwen-fixture', choices: [{ message: { content: 'Local fixture reply' }, finish_reason: 'stop' }] };
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(data));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  fs.writeFileSync(path.join(root, 'etc', 'llm-backend.json'), JSON.stringify({
    activeBackend: 'llama-cpp', llamaCpp: { endpoint, model: 'qwen-fixture' },
  }));
  const definition = (id: number) => ({ provider: 'llama-cpp', model: 'qwen-fixture', roles: [],
    description: 'Fixture specialist', adapters: [], options: { endpoint, lora: [{ id, scale: 1 }] } });
  saveUserConfig('models.json', { version: '1', description: 'Mixed role fixture',
    defaults: { persona: 'local', orchestrator: 'intent', environmentActionSelector: 'task' },
    models: { local: definition(0), intent: definition(1), task: definition(2) },
    cognitiveModeMappings: { environment: { persona: 'local', orchestrator: 'intent', environmentActionSelector: 'task' } },
  }, 'fixture');
  saveUserConfig('operator.json', { bigBrotherMode: { enabled: false, delegateAll: false,
    provider: 'codex', model: 'fixture-sol', reasoningEffort: 'none' } }, 'fixture');
  const user = { username: 'fixture', userId: 'fixture', role: 'owner', isAuthenticated: true } as const;
  const assign = (role: string, modelId: string) => handleAssignModelRole({ user, body: { role, modelId, cognitiveMode: 'environment' } } as any);
  try {
    await withUserContext({ userId: 'fixture', username: 'fixture', role: 'owner' }, async () => {
      const inventory = await handleGetModelRegistry({ user, query: { cognitiveMode: 'environment' } } as any);
      assert.equal(inventory.status, 200);
      const data = inventory.data as any;
      assert.equal(data.modelCategories.bigBrother[0].id, 'big-brother.configured');
      assert.equal(data.roleAssignments.orchestrator, 'intent');
      assert.equal((await assign('persona', 'big-brother.configured')).status, 200);
      const selected = resolveModelForCognitiveMode('environment', 'persona', 'fixture');
      assert.equal(selected.provider, 'big-brother');
      assert.equal(selected.model, 'fixture-sol');
      const warm = await handleWarmupModel({ user, body: { role: 'persona', cognitiveMode: 'environment' } } as any);
      assert.equal(warm.status, 200);
      assert.equal(calls.length, 0, 'Assignment warmup cannot open a CLI conversation');
      for (const role of ['orchestrator', 'persona', 'environmentActionSelector'] as const) {
        const result = await callLLM({ role, cognitiveMode: 'environment', userId: 'fixture', messages: [{ role: 'user', content: 'Fixture request' }] });
        assert.equal(result.provider, role === 'persona' ? 'big-brother' : 'llama-cpp');
      }
      assert.deepEqual(requests.map(request => request.lora), [[{ id: 1, scale: 1 }], [{ id: 2, scale: 1 }]]);
      assert.equal(calls.filter(call => call === 'execute:codex').length, 1);
      assert.equal((await assign('persona', 'local')).status, 200);
      const local = await callLLM({ role: 'persona', cognitiveMode: 'environment', userId: 'fixture', messages: [{ role: 'user', content: 'Local request' }] });
      assert.equal(local.provider, 'llama-cpp');
      assert.deepEqual(requests.at(-1).lora, [{ id: 0, scale: 1 }]);
      assert.equal((await assign('persona', 'big-brother.configured')).status, 200);
      saveUserConfig('operator.json', { bigBrotherMode: { provider: 'codex', model: 'fixture-updated' } }, 'fixture');
      assert.equal(resolveModelForCognitiveMode('environment', 'persona', 'fixture').model, 'fixture-updated',
        'Backend Settings changes are reflected without stale registry copies');
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('Big Brother forwards per-call reasoning without changing its configured default', async () => {
  const { saveUserConfig } = await import('./config.js');
  const { withUserContext } = await import('./context.js');
  const { callProvider } = await import('./providers/bridge.js');
  installFixtureBackends();
  saveUserConfig('operator.json', { bigBrotherMode: { enabled: true, provider: 'codex', reasoningEffort: 'medium' } }, 'reasoning-fixture');
  await withUserContext({ userId: 'reasoning-fixture', username: 'reasoning-fixture', role: 'owner' }, async () => {
    for (const enableThinking of [true, false, undefined]) {
      await callProvider('big-brother', [{ role: 'user', content: 'Hi' }], { enableThinking });
      assert.equal(receivedOptions?.enableThinking, enableThinking);
    }
  });
});
