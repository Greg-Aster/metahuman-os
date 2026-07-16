import assert from 'node:assert/strict';
import { ExecutionEngine } from './execution-engine.js';
import { TriggerManager, type TriggerManagerConfig } from './trigger-manager.js';
import { UnifiedQueueManager } from './unified-queue-manager.js';
import { applyPolicyDecision } from '../active-operator/policy-contract.js';
import { eventBus } from '../infrastructure/event-bus/client.js';

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for coordinator state');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

const triggerConfig: TriggerManagerConfig = {
  version: '1',
  revision: 1,
  globalSettings: { pauseAll: false, timezone: 'UTC' },
  agents: {
    reflector: {
      id: 'reflector',
      enabled: true,
      type: 'activity',
      lifecycle: 'scheduled-work',
      handler: 'agent.reflector',
      priority: 'low',
      allowedModes: ['semi', 'full'],
      startupPolicy: 'skip',
      inactivityThreshold: 1,
      probability: 1,
      maxRetries: 1,
    },
  },
};

function input(overrides: Record<string, unknown> = {}) {
  return {
    type: 'generic' as const,
    handler: 'test.echo',
    resource: 'local-llm',
    source: 'system' as const,
    input: {},
    username: 'owner',
    ...overrides,
  };
}

{
  const manager = new UnifiedQueueManager();
  const engine = new ExecutionEngine({}, manager);
  assert.equal(engine.hasHandler('vector.append-event'), true, 'vector indexing must have a coordinator-owned executor');
}

{
  const manager = new UnifiedQueueManager();
  const background = manager.enqueue(input({ priority: 'background', resource: 'local-llm' }));
  const critical = manager.enqueue(input({ priority: 'critical', resource: 'vector-index' }));

  assert.equal(manager.getNextExecutable()?.id, critical.id, 'selection must be global priority-first');
  assert.notEqual(background.id, critical.id);
}

{
  const manager = new UnifiedQueueManager();
  manager.enqueue(input({ priority: 'critical', notBefore: new Date(Date.now() + 60_000).toISOString() }));
  const runnable = manager.enqueue(input({ priority: 'normal' }));

  assert.equal(manager.getNextExecutable()?.id, runnable.id, 'not-before work must not block runnable work');
}

{
  const manager = new UnifiedQueueManager();
  const expired = manager.enqueue(input({ deadline: new Date(Date.now() - 1_000).toISOString() }));

  assert.equal(manager.getNextExecutable(), null);
  assert.equal(manager.getTask(expired.id)?.state, 'expired');
}

{
  const manager = new UnifiedQueueManager();
  const first = manager.enqueue(input({ idempotencyKey: 'timer:reflector:2026-07-14T12' }));
  const duplicate = manager.enqueue(input({ idempotencyKey: 'timer:reflector:2026-07-14T12' }));

  assert.equal(duplicate.id, first.id, 'active idempotency keys must return the existing work item');
  assert.equal(manager.getAllTasks().length, 1);
}

{
  const manager = new UnifiedQueueManager();
  const queued = manager.enqueue(input());
  const leased = manager.claim(queued.id);

  assert.equal(leased?.state, 'leased');
  assert.equal(manager.cancel(queued.id, 'operator stop')?.state, 'leased', 'running work remains visible until its executor acknowledges cancellation');
  assert.ok(manager.getTask(queued.id)?.cancellationRequestedAt);

  manager.acknowledgeCancellation(queued.id);
  assert.equal(manager.getTask(queued.id)?.state, 'cancelled');
}

{
  const manager = new UnifiedQueueManager({ historyLimit: 2 });
  for (let index = 0; index < 3; index += 1) {
    const task = manager.enqueue(input({ idempotencyKey: `history:${index}` }));
    manager.claim(task.id);
    manager.complete(task.id, true, { index });
  }

  assert.equal(manager.getHistory().length, 2, 'terminal history must be bounded');
  assert.equal(manager.getHistory()[0]?.result?.index, 2);
}

{
  const beforeRestart = new UnifiedQueueManager();
  const task = beforeRestart.enqueue(input({ maxAttempts: 2 }));
  beforeRestart.claim(task.id);

  const afterRestart = new UnifiedQueueManager();
  afterRestart.importState(beforeRestart.exportState());

  const restored = afterRestart.getTask(task.id);
  assert.equal(restored?.state, 'queued', 'interrupted leased work must be reconciled on restart');
  assert.equal(restored?.attempt, 1);
}

{
  const beforeRestart = new UnifiedQueueManager();
  const stale = beforeRestart.enqueue(input({ source: 'timer' }));
  const userMessage = beforeRestart.enqueue(input({
    type: 'user_message',
    source: 'user',
    priority: 'critical',
  }));
  const state = beforeRestart.exportState();
  for (const task of state.items || []) {
    task.createdAt = new Date(Date.now() - 60_000).toISOString();
  }

  const afterRestart = new UnifiedQueueManager();
  afterRestart.configure({
    enabled: true,
    lanes: {
      'local-llm': { id: 'local-llm', maxConcurrent: 1 },
      'vector-index': { id: 'vector-index', maxConcurrent: 1 },
      'remote-llm': { id: 'remote-llm', maxConcurrent: 1 },
    },
    execution: { staleTaskTimeoutMs: 1_000 },
  });
  afterRestart.importState(state);

  assert.equal(afterRestart.getTask(stale.id)?.state, 'expired', 'stale non-user work must not return to the live queue');
  assert.equal(afterRestart.getTask(stale.id)?.error?.code, 'stale_recovery_task');
  assert.equal(afterRestart.getTask(userMessage.id)?.state, 'queued', 'queued user work must survive recovery');
}

{
  const manager = new UnifiedQueueManager();
  const engine = new ExecutionEngine({ wakeFallbackMs: 250 }, manager);
  engine.registerHandler('test.echo', async task => ({ echoed: task.input.value }));
  engine.start();

  manager.enqueue(input({ priority: 'critical', handler: 'missing.handler' }));
  const runnable = manager.enqueue(input({ priority: 'normal', input: { value: 42 } }));
  await waitFor(() => manager.getTask(runnable.id)?.state === 'completed');

  assert.equal(manager.getTask(runnable.id)?.result?.echoed, 42, 'an unavailable handler must not block compatible work');
  await engine.stop();
}

{
  const manager = new UnifiedQueueManager();
  const engine = new ExecutionEngine({ wakeFallbackMs: 250 }, manager);
  engine.registerHandler('test.blocking', async (_task, context) => {
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new DOMException('cancelled', 'AbortError'));
      context.signal.addEventListener('abort', abort, { once: true });
      setTimeout(resolve, 5_000).unref?.();
    });
    return {};
  });
  engine.start();

  const task = manager.enqueue(input({ handler: 'test.blocking' }));
  await waitFor(() => manager.getTask(task.id)?.state === 'leased');
  manager.cancel(task.id, 'test stop');
  await waitFor(() => manager.getTask(task.id)?.state === 'cancelled');

  assert.equal(manager.getTask(task.id)?.cancellationReason, 'test stop');
  await engine.stop();
}

{
  const manager = new UnifiedQueueManager();
  const engine = new ExecutionEngine({ wakeFallbackMs: 250 }, manager);
  engine.registerHandler('test.blocking', async (_task, context) => {
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new DOMException('cancelled', 'AbortError'));
      context.signal.addEventListener('abort', abort, { once: true });
      setTimeout(resolve, 5_000).unref?.();
    });
    return {};
  });
  engine.registerHandler('test.echo', async task => ({ echoed: task.input.value }));
  engine.start();

  const background = manager.enqueue(input({
    handler: 'test.blocking',
    priority: 'high',
    source: 'timer',
  }));
  await waitFor(() => manager.getTask(background.id)?.state === 'leased');
  const userMessage = manager.enqueue(input({
    type: 'user_message',
    handler: 'test.echo',
    priority: 'critical',
    source: 'user',
    input: { value: 42 },
  }));

  await waitFor(() => manager.getTask(background.id)?.state === 'cancelled');
  await waitFor(() => manager.getTask(userMessage.id)?.state === 'completed');
  assert.match(
    manager.getTask(background.id)?.cancellationReason || '',
    /Preempted by critical user message/,
    'critical user work must preempt lower-priority background work in the same resource',
  );
  assert.equal(manager.getTask(userMessage.id)?.result?.echoed, 42);
  await engine.stop();
}

{
  const manager = new UnifiedQueueManager();
  const triggers = new TriggerManager(manager, triggerConfig);

  assert.deepEqual(triggers.evaluateActivityTriggers(Date.now() + 2_000), [], 'reactive mode must not admit proactive work');
  triggers.start();
  assert.deepEqual(triggers.evaluateActivityTriggers(Date.now() + 2_000), [], 'a running clock must remain suppressed in reactive mode');
  assert.equal(triggers.getSnapshot().triggers[0]?.lastSuppressionReason, 'mode:reactive');
  triggers.setAutonomyMode('semi');
  const admitted = triggers.evaluateActivityTriggers(Date.now() + 2_000);
  const duplicate = triggers.evaluateActivityTriggers(Date.now() + 2_000);
  const task = manager.getTask(admitted[0]);

  assert.equal(admitted.length, 1);
  assert.deepEqual(duplicate, [], 'one inactivity event may be admitted only once');
  assert.equal(task?.handler, 'agent.reflector', 'timer work must preserve exact handler identity');
  assert.equal(task?.source, 'timer');
  assert.equal(task?.priority, 'background');
  assert.equal(manager.isPaused(), false, 'proactive admission must not pause user work');
  triggers.stop();
}

{
  const manager = new UnifiedQueueManager();
  const rejected = applyPolicyDecision(
    manager,
    { decision: 'propose', handler: 'environment.command', reason: 'move somewhere' },
    { username: 'owner', cognitiveMode: 'environment', now: 1_000_000 },
  );
  assert.equal(rejected.accepted, false, 'policy proposals must be allow-listed and cannot dispatch robot work');

  const proposed = applyPolicyDecision(
    manager,
    { decision: 'propose', handler: 'agent.reflector', reason: 'useful reflection' },
    { username: 'owner', cognitiveMode: 'dual', now: 1_000_000 },
  );
  assert.equal(proposed.accepted, true);
  assert.equal(manager.getTask(proposed.proposedTaskId!)?.source, 'autonomy');
  assert.equal(manager.getTask(proposed.proposedTaskId!)?.priority, 'low');
}

{
  const manager = new UnifiedQueueManager();
  const high = manager.enqueue(input({ priority: 'high' }));
  const low = manager.enqueue(input({ priority: 'low' }));
  const invalidSelection = applyPolicyDecision(
    manager,
    { decision: 'execute', taskId: low.id, reason: 'choose lower priority' },
    { username: 'owner' },
  );
  const validSelection = applyPolicyDecision(
    manager,
    { decision: 'execute', taskId: high.id, reason: 'deterministic next work' },
    { username: 'owner' },
  );
  assert.equal(invalidSelection.accepted, false, 'policy cannot reorder deterministic priority');
  assert.equal(validSelection.accepted, true);
}

{
  const manager = new UnifiedQueueManager();
  const needsInput = manager.enqueue(input({ priority: 'normal' }));
  const unrelated = manager.enqueue(input({ priority: 'low' }));
  const requested = applyPolicyDecision(
    manager,
    { decision: 'request_input', taskId: needsInput.id, reason: 'Need an owner choice' },
    { username: 'owner' },
  );
  assert.equal(requested.accepted, true);
  assert.equal(manager.getTask(needsInput.id)?.state, 'waiting');
  assert.equal(manager.getNextExecutable()?.id, unrelated.id, 'request_input must not block unrelated work');

  const now = 1_000_000;
  assert.equal(applyPolicyDecision(
    manager,
    { decision: 'wait', reason: 'cooldown', wakeAt: new Date(now + 60_000).toISOString() },
    { username: 'owner', now },
  ).accepted, true);
  assert.equal(applyPolicyDecision(
    manager,
    { decision: 'wait', reason: 'unbounded wait', wakeAt: new Date(now + 2 * 60 * 60_000).toISOString() },
    { username: 'owner', now },
  ).accepted, false);
}

{
  const manager = new UnifiedQueueManager();
  const engine = new ExecutionEngine({ wakeFallbackMs: 250 }, manager);
  engine.registerHandler('agent.dreamer', async () => ({ dreamed: true }));
  engine.registerHandler('agent.psychoanalyzer', async () => ({ reviewed: true }));
  engine.start();

  const parent = manager.enqueue({
    type: 'sleep_workflow',
    handler: 'workflow.sleep',
    resource: 'local-llm',
    source: 'user',
    priority: 'normal',
    username: 'owner',
    input: { force: true },
    maxAttempts: 1,
  });
  await waitFor(() => manager.getTask(parent.id)?.state === 'completed');
  await waitFor(() => manager.getHistory().filter(task => task.parentTaskId === parent.id).length === 2);
  const children = manager.getHistory().filter(task => task.parentTaskId === parent.id);
  assert.deepEqual(children.map(task => task.handler).sort(), ['agent.dreamer', 'agent.psychoanalyzer']);
  assert.equal(children.every(task => task.state === 'completed'), true);
  await engine.stop();
}

console.log('work coordinator contract passed');
eventBus.disconnect();
