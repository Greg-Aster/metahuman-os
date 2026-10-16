import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { demoInstruction, runDemo } from './smoke-autonomy-vision.mjs';

test('live launcher submits the saved controller once and preserves a durable waiting outcome', async () => {
  const original = JSON.parse(await readFile(new URL('../etc/cognitive-graphs/robot-autonomy-controller-mode.json', import.meta.url), 'utf8'));
  const dir = await mkdtemp(join(tmpdir(), 'autonomy-vision-launcher-'));
  const requests = [];
  const outcomes = [{ type: 'graph_waiting', data: { status: 'waiting', executionId: 'fixture-execution', nodeOutputs: {} } },
    { type: 'graph_error', data: { error: 'Fixture model unavailable' } }];
  const server = createServer(async (request, response) => {
    const parts = [];
    for await (const part of request) parts.push(part);
    requests.push({ url: request.url, method: request.method, cookie: request.headers.cookie,
      body: parts.length ? JSON.parse(Buffer.concat(parts).toString()) : undefined });
    if (request.method === 'GET') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ graph: original }));
    } else {
      const outcome = outcomes.shift();
      response.setHeader('Content-Type', 'text/event-stream');
      response.end(`event: ${outcome.type}\ndata: ${JSON.stringify(outcome.data)}\n\n`);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const output = join(dir, 'trace.sse');
  try {
    const result = await runDemo({ baseUrl, cookie: 'mh_session=fixture', output });
    assert.equal(result.status, 'waiting');
    assert.equal(result.executionId, 'fixture-execution');
    assert.equal(requests.length, 2);
    assert.equal(requests[1].url, '/api/execute-graph-stream');
    assert.equal(requests[1].cookie, 'mh_session=fixture');
    assert.equal(requests[1].body.userMessage, demoInstruction);
    const submitted = requests[1].body.graph;
    const policy = submitted.nodes.find(node => node.id === 'policy');
    const originalPolicy = original.nodes.find(node => node.id === 'policy');
    assert.equal(policy.data.properties.message, `${originalPolicy.data.properties.message}\n\n${demoInstruction}`);
    policy.data.properties.message = originalPolicy.data.properties.message;
    assert.deepEqual(submitted, original, 'No model, capability, scheduler or command owner is replaced');
    assert.match(await readFile(output, 'utf8'), /fixture-execution/);
    await assert.rejects(runDemo({ baseUrl, cookie: 'mh_session=fixture', output }), /Fixture model unavailable/);
    assert.equal(requests.length, 4, 'A failed invocation is not automatically retried');
    assert.match(await readFile(output, 'utf8'), /Fixture model unavailable/);
  } finally {
    server.close();
    server.closeAllConnections();
    await rm(dir, { recursive: true, force: true });
  }
});
