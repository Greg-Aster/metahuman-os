import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { EventBusServer } from './server.js';

test('owns one server lifecycle and persists startup and shutdown events', async t => {
  const logsDir = mkdtempSync(path.join(tmpdir(), 'metahuman-event-bus-'));
  t.after(() => rmSync(logsDir, { recursive: true, force: true }));

  const server = new EventBusServer({ port: 0, logsDir });
  await server.start();

  await assert.rejects(server.start(), /already started/);
  assert.equal(server.getStats().eventCount, 1);

  await server.stop();
  await server.stop();

  const logFile = path.join(logsDir, `${new Date().toISOString().slice(0, 10)}.ndjson`);
  const events = readFileSync(logFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(events.map(event => event.event), ['core.started', 'core.shutdown']);
});
