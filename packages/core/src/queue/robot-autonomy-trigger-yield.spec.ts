import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';
import type { GraphExecutionState } from '../graph-executor.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-controller-yield-'));
process.env.METAHUMAN_ROOT = root;
fs.mkdirSync(path.join(root, 'etc'));
fs.writeFileSync(path.join(root, 'etc', 'agents.json'), JSON.stringify({
  agents: { 'robot-autonomy-controller': { enabled: true } },
}));
const { eventBus } = await import('../infrastructure/event-bus/client.js');
eventBus.disconnect();
const { setAuditEnabled } = await import('../audit.js');
setAuditEnabled(false);
const username = 'controller-fixture';
let returnedState: GraphExecutionState = { status: 'waiting', nodes: new Map(), startTime: Date.now() };
const runtime = await import('../graph-runtime.js');
mock.module('../graph-runtime.js', { namedExports: { ...runtime, runGraph: async () => returnedState } });
const users = await import('../users.js');
mock.module('../users.js', { namedExports: { ...users,
  getUserByUsername: () => ({ id: username, username, role: 'owner' }) } });
const streaming = await import('../graph-streaming.js');
mock.module('../graph-streaming.js', { namedExports: { ...streaming,
  loadGraphForMode: async () => ({ graph: {}, source: 'fixture' }) } });
const { executeRobotAutonomyTriggerWork } = await import('./robot-autonomy-trigger-handler.js');

test('Controller preserves a yielded execution before its decision node runs', async () => {
  returnedState = { ...returnedState, status: 'waiting', error: undefined,
    executionId: 'controller-awaiting-camera', nodes: new Map() };
  const result = await executeRobotAutonomyTriggerWork({
    id: 'fixture-controller-wait', username, handler: 'workflow.robot-autonomy-controller', source: 'user',
    input: { agentId: 'robot-autonomy-controller' },
  } as never, { signal: new AbortController().signal } as never);
  assert.equal(result.executionId, 'controller-awaiting-camera');
  assert.equal(result.executionStatus, 'waiting');
  assert.equal('decision' in result, false);
  assert.equal('dispatch' in result, false);
});


test('Controller still reports actual failures and missing completed decisions', async () => {
  const invoke = () => executeRobotAutonomyTriggerWork({
    id: 'fixture-controller-terminal', username, handler: 'workflow.robot-autonomy-controller', source: 'user',
    input: { agentId: 'robot-autonomy-controller' },
  } as never, { signal: new AbortController().signal } as never);
  returnedState = { ...returnedState, status: 'failed', error: new Error('Camera read failed') };
  await assert.rejects(invoke, /Camera read failed/);
  returnedState = { ...returnedState, status: 'completed', error: undefined };
  await assert.rejects(invoke, /requires exactly one robot_autonomy_controller_parser/);
});

test.after(() => { mock.restoreAll(); fs.rmSync(root, { recursive: true, force: true }); });
