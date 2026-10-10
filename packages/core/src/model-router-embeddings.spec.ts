import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-embedding-operation-'));
process.env.METAHUMAN_ROOT = root;
fs.mkdirSync(path.join(root, 'profiles/fixture/etc'), { recursive: true });
fs.writeFileSync(path.join(root, 'profiles/fixture/etc/models.json'), JSON.stringify({ version: '1.0.0', description: 'Isolated embedding test', defaults: { embedder: 'fixture' },
  models: { fixture: { provider: 'local-models', model: 'fixture-embedding', roles: ['embedder'], adapters: [], description: 'Fixture', options: {} } } }));
const { callEmbeddings } = await import('./model-router.js');
const { eventBus } = await import('./infrastructure/event-bus/client.js');
const { setAuditEnabled } = await import('./audit.js');
setAuditEnabled(false);
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; eventBus.disconnect(); fs.rmSync(root, { recursive: true, force: true }); });

test('embedding operation succeeds independently of the health-probe deadline', async () => {
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input); requests.push(url);
    if (url.endsWith('/health')) throw new DOMException('Health probe timed out', 'TimeoutError');
    assert.ok(url.endsWith('/embeddings'));
    return Response.json({ embeddings: [[0.1, 0.2, 0.3]] });
  };
  assert.deepEqual((await callEmbeddings({ text: 'fixture', userId: 'fixture' })).embeddings, [0.1, 0.2, 0.3]);
  assert.equal(requests.length, 1);
  globalThis.fetch = async () => new Response('Embedding model unavailable', { status: 503 });
  await assert.rejects(callEmbeddings({ text: 'fixture', userId: 'fixture' }), /Embedding model unavailable/);
});

test('embedding selection honors the same saved cognitive-mode role as the sidebar', async () => {
  const file = path.join(root, 'profiles/fixture/etc/models.json');
  const registry = JSON.parse(fs.readFileSync(file, 'utf8'));
  registry.models.other = { ...registry.models.fixture, model: 'other-embedding' };
  registry.cognitiveModeMappings = { environment: { embedder: 'other' } };
  fs.writeFileSync(file, JSON.stringify(registry));
  const models: string[] = [];
  globalThis.fetch = async (_input, init) => {
    models.push(JSON.parse(String(init?.body)).model);
    return Response.json({ embeddings: [[0.1, 0.2, 0.3]] });
  };
  assert.equal((await callEmbeddings({ text: 'fixture', userId: 'fixture', cognitiveMode: 'environment' })).model, 'other-embedding');
  assert.equal((await callEmbeddings({ text: 'fixture', userId: 'fixture' })).model, 'fixture-embedding');
  assert.deepEqual(models, ['other-embedding', 'fixture-embedding']);
});
