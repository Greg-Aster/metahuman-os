import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

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

test('Big Brother on routes to the selected CLI; off returns to the configured local model', async () => {
  const { saveUserConfig } = await import('./config.js');
  const { handleSetBigBrotherConfig } = await import('./api/handlers/big-brother-config.js');
  const { withUserContext } = await import('./context.js');
  const { callProvider } = await import('./providers/bridge.js');
  installFixtureBackends();
  fs.writeFileSync(path.join(root, 'etc', 'llm-backend.json'), JSON.stringify({
    activeBackend: 'llama-cpp', llamaCpp: { endpoint: 'http://fixture.test', model: 'local-qwen' },
  }));
  saveUserConfig('operator.json', { bigBrotherMode: {
    enabled: false, provider: 'codex', model: 'gpt-6-luna', reasoningEffort: 'medium', delegateAll: false,
  } }, 'fixture');
  const originalFetch = globalThis.fetch;
  let localCalls = 0;
  globalThis.fetch = async url => {
    const route = new URL(String(url)).pathname;
    if (route === '/health') return Response.json({ status: 'ok' });
    if (route === '/v1/models') return Response.json({ data: [{ id: 'local-qwen' }] });
    assert.equal(route, '/v1/chat/completions');
    localCalls++;
    return Response.json({ model: 'local-qwen', choices: [{ message: { content: 'Local reply' } }] });
  };
  try {
    await withUserContext({ userId: 'fixture', username: 'fixture', role: 'owner' }, async () => {
      for (const enabled of [true, false, true, false]) {
        await handleSetBigBrotherConfig({ method: 'POST', path: '/api/big-brother-config',
          user: { username: 'fixture', role: 'owner', isAuthenticated: true },
          body: { enabled, delegateAll: enabled } } as any);
        const schema = { type: 'object', properties: { route: { enum: ['new', 'steer', 'cancel'] } }, required: ['route'] };
        const result = await callProvider('local', [{ role: 'user', content: 'Hi' }], { jsonSchema: schema });
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
  } finally { globalThis.fetch = originalFetch; }
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
    await callProvider('local', [{ role: 'user', content: 'Hi' }], { format: 'json' });
    assert.match(receivedPrompt, /Return only the final JSON value/);
    await callProvider('local', [{ role: 'user', content: 'Hi' }], {});
    assert.equal(receivedPrompt, '[User]: Hi');
  });
});
