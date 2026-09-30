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
function installFixtureBackends() {
  calls.length = 0;
  for (const id of ['claude-code', 'codex']) {
    registry.registerBackend({
      id, name: id, description: 'test fixture', supportsStreaming: false,
      async isAvailable() { calls.push(`available:${id}`); return true; },
      isReady() { return true; },
      async start() { calls.push(`start:${id}`); return true; },
      stop() {},
      async execute() { calls.push(`execute:${id}`); return { success: true, output: id }; },
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
