import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-stream-freshness-'));
process.env.METAHUMAN_ROOT = root;
process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = 'fixture-token';
const { eventBus } = await import('../infrastructure/event-bus/client.js');
eventBus.disconnect();
const { setAuditEnabled } = await import('../audit.js');
setAuditEnabled(false);
const bridge = await import('./index.js');
let dispatch: (() => void) | undefined;
let reads: object[] = [];
mock.module('./index.js', { namedExports: { ...bridge,
  subscribeEnvironmentActions: (_session: string, callback: () => void) => {
    dispatch = callback;
    return () => { dispatch = undefined; };
  },
  dispatchEnvironmentVisualReads: () => reads.splice(0),
  dispatchEnvironmentActions: () => [],
  pendingEnvironmentCancellations: () => [],
  releaseEnvironmentStreamWork: () => {},
} });
const { handleEnvironmentBridgeStream } = await import('../api/handlers/environment-bridge.js');

test('continuous camera reads retain connection freshness until stream disconnects', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-14T00:00:00Z') });
  const sessionId = 'fixture-body';
  bridge.writeEnvironmentBridgeState({ enabled: true, updatedAt: new Date().toISOString(), feedback: [], sessions: {
    [sessionId]: { sessionId, environmentId: 'fixture', adapter: 'fixture', status: 'connected',
      connectedAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() },
  } } as never);
  const abort = new AbortController();
  const response = await handleEnvironmentBridgeStream({ method: 'GET', path: '/api/environment-bridge/stream',
    headers: { Authorization: 'Bearer fixture-token' }, query: { sessionId }, signal: abort.signal,
    user: { isAuthenticated: false } } as never);
  const stream = response.stream![Symbol.asyncIterator]();
  try {
    assert.match((await stream.next()).value, /event: connected/);
    for (let i = 1; i <= 8; i++) {
      mock.timers.tick(10_000);
      reads.push({ requestId: `read-${i}`, sessionId });
      dispatch!();
      assert.match((await stream.next()).value, /event: visual-reads/);
      const session = bridge.summarizeEnvironmentBridgeState().sessions.find(item => item.sessionId === sessionId)!;
      assert.equal(session.status, 'connected', `Camera read ${i} must refresh the live session`);
      assert.equal(session.lastSeenAt, new Date().toISOString());
    }
  } finally {
    abort.abort();
    await stream.return?.();
  }
  assert.equal(dispatch, undefined);
  mock.timers.tick(46_000);
  assert.equal(bridge.summarizeEnvironmentBridgeState().sessions[0].status, 'stale');
});

test.after(() => { mock.timers.reset(); mock.restoreAll(); fs.rmSync(root, { recursive: true, force: true }); });
