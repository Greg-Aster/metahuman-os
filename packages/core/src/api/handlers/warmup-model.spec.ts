import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, mock } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-role-warmup-'));
process.env.METAHUMAN_ROOT = root;
const profile = path.join(root, 'profiles/fixture/etc');
fs.mkdirSync(profile, { recursive: true });
const registry = { version: '1.0.0', description: 'Warmup fixture',
  defaults: { psychotherapist: 'one', embedder: 'embedding' },
  models: {
    one: { provider: 'llama-cpp', model: 'one', roles: ['psychotherapist'], options: {} },
    two: { provider: 'llama-cpp', model: 'two', roles: ['psychotherapist'], options: {} },
    embedding: { provider: 'local-models', model: 'embedding', roles: ['embedder'], options: {} },
  }, cognitiveModeMappings: { environment: { psychotherapist: 'one', embedder: 'embedding' } } };
fs.writeFileSync(path.join(profile, 'models.json'), JSON.stringify(registry));
const calls: any[] = [];
const router = await import('../../model-router.js');
mock.module('../../model-router.js', { namedExports: { ...router,
  callLLM: async (options: any) => { calls.push({ kind: 'chat', ...options }); return {}; },
  callEmbeddings: async (options: any) => { calls.push({ kind: 'embedding', ...options }); return {}; },
} });
const { setAuditEnabled } = await import('../../audit.js');
setAuditEnabled(false);
const { eventBus } = await import('../../infrastructure/event-bus/client.js');
eventBus.disconnect();
const { handleWarmupModel } = await import('./warmup-model.js');
after(() => { mock.restoreAll(); eventBus.disconnect(); fs.rmSync(root, { recursive: true, force: true }); });
const request = (role: string) => ({ user: { username: 'fixture', isAuthenticated: true }, body: { role, cognitiveMode: 'environment' } }) as any;

test('saved role replacement is warmed immediately, including the human-insight role', async () => {
  assert.equal((await handleWarmupModel(request('psychotherapist'))).status, 200);
  assert.equal(calls.length, 1);
  assert.equal((await handleWarmupModel(request('psychotherapist'))).status, 200);
  assert.equal(calls.length, 1);
  registry.cognitiveModeMappings.environment.psychotherapist = 'two';
  fs.writeFileSync(path.join(profile, 'models.json'), JSON.stringify(registry));
  assert.equal((await handleWarmupModel(request('psychotherapist'))).status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].userId, 'fixture');
  assert.equal(calls[1].cognitiveMode, 'environment');
});

test('embedder warmup uses embeddings, preserving its saved mode and profile', async () => {
  assert.equal((await handleWarmupModel(request('embedder'))).status, 200);
  assert.equal(calls.at(-1).kind, 'embedding');
  assert.equal(calls.at(-1).userId, 'fixture');
  assert.equal(calls.at(-1).cognitiveMode, 'environment');
});
