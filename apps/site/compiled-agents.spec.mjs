import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const server = path.resolve(process.env.METAHUMAN_BUILT_SERVER || fileURLToPath(new URL('./dist/server', import.meta.url)));
const chunks = path.join(server, 'chunks');
// The public Core barrel is emitted by the real worker build, with named exports.
const barrel = fs.readdirSync(chunks).find(name => name.startsWith('index_')
  && fs.readFileSync(path.join(chunks, name), 'utf8').includes(' as resolveAgentExecutablePath'));
assert.ok(barrel, 'Build the Site, including its workers, before running this integration test');
const coreUrl = pathToFileURL(path.join(chunks, barrel)).href;

if (process.argv[2]?.startsWith('--worker')) {
  globalThis.fetch = async () => { throw new Error('Network disabled in compiled worker regression'); };
  const core = await import(coreUrl);
  core.setAuditEnabled(false);
  let graph = core.validateSvelteFlowGraph({
    format: 'svelte-flow', version: '1.0', name: 'Compiled worker regression',
    scheduler: core.DEFAULT_GRAPH_SCHEDULER,
    nodes: [{ id: 'text', type: 'inputNode', position: { x: 0, y: 0 },
      data: { nodeType: 'text_input', properties: { message: 'fixture result' } } }], edges: [],
  });
  const username = 'compiled-worker-fixture';
  if (!process.env.FIXTURE_EXECUTION_ID) core.createUser(username, 'fixture-password', 'owner');
  const reflection = process.argv[2] !== '--worker';
  if (reflection) {
    const source = JSON.parse(fs.readFileSync(new URL('../../etc/cognitive-graphs/reflector-mode.json', import.meta.url), 'utf8'));
    const retained = new Set(['10', '11', '2', 'reasoning-memory', 'reflection-memory']);
    graph = core.validateSvelteFlowGraph({ ...source, name: 'Reflection persistence regression',
      nodes: [...source.nodes.filter(node => retained.has(node.id)), {
        id: 'fixture', type: 'inputNode', position: { x: 0, y: 0 },
        data: { nodeType: 'text_input', properties: { message: process.argv[2] === '--worker-thinking'
          ? '<think>Fixture reasoning.</think>Fixture reflection.' : 'Fixture reflection.' } },
      }],
      edges: [...source.edges.filter(edge => retained.has(edge.source) && retained.has(edge.target)),
        { id: 'fixture-response', source: 'fixture', sourceHandle: 'text', target: '10', targetHandle: 'response' }],
    });
  }
  const user = core.getUserByUsername(username);
  const result = await core.withUserContext({ username, userId: user.id, role: 'owner' }, () => core.runGraph({ graph, context: { username, allowMemoryWrites: true },
    ...(process.env.FIXTURE_EXECUTION_ID ? { executionId: process.env.FIXTURE_EXECUTION_ID } : {}),
  }));
  if (reflection) {
    assert.equal(result.status, 'completed');
    const saved = result.nodes.get('reflection-memory')?.outputs;
    assert.equal(saved?.saved, true);
    assert.equal(saved?.text, 'Fixture reflection.');
    assert.ok(fs.existsSync(saved.eventPath));
    assert.equal(JSON.parse(fs.readFileSync(saved.eventPath, 'utf8')).content, 'Fixture reflection.');
    if (process.argv[2] === '--worker-thinking') assert.equal(result.nodes.get('reasoning-memory')?.outputs?.text, 'Fixture reasoning.');
  }
  console.log('FIXTURE_RESULT=' + JSON.stringify({
    status: result.status, executionId: result.executionId,
    worker: core.resolveAgentExecutablePath('train-of-thought'),
    alias: core.resolveAgentExecutablePath('curiosity-service'),
    canonical: core.resolveAgentExecutablePath('curiosity'),
    bootstrap: core.resolveAgentBootstrapPath(),
    runner: core.resolveAgentRunner(core.resolveAgentExecutablePath('train-of-thought')),
    missing: core.resolveAgentExecutablePath('nonexistent-worker'),
  }));
  process.exit(0);
} else {
  test('built workers and cross-process graph reads stay on the compiled runtime with no source tree', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-compiled-workers-'));
    const invoke = executionId => {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker'], {
        env: { ...process.env, METAHUMAN_ROOT: root, METAHUMAN_BUILT_SERVER: server,
          ...(executionId ? { FIXTURE_EXECUTION_ID: executionId } : {}) }, encoding: 'utf8', timeout: 30_000,
      });
      assert.equal(child.status, 0, child.stderr + child.stdout);
      return JSON.parse(child.stdout.split('\n').find(line => line.startsWith('FIXTURE_RESULT=')).slice(15));
    };
    try {
      const first = invoke();
      assert.equal(first.status, 'completed');
      assert.equal(first.worker, path.join(server, 'agents/train-of-thought.mjs'));
      assert.equal(first.bootstrap, path.join(server, 'agents/bootstrap.mjs'));
      assert.equal(first.runner, process.execPath);
      assert.equal(first.alias, first.canonical);
      assert.equal(first.missing, null);
      assert.ok(fs.existsSync(first.worker));
      // An independently changed source tree must not replace compiled workers.
      fs.mkdirSync(path.join(root, 'brain/agents/train-of-thought'), { recursive: true });
      fs.writeFileSync(path.join(root, 'brain/agents/train-of-thought/cli.ts'), 'throw new Error("Wrong runtime selected")');
      const second = invoke(first.executionId);
      assert.equal(second.status, 'completed');
      assert.equal(second.executionId, first.executionId);
      assert.equal(second.worker, first.worker);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  for (const mode of ['--worker-reflection', '--worker-thinking']) {
    test(`real reflection output graph persists final text with ${mode === '--worker-thinking' ? 'separate reasoning' : 'no reasoning block'}`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-reflection-output-'));
      try {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), mode], {
          env: { ...process.env, METAHUMAN_ROOT: root, METAHUMAN_BUILT_SERVER: server },
          encoding: 'utf8', timeout: 30_000,
        });
        assert.equal(child.status, 0, child.stderr + child.stdout);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
  }
}
