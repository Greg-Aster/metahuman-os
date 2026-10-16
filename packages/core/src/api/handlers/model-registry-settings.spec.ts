import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-model-settings-'));
process.env.METAHUMAN_ROOT = root;
const profile = path.join(root, 'profiles/fixture/etc');
fs.mkdirSync(profile, { recursive: true });
const registryPath = path.join(profile, 'models.json');
const { migrateModelRegistry, parseModelRegistry } = await import('../../model-resolver.js');
const registry = migrateModelRegistry(parseModelRegistry({
  version: '1.0.0', description: 'Model settings fixture', defaults: { environmentActionSelector: 'task' },
  models: {
    task: { provider: 'llama-cpp', model: 'shared', roles: ['environmentActionSelector'],
      options: { endpoint: 'http://127.0.0.1:8085', lora: [{ path: '/fixture/task.gguf', scale: 1 }], enableThinking: false } },
    other: { provider: 'ollama', model: 'other', roles: [], options: {} },
  },
  cognitiveModeMappings: { environment: { environmentActionSelector: 'task' } },
})).registry;
fs.writeFileSync(registryPath, JSON.stringify(registry));
const { setAuditEnabled } = await import('../../audit.js');
setAuditEnabled(false);
const { eventBus } = await import('../../infrastructure/event-bus/client.js');
eventBus.disconnect();
const { handleUpdateModelSettings } = await import('./model-registry.js');
after(() => { eventBus.disconnect(); fs.rmSync(root, { recursive: true, force: true }); });
const request = (endpoint: unknown, modelId = 'task') => ({
  method: 'PUT' as const, path: '/api/model-registry',
  user: { username: 'fixture', userId: 'fixture', role: 'owner' as const, isAuthenticated: true },
  body: { modelId, options: { endpoint } },
});

test('endpoint updates preserve adapter configuration and role selection', async () => {
  for (const endpoint of ['http://127.0.0.1:8081', 'https://model.example.test/api']) {
    assert.equal((await handleUpdateModelSettings(request(endpoint))).status, 200);
    const saved = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
    const expected = structuredClone(registry);
    expected.models.task!.options.endpoint = endpoint;
    assert.deepEqual(saved, expected);
  }
});

test('invalid endpoint settings do not change the registry', async () => {
  const before = fs.readFileSync(registryPath, 'utf8');
  for (const endpoint of ['not-a-url', 'file:///tmp/model', 'ftp://host', 8081, null]) {
    assert.equal((await handleUpdateModelSettings(request(endpoint))).status, 400);
    assert.equal(fs.readFileSync(registryPath, 'utf8'), before);
  }
  assert.equal((await handleUpdateModelSettings(request('http://localhost:8081', 'other'))).status, 400);
  assert.equal(fs.readFileSync(registryPath, 'utf8'), before);
});

test('registering separate llama.cpp base and adapters preserves every active assignment', async () => {
  const before = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const base = { provider: 'llama-cpp', model: 'environment-2b-base', adapters: [], roles: [],
    capabilities: ['text'], description: 'Fixture deployment',
    options: { endpoint: 'http://127.0.0.1:8086', lora: [], enableThinking: false },
    metadata: { baseArtifact: '/fixture/base.BF16.gguf', service: 'llama-cpp-environment-2b.service' } };
  const additions: Record<string, unknown> = {};
  for (const specialist of [null, 'intent', 'task']) {
    const model = specialist ? { ...base, adapters: [`/fixture/${specialist}.gguf`],
      options: { ...base.options, lora: [{ path: `/fixture/${specialist}.gguf`, scale: 1 }] } } : base;
    const req = { ...request('unused'), body: { operation: 'register', model } };
    const response = await handleUpdateModelSettings(req);
    assert.equal(response.status, 200);
    const data = response.data as { modelId: string; model: unknown };
    assert.ok(data.modelId.startsWith(specialist ? 'llama-cpp-lora.' : 'llama-cpp.'));
    assert.deepEqual(data.model, model);
    additions[data.modelId] = model;
    const saved = fs.readFileSync(registryPath, 'utf8');
    assert.equal((await handleUpdateModelSettings(req)).status, 200);
    assert.equal(fs.readFileSync(registryPath, 'utf8'), saved, 'identical registration is idempotent');
    const changed = { ...model, description: 'Updated fixture deployment',
      options: { endpoint: model.options.endpoint, lora: model.options.lora }, metadata: { review: 'fixture' } };
    const updated = await handleUpdateModelSettings({ ...req, body: { operation: 'register', model: changed } });
    assert.equal(updated.status, 200);
    const actual = (updated.data as { model: unknown }).model;
    additions[data.modelId] = { ...model, description: changed.description,
      metadata: { ...model.metadata, review: 'fixture' } };
    assert.deepEqual(actual, additions[data.modelId], 'updates preserve unspecified serving settings and provenance');
  }
  assert.equal(Object.keys(additions).length, 3);
  assert.deepEqual(JSON.parse(fs.readFileSync(registryPath, 'utf8')), {
    ...before, models: { ...before.models, ...additions },
  });
});

test('invalid registration leaves the profile registry untouched', async () => {
  const before = fs.readFileSync(registryPath, 'utf8');
  const base = { provider: 'llama-cpp', model: 'fixture', adapters: [], roles: [], description: 'Fixture',
    options: { endpoint: 'http://127.0.0.1:8086', lora: [] } };
  for (const model of [undefined, {}, { ...base, provider: 'ollama' },
    { ...base, options: { endpoint: 'file:///fixture' } },
    { ...base, options: { endpoint: base.options.endpoint, lora: [{ path: 4 }] } }]) {
    assert.equal((await handleUpdateModelSettings({ ...request('unused'),
      body: { operation: 'register', model } })).status, 400);
    assert.equal(fs.readFileSync(registryPath, 'utf8'), before);
  }
});
