import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-environment-compatibility-'));
process.env.METAHUMAN_ROOT = isolatedRoot;
globalThis.fetch = async () => { throw new Error('Network is forbidden in this owner fixture'); };
const { eventBus } = await import('../infrastructure/event-bus/client.js');
eventBus.disconnect();
const { setAuditEnabled } = await import('../audit.js');
setAuditEnabled(false);
const {
  dispatchEnvironmentActions,
  enqueueConnectedEnvironmentStops,
  enqueueEnvironmentAction,
  getEnvironmentActionContext,
  getEnvironmentBridgeStatePath,
  publishEnvironmentObservation,
  prepareEnvironmentCommand,
  readEnvironmentBridgeState,
  recordEnvironmentActionResult,
  recordEnvironmentObservation,
  recordEnvironmentRobotStatus,
  sanitizeEnvironmentBridgeObservation,
  subscribeEnvironmentActions,
  writeEnvironmentBridgeState,
} = await import('./index.js');
const { getQueueManager } = await import('../queue/index.js');
const {
  environmentObservationNeedsCognition,
  environmentObservationStartsUserTurn,
  handleEnvironmentBridgeActionResult,
  handleEnvironmentBridgeObservation,
  handleEnvironmentBridgeStream,
} = await import('../api/handlers/environment-bridge.js');
import type { UnifiedRequest } from '../api/types.js';
const { validateEnvironmentSelectorOutput } = await import('../nodes/environment/helpers.js');
const { environmentActionParserNode } = await import('../nodes/environment/action-parser.node.js');
const { environmentContextBuilderNode } = await import('../nodes/environment/context-builder.node.js');
const { environmentImageInputNode } = await import('../nodes/environment/image-input.node.js');
const { environmentSendActionNode } = await import('../nodes/environment/send-action.node.js');
const { TextInputNode } = await import('../nodes/input/text-input.node.js');
const { JSONParserNode } = await import('../nodes/utility/json-parser.node.js');
import type { EnvironmentObservation } from './types.js';

const statePath = getEnvironmentBridgeStatePath();
const stateExisted = fs.existsSync(statePath);
const originalState = stateExisted ? fs.readFileSync(statePath) : undefined;
const originalToken = process.env.MH_ENVIRONMENT_BRIDGE_TOKEN;
const manager = getQueueManager();
const originalWork = manager.exportState();
const { runDurableGraph, withGraphWork } = await import('../durable-execution/runtime.js');
const { openExecutionStore } = await import('../durable-execution/storage.js');
const { validateSvelteFlowGraph } = await import('../cognitive-graph-schema.js');

async function sendAction(inputs: Record<string, unknown>, context: Record<string, unknown>, properties: Record<string, unknown>) {
  const nodes: any[] = [{ id: 'send', type: 'environmentNode', position: { x: 600, y: 0 },
    data: { label: 'Bridge Out', nodeType: environmentSendActionNode.id, properties } }];
  const edges: any[] = [];
  for (const [key, value] of Object.entries(inputs)) {
    nodes.push({ id: key, type: 'inputNode', position: { x: 0, y: nodes.length * 80 },
      data: { label: key, nodeType: 'text_input', properties: { inputKey: '', message: JSON.stringify(value) } } },
    { id: `${key}-parsed`, type: 'utilityNode', position: { x: 300, y: nodes.length * 80 },
      data: { label: key, nodeType: 'json_parser', properties: {} } });
    edges.push({ id: `${key}-parse`, source: key, sourceHandle: 'text', target: `${key}-parsed`, targetHandle: 'text' },
      { id: `${key}-send`, source: `${key}-parsed`, sourceHandle: 'data', target: 'send', targetHandle: key });
  }
  const work = manager.enqueue({ type: 'generic', handler: 'graph.resume', source: 'user',
    username: 'bridge-spec', input: { requestId: randomUUID() } });
  assert.ok(manager.claim(work.id));
  const result = await withGraphWork(work, id => manager.attachExecution(work.id, id), () => runDurableGraph({
    graph: validateSvelteFlowGraph({ name: 'Bridge contract', version: '1.0', format: 'svelte-flow',
      scheduler: { version: 1, activation: 'demand', skippedState: 'explicit', sideEffectOrder: 'serial-topological', maxLoopIterations: 5 }, nodes, edges }),
    context: { ...context, username: 'bridge-spec', requestId: randomUUID(), environment: 'server' },
  }), async input => manager.enqueue(input));
  manager.complete(work.id, result.status !== 'failed', { status: result.status, executionId: result.executionId });
  assert.notEqual(result.status, 'failed', result.error?.stack);
  return result.nodes.get('send')!.outputs!;
}

function resetState(): void {
  manager.clear();
  const timestamp = new Date().toISOString();
  writeEnvironmentBridgeState({
    enabled: true,
    updatedAt: timestamp,
    sessions: {
      'robot-1': {
        sessionId: 'robot-1',
        environmentId: 'ainekio',
        adapter: 'ainekio-gateway',
        status: 'connected',
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
      },
    },
    feedback: [],
  });
}

function bridgeRequest(headers: Record<string, string> = {}, body: Record<string, unknown> = {}): UnifiedRequest {
  return {
    path: '/api/environment-bridge/observation',
    method: 'POST',
    headers,
    body,
    user: { userId: 'bridge-spec', username: 'bridge-spec', role: 'guest', isAuthenticated: false },
  };
}

try {
  for (const action of [{ type: 'stop' as const }, { type: 'robotCommand' as const, command: 'stop' }]) {
    const prepared = prepareEnvironmentCommand({ ...action, sessionId: 'robot-1' });
    assert.equal(prepared.input.type, 'stop', 'Equivalent advertised commands use one transport operation');
    assert.equal(prepared.input.command, undefined);
    assert.equal(prepared.resource, 'environment-stop:robot-1');
    assert.equal(prepared.priority, 'critical');
  }
  resetState();
  process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = 'bridge-secret';
  const lateFrame = {
    id: 'late-audio-frame', environmentId: 'ainekio', adapter: 'ainekio-gateway', sessionId: 'robot-1',
    timestamp: new Date().toISOString(), capabilities: { actions: ['captureImage'], visual: true },
    visual: { id: 'late-image', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,/9j/2gAA/9k=' },
    metadata: { audioUtteranceId: 'already-admitted-turn' },
  };
  for (let retry = 0; retry < 2; retry++) {
    const admitted = await handleEnvironmentBridgeObservation(bridgeRequest({ Authorization: 'Bearer bridge-secret' }, lateFrame), () => 'bridge-spec');
    assert.equal(admitted.status, 200);
    assert.equal(admitted.data.graphQueued, false, 'A late/replayed speech capture cannot start another conversation');
    assert.equal(readEnvironmentBridgeState().sessions['robot-1']?.latestObservation?.visual?.id, 'late-image', 'The frame is persisted before its transport ACK');
    assert.equal(manager.getAllTasks().length, 0);
  }
  resetState();
  const readinessTimestamp = new Date().toISOString();
  recordEnvironmentObservation({
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: readinessTimestamp,
    capabilities: {
      actions: ['sendText', 'robotCommand'],
      visual: false,
    },
    state: {
      body: {
        authenticated: true,
        robotId: 'robot-1',
        cameraReady: false,
      },
    },
  });
  recordEnvironmentRobotStatus('robot-1', {
    robot_id: 'robot-1',
    camera_ready: true,
  });
  let readinessObservation = readEnvironmentBridgeState().sessions['robot-1']?.latestObservation;
  assert.equal(readinessObservation?.state?.body && (
    readinessObservation.state.body as Record<string, unknown>
  ).cameraReady, true);
  assert.equal(readinessObservation?.capabilities.visual, true);
  assert.equal(readinessObservation?.capabilities.actions.includes('captureImage'), true);
  assert.equal(manager.getAllTasks().length, 0, 'capability refresh must not enqueue cognition');

  recordEnvironmentRobotStatus('robot-1', {
    robot_id: 'robot-1',
    camera_ready: false,
  });
  readinessObservation = readEnvironmentBridgeState().sessions['robot-1']?.latestObservation;
  assert.equal(readinessObservation?.capabilities.visual, false);
  assert.equal(readinessObservation?.capabilities.actions.includes('captureImage'), false);

  resetState();
  const stale = enqueueEnvironmentAction({
    type: 'robotCommand',
    command: 'walk',
    sessionId: 'robot-1',
    createdAt: '2000-01-01T00:00:00Z',
  });
  assert.deepEqual(dispatchEnvironmentActions('robot-1'), []);
  assert.equal(manager.getTask(stale.workItemId!)?.state, 'expired');

  resetState();
  const motionPlan = enqueueEnvironmentAction({
    type: 'robotMotionPlan',
    sessionId: 'robot-1',
    frames: [{
      durationMs: 300,
      targets: ['R1', 'R2', 'L1', 'L2', 'R4', 'R3', 'L3', 'L4'].map(joint => ({
        joint: joint as 'R1',
        degrees: 90,
      })),
    }],
    endPose: 'hold',
  });
  const dispatchedPlan = dispatchEnvironmentActions('robot-1')[0];
  assert.equal(dispatchedPlan?.id, motionPlan.id);
  assert.equal(dispatchedPlan?.type, 'robotMotionPlan');
  assert.equal(dispatchedPlan?.frames?.length, 1);
  assert.equal(dispatchedPlan?.frames?.[0]?.targets.length, 8);
  assert.equal(dispatchedPlan?.endPose, 'hold');
  recordEnvironmentActionResult({
    id: 'plan-completed',
    timestamp: new Date().toISOString(),
    type: 'completed',
    message: 'done',
    actionId: motionPlan.id,
  });

  resetState();
  const movement = enqueueEnvironmentAction({ type: 'robotCommand', command: 'walk', sessionId: 'robot-1' });
  enqueueEnvironmentAction({ type: 'stop', sessionId: 'robot-1' });
  const dispatched = dispatchEnvironmentActions('robot-1');
  assert.deepEqual(dispatched.map(command => command.type), ['stop']);
  assert.equal(manager.getTask(movement.workItemId!)?.state, 'cancelled');

  resetState();
  const emergencyMovement = enqueueEnvironmentAction({ type: 'robotCommand', command: 'walk', sessionId: 'robot-1' });
  const emergencyStops = enqueueConnectedEnvironmentStops('greggles', 'spec emergency stop', Date.parse('2026-07-14T12:00:00Z'));
  assert.equal(emergencyStops.length, 1);
  assert.equal(emergencyStops[0]?.type, 'stop');
  assert.equal(manager.getTask(emergencyStops[0]!.workItemId!)?.priority, 'critical');
  assert.equal(manager.getTask(emergencyMovement.workItemId!)?.state, 'cancelled');

  resetState();
  const firstCommand = enqueueEnvironmentAction({ type: 'robotCommand', command: 'stand', sessionId: 'robot-1' });
  const secondCommand = enqueueEnvironmentAction({ type: 'robotCommand', command: 'wave', sessionId: 'robot-1' });
  const claimedCommand = dispatchEnvironmentActions('robot-1')[0];
  assert.ok(
    claimedCommand?.id === firstCommand.id || claimedCommand?.id === secondCommand.id,
    'one of the queued commands must be claimed',
  );
  assert.deepEqual(dispatchEnvironmentActions('robot-1'), [], 'one session may claim only one command at a time');
  recordEnvironmentActionResult({
    id: 'first-command-accepted',
    timestamp: new Date().toISOString(),
    type: 'accepted',
    message: 'accepted',
    actionId: claimedCommand!.id,
  });
  const remainingCommandId = claimedCommand!.id === firstCommand.id ? secondCommand.id : firstCommand.id;
  assert.equal(manager.getTask(claimedCommand!.workItemId!)?.state, 'leased');
  assert.deepEqual(
    dispatchEnvironmentActions('robot-1'),
    [],
    'adapter acceptance must not release the robot resource before terminal feedback',
  );
  recordEnvironmentActionResult({
    id: 'first-command-completed',
    timestamp: new Date().toISOString(),
    type: 'completed',
    message: 'done',
    actionId: claimedCommand!.id,
  });
  assert.equal(dispatchEnvironmentActions('robot-1')[0]?.id, remainingCommandId);

  resetState();
  const stateWithTwoSessions = readEnvironmentBridgeState();
  stateWithTwoSessions.sessions['robot-2'] = {
    sessionId: 'robot-2',
    environmentId: 'ainekio-2',
    adapter: 'ainekio-gateway',
    status: 'connected',
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  writeEnvironmentBridgeState(stateWithTwoSessions);
  const robotOneCommand = enqueueEnvironmentAction({ type: 'robotCommand', command: 'stand', sessionId: 'robot-1' });
  const robotTwoCommand = enqueueEnvironmentAction({ type: 'robotCommand', command: 'wave', sessionId: 'robot-2' });
  assert.equal(dispatchEnvironmentActions('robot-2')[0]?.id, robotTwoCommand.id);
  assert.equal(manager.getTask(robotOneCommand.workItemId!)?.state, 'queued', 'a session must not claim another session\'s work');

  resetState();
  const autonomyWork = manager.enqueue({
    type: 'reflect',
    handler: 'agent.reflector',
    resource: 'local-llm',
    source: 'autonomy',
    priority: 'background',
    username: 'greggles',
    input: {},
  });
  const prioritizedObservation = publishEnvironmentObservation({
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: new Date().toISOString(),
    capabilities: { actions: ['robotCommand'] },
  }, { username: 'bridge-spec' });
  assert.equal(manager.getNextExecutable()?.id, prioritizedObservation.workId, 'environment observations must preempt autonomy');
  assert.equal(manager.getTask(prioritizedObservation.workId)?.input.observationCurrent, true);
  assert.notEqual(prioritizedObservation.workId, autonomyWork.id);

  resetState();
  const lifecycle = enqueueEnvironmentAction({ type: 'robotCommand', command: 'stand', sessionId: 'robot-1' });
  assert.equal(dispatchEnvironmentActions('robot-1')[0]?.id, lifecycle.id);
  process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = 'bridge-secret';
  const acceptedResponse = await handleEnvironmentBridgeActionResult(bridgeRequest({
    Authorization: 'Bearer bridge-secret',
  }, {
    id: 'accepted-1',
    timestamp: new Date().toISOString(),
    type: 'accepted',
    message: 'accepted',
    actionId: lifecycle.id,
  }));
  assert.equal(acceptedResponse.status, 200);
  assert.equal(acceptedResponse.data.action.status, 'dispatched');
  assert.equal(acceptedResponse.data.robotBufferPersisted, false);
  assert.equal(manager.getTask(lifecycle.workItemId!)?.state, 'leased');
  assert.equal(readEnvironmentBridgeState().feedback.length, 0);

  publishEnvironmentObservation({
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: new Date().toISOString(),
    capabilities: { actions: ['robotCommand'] },
    feedback: [{
      id: 'accepted-1',
      timestamp: new Date().toISOString(),
      type: 'accepted',
      message: 'accepted',
      actionId: lifecycle.id,
    }],
  }, { username: 'bridge-spec' });
  assert.equal(
    readEnvironmentBridgeState().feedback.filter(item => item.id === 'accepted-1').length,
    1,
  );
  recordEnvironmentActionResult({
    id: 'completed-1',
    timestamp: new Date().toISOString(),
    type: 'completed',
    message: 'done',
    actionId: lifecycle.id,
  });

  const cancellable = enqueueEnvironmentAction({ type: 'robotCommand', command: 'stand', sessionId: 'robot-1' });
  assert.equal(dispatchEnvironmentActions('robot-1')[0]?.id, cancellable.id);
  const cancelled = recordEnvironmentActionResult({
    id: 'cancelled-1',
    timestamp: new Date().toISOString(),
    type: 'cancelled',
    message: 'cancelled',
    actionId: cancellable.id,
  });
  assert.equal(cancelled?.action.status, 'cancelled');
  assert.equal(manager.getTask(cancellable.workItemId!)?.state, 'cancelled');

  delete process.env.MH_ENVIRONMENT_BRIDGE_TOKEN;
  assert.equal((await handleEnvironmentBridgeObservation(bridgeRequest())).status, 503);
  assert.equal((await handleEnvironmentBridgeStream(bridgeRequest())).status, 503);
  process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = 'bridge-secret';
  assert.equal((await handleEnvironmentBridgeObservation(bridgeRequest())).status, 401);
  assert.equal((await handleEnvironmentBridgeStream(bridgeRequest())).status, 401);
  assert.equal((await handleEnvironmentBridgeObservation(bridgeRequest({ Authorization: 'Bearer bridge-secret' }))).status, 400);
  assert.equal((await handleEnvironmentBridgeActionResult(bridgeRequest({ Authorization: 'Bearer bridge-secret' }, {
    type: 'not-a-lifecycle-state',
    message: 'invalid',
  }))).status, 400);

  resetState();
  const resultAction = enqueueEnvironmentAction({
    type: 'robotCommand',
    command: 'wave',
    sessionId: 'robot-1',
  }, {
    username: 'robot-owner',
    correlationId: 'conversation-turn-1',
    originatingInstruction: 'Wave, then use the returned view to tell me what changed.',
  });
  assert.equal(dispatchEnvironmentActions('robot-1')[0]?.id, resultAction.id);
  let admittedUsername = '';
  let admittedRecord: Record<string, unknown> | undefined;
  const actionResultResponse = await handleEnvironmentBridgeActionResult(bridgeRequest({
    Authorization: 'Bearer bridge-secret',
  }, {
    id: 'completed-feedback-1',
    timestamp: new Date().toISOString(),
    type: 'completed',
    message: 'done',
    actionId: resultAction.id,
    data: { sequence: 42 },
  }), async (username, record) => {
    admittedUsername = username;
    admittedRecord = record;
    return true;
  });
  assert.equal(actionResultResponse.status, 200);
  assert.equal(actionResultResponse.data.robotBufferPersisted, true);
  assert.equal(actionResultResponse.data.action.id, resultAction.id);
  assert.equal(admittedUsername, 'robot-owner', 'feedback must return to the profile that queued the command');
  assert.equal(admittedRecord?.direction, 'inbound');
  assert.equal(admittedRecord?.status, 'completed');
  assert.equal(admittedRecord?.actionId, resultAction.id);
  assert.equal((admittedRecord?.feedback as { id?: string })?.id, 'completed-feedback-1');
  assert.equal((admittedRecord?.action as { command?: string })?.command, 'wave');
  const contextualResult = sanitizeEnvironmentBridgeObservation({
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: new Date().toISOString(),
    capabilities: { actions: ['robotCommand'], visual: true },
    feedback: [{
      id: 'completed-feedback-1',
      timestamp: new Date().toISOString(),
      type: 'completed',
      message: 'done',
      actionId: resultAction.id,
      data: { command: 'robotCommand' },
    }],
    metadata: {
      actionId: resultAction.id,
      originatingInstruction: 'untrusted adapter instruction',
      robotObserver: {
        cycleId: 'untrusted-cycle',
        step: 1,
        triggerSource: 'autonomy',
        graph: 'environment',
        requestedBy: 'environment-perception',
      },
      robotOperatorDecision: {
        observed: 'untrusted adapter observation',
        instruction: 'untrusted adapter autonomy instruction',
        reason: 'untrusted adapter reason',
      },
      robotOperatorMemories: ['untrusted adapter memory'],
      autonomousStimulus: 'boredom-observer',
    },
  });
  const contextualActionContext = getEnvironmentActionContext(contextualResult);
  assert.equal(
    contextualActionContext?.requested.command,
    'wave',
    'Work Coordinator action context must be recovered separately from the adapter observation',
  );
  assert.equal(contextualResult.metadata?.originatingInstruction, undefined);
  assert.equal(contextualResult.metadata?.robotObserver, undefined);
  assert.equal(contextualResult.metadata?.robotOperatorDecision, undefined);
  assert.equal(contextualResult.metadata?.robotOperatorMemories, undefined);
  assert.equal(contextualResult.metadata?.autonomousStimulus, undefined);
  const uncorrelatedObservation = sanitizeEnvironmentBridgeObservation({
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: new Date().toISOString(),
    capabilities: { actions: ['robotCommand'], visual: true },
    visual: {
      id: 'camera-frame-uncorrelated',
      timestamp: new Date().toISOString(),
      mimeType: 'image/jpeg',
    },
    metadata: {
      sensorReading: 'preserved',
      robotObserver: { cycleId: 'untrusted-cycle' },
      robotOperatorDecision: { instruction: 'untrusted planner instruction' },
      robotOperatorMemories: ['untrusted memory'],
      autonomousStimulus: 'untrusted stimulus',
    },
  });
  assert.equal(uncorrelatedObservation.metadata?.sensorReading, 'preserved');
  assert.equal(uncorrelatedObservation.visual?.id, 'camera-frame-uncorrelated');
  assert.equal(uncorrelatedObservation.capabilities.visual, true);
  assert.equal(uncorrelatedObservation.metadata?.robotObserver, undefined);
  assert.equal(uncorrelatedObservation.metadata?.robotOperatorDecision, undefined);
  assert.equal(uncorrelatedObservation.metadata?.robotOperatorMemories, undefined);
  assert.equal(uncorrelatedObservation.metadata?.autonomousStimulus, undefined);
  assert.deepEqual(
    contextualActionContext && {
      actionId: contextualActionContext.actionId,
      status: contextualActionContext.status,
      requested: contextualActionContext.requested,
      correlationId: contextualActionContext.correlationId,
      originatingInstruction: contextualActionContext.originatingInstruction,
      queuedAt: contextualActionContext.queuedAt,
      completedAt: contextualActionContext.completedAt,
      result: contextualActionContext.result,
    },
    {
      actionId: resultAction.id,
      status: 'completed',
      requested: { type: 'robotCommand', command: 'wave' },
      correlationId: 'conversation-turn-1',
      originatingInstruction: 'Wave, then use the returned view to tell me what changed.',
      queuedAt: resultAction.createdAt,
      completedAt: manager.getTask(resultAction.workItemId!)?.completedAt,
      result: { type: 'completed', message: 'done' },
    },
    'the separate Work Coordinator input must recover the exact semantic action MetaHuman requested',
  );
  const contextualTiming = contextualActionContext?.actionTiming;
  assert.ok(contextualTiming);
  assert.equal(contextualTiming.queueEnteredAt, resultAction.createdAt);
  assert.equal(contextualTiming.leaseGrantedAt, manager.getTask(resultAction.workItemId!)?.startedAt);
  assert.equal(
    typeof contextualTiming.coreFeedbackReceivedAt,
    'string',
    'a later observation must recover lifecycle timing from the existing Work Coordinator result',
  );
  assert.equal(environmentObservationNeedsCognition({
    ...contextualResult,
    visual: {
      id: 'post-action-frame-1',
      timestamp: new Date().toISOString(),
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,/9j/2gAA/9k=',
      source: 'robot-camera',
      metadata: {
        actionId: resultAction.id,
        correlationId: 'post-action-cycle-1',
      },
    },
    metadata: {
      ...contextualResult.metadata,
      actionId: resultAction.id,
      correlationId: 'post-action-cycle-1',
    },
  }), true, 'a correlated gateway action result and image must return to Environment cognition');

  const observerCapture = enqueueEnvironmentAction({
    type: 'captureImage',
    sessionId: 'robot-1',
    metadata: {
      robotObserver: {
        cycleId: 'observer-capture-cycle',
        step: 1,
        triggerSource: 'user',
        graph: 'boredom-observer',
        requestedBy: 'boredom-observer',
      },
    },
  }, {
    username: 'robot-owner',
    correlationId: 'observer-capture-cycle',
  });
  const expiredCaptureObservation: EnvironmentObservation = {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: new Date().toISOString(),
    capabilities: { actions: ['captureImage'], visual: true },
    feedback: [{
      id: 'observer-capture-expired',
      timestamp: new Date().toISOString(),
      type: 'expired',
      message: 'adapter did not dispatch the command in time',
      actionId: observerCapture.id,
    }],
  };
  const contextualExpiry = sanitizeEnvironmentBridgeObservation(expiredCaptureObservation);
  const expiryActionContext = getEnvironmentActionContext(contextualExpiry);
  assert.equal(expiryActionContext?.correlationId, 'observer-capture-cycle');
  assert.equal(
    (expiryActionContext?.robotObserver as { requestedBy?: string })?.requestedBy,
    'boredom-observer',
  );
  assert.equal(environmentObservationNeedsCognition(contextualExpiry), true);
  const expiredCaptureResponse = await handleEnvironmentBridgeObservation(bridgeRequest({
    Authorization: 'Bearer bridge-secret',
  }, expiredCaptureObservation as unknown as Record<string, unknown>), () => 'robot-owner');
  assert.equal(expiredCaptureResponse.status, 200);
  assert.equal(expiredCaptureResponse.data.graphQueued, true);
  assert.equal(
    manager.getAllTasks().filter(task => task.type === 'environment_observation').length,
    1,
    'an initial Robot Observer capture failure must return to the correlated workflow for revision',
  );

  const rejectedPersistence = await handleEnvironmentBridgeActionResult(bridgeRequest({
    Authorization: 'Bearer bridge-secret',
  }, {
    id: 'completed-feedback-retry',
    timestamp: new Date().toISOString(),
    type: 'completed',
    message: 'done',
    actionId: resultAction.id,
  }), async () => false);
  assert.equal(rejectedPersistence.status, 500, 'a failed Robot Buffer admission must not be reported as success');

  resetState();
  const observationTimestamp = new Date().toISOString();
  const unboundObservation = await handleEnvironmentBridgeObservation(bridgeRequest({
    Authorization: 'Bearer bridge-secret',
    'X-MetaHuman-Environment-User': 'forged-profile',
    'X-MetaHuman-Environment-Graph': 'environment',
  }, {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: observationTimestamp,
    capabilities: { actions: ['robotCommand'] },
  }), () => null);
  assert.equal(unboundObservation.status, 200);
  assert.equal(unboundObservation.data.graphQueued, false);
  assert.equal(unboundObservation.data.reason, 'no_active_authorized_user');
  assert.equal(manager.getAllTasks().length, 0, 'an observation without an active user must not enter a profile graph');
  assert.equal(readEnvironmentBridgeState().sessions['robot-1']?.status, 'connected');

  const observationResponse = await handleEnvironmentBridgeObservation(bridgeRequest({
    Authorization: 'Bearer bridge-secret',
    'X-MetaHuman-Environment-User': 'forged-profile',
    'X-MetaHuman-Environment-Graph': 'environment',
  }, {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: observationTimestamp,
    capabilities: { actions: ['robotCommand'] },
    text: [{
      id: 'active-observation-text-1',
      source: 'environment',
      text: 'A new user utterance is ready for processing.',
      timestamp: observationTimestamp,
    }],
  }), () => 'active-profile');
  assert.equal(observationResponse.status, 200);
  assert.equal(observationResponse.data.graphQueued, true);
  const observationWorkId = observationResponse.data.workId as string;
  const observationWork = manager.getTask(observationWorkId);
  assert.equal(observationWork?.type, 'environment_observation');
  assert.equal(observationWork?.handler, 'environment.observation');
  assert.equal(observationWork?.resource, 'local-llm');
  assert.equal(observationWork?.username, 'active-profile');
  assert.equal(observationWork?.input.graph, 'environment');
  assert.equal(observationWork?.input.observation.sessionId, 'robot-1');

  const connectionObservation: EnvironmentObservation = {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: new Date().toISOString(),
    capabilities: { actions: ['robotCommand'] },
    state: {
      bodyEvent: {
        t: 'connection',
        status: 'connected',
        robot_id: 'robot-1',
      },
    },
  };
  assert.equal(environmentObservationNeedsCognition(connectionObservation), false);
  assert.equal(environmentObservationStartsUserTurn(connectionObservation), false);
  assert.equal(environmentObservationStartsUserTurn({
    ...connectionObservation,
    timestamp: new Date().toISOString(),
    metadata: { perceptionEvent: 'audio_utterance' },
    text: [{
      id: 'robot-microphone-user-turn',
      source: 'player',
      text: 'Please stop and listen to this instead.',
      timestamp: new Date().toISOString(),
      channel: 'microphone',
    }],
  }), true, 'human speech transcribed from the robot microphone must start a new interrupting user turn');
  assert.equal(environmentObservationNeedsCognition({
    ...connectionObservation,
    timestamp: new Date().toISOString(),
    state: {
      bodyEvent: {
        t: 'event',
        name: 'boot',
        robot_id: 'robot-1',
      },
    },
  }), false);
  const connectionResponse = await handleEnvironmentBridgeObservation(bridgeRequest({
    Authorization: 'Bearer bridge-secret',
    'X-MetaHuman-Environment-Graph': 'environment',
  }, connectionObservation as unknown as Record<string, unknown>), () => 'active-profile');
  assert.equal(connectionResponse.status, 200);
  assert.equal(connectionResponse.data.graphQueued, false);
  assert.equal(connectionResponse.data.reason, 'state_only_observation');

  const structured = validateEnvironmentSelectorOutput(JSON.stringify({
    response: 'Walking forward.',
    actions: [{ type: 'robotCommand', command: 'walk', units: 3 }],
    movementRequest: null,
    taskDecision: {
      objective: 'Walk forward once.',
      outcome: 'act',
      reason: 'Walk once.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'action_result',
      motionClass: 'open_loop_displacement',
      actionPurpose: 'task_effect',
    },
  }), 'robot-1');
  assert.equal(structured.valid, true);
  assert.equal(structured.value?.response, 'Walking forward.');
  assert.equal(structured.value?.actions.length, 1);
  assert.equal(structured.value?.actions[0]?.type, 'robotCommand');
  assert.equal(structured.value?.actions[0]?.sessionId, 'robot-1');
  assert.equal(structured.value?.actions[0]?.command, 'walk');
  assert.equal(structured.value?.actions[0]?.units, 3);
  assert.equal(structured.value?.taskDecision?.motionClass, 'open_loop_displacement');
  const completed = validateEnvironmentSelectorOutput(JSON.stringify({
    response: 'The current frame confirms the requested view.',
    actions: [],
    movementRequest: null,
    taskDecision: {
      objective: 'Confirm the requested view.',
      outcome: 'complete',
      reason: 'The correlated frame visibly satisfies the objective.',
      objectiveComplete: true,
      continuationPolicy: 'none',
      requiredCompletionBasis: 'visual_observation',
      completionEvidence: 'Frame ainekio-camera-28 shows the requested view.',
    },
  }), 'robot-1');
  assert.equal(completed.valid, true);
  assert.equal(
    completed.value?.taskDecision?.completionEvidence,
    'Frame ainekio-camera-28 shows the requested view.',
  );
  assert.equal(validateEnvironmentSelectorOutput('walk forward', 'robot-1').valid, false);
  assert.equal(validateEnvironmentSelectorOutput(JSON.stringify({
    response: 'Turning curiously.',
    actions: [{ type: 'move', command: 'curious', durationMs: 750 }],
    movementRequest: null,
    taskDecision: {
      objective: 'Reorient the robot.',
      outcome: 'act',
      reason: 'Reorient.',
      objectiveComplete: false,
      continuationPolicy: 'none',
      requiredCompletionBasis: 'action_result',
      motionClass: 'body_local',
      actionPurpose: 'expression',
    },
  }), 'robot-1').valid, false, 'a robot command cannot masquerade as a generic move');

  const conversationOnly = await sendAction({
    actions: [],
    sessionId: 'robot-1',
  }, { username: 'bridge-spec', sessionId: 'chat-1' } as never, {});
  assert.equal(conversationOnly.status, 'no_actions');
  assert.equal('response' in conversationOnly, false);
  assert.equal('conversationResponse' in conversationOnly, false);
  assert.equal(conversationOnly.bridgeRecord.status, 'no_actions');
  assert.equal(conversationOnly.bridgeRecord.commandCount, 0);
  assert.deepEqual(conversationOnly.bridgeRecord.requestedActions, []);
  assert.match(conversationOnly.bridgeRecord.correlationId, /^[a-f0-9-]{36}$/);

  const emptyConversation = await sendAction({
    actions: [],
    sessionId: 'robot-1',
  }, { username: 'bridge-spec', sessionId: 'chat-empty' } as never, {});
  assert.equal(emptyConversation.status, 'no_actions');
  assert.match(emptyConversation.message, /no environment action was produced/i);

  const unavailableAction = await sendAction({
    actions: [{ type: 'robotCommand', command: 'walk', sessionId: 'robot-1' }],
    sessionId: 'robot-1',
  }, { username: 'bridge-spec', sessionId: 'chat-1' } as never, {});
  assert.equal(unavailableAction.status, 'waiting_for_adapter');
  assert.match(String(unavailableAction.message), /no robot adapter is connected/i);
  assert.equal(unavailableAction.bridgeRecord.status, 'waiting_for_adapter');
  assert.equal(unavailableAction.bridgeRecord.targetSessionId, 'robot-1');
  assert.equal(unavailableAction.bridgeRecord.requestedActions.length, 1);

  resetState();
  const bodyOfflineState = readEnvironmentBridgeState();
  bodyOfflineState.sessions['robot-1']!.latestObservation = {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: new Date().toISOString(),
    capabilities: { actions: ['sendText'], movement: false, visual: false },
    state: { body: { authenticated: false, cameraReady: false } },
  };
  writeEnvironmentBridgeState(bodyOfflineState);
  const unsubscribeOffline = subscribeEnvironmentActions('robot-1', () => {});
  const bodyOffline = await sendAction({
    actions: [{ type: 'robotCommand', command: 'walk', sessionId: 'robot-1' }],
    sessionId: 'robot-1',
  }, { username: 'bridge-spec', sessionId: 'chat-offline' } as never, {});
  unsubscribeOffline();
  assert.equal(bodyOffline.status, 'rejected');
  assert.equal(bodyOffline.reason, 'robot_body_offline');
  assert.equal(bodyOffline.count, 0);
  assert.equal(bodyOffline.adapterReady, true);
  assert.equal(bodyOffline.bodyAuthenticated, false);
  assert.equal('response' in bodyOffline, false);

  resetState();
  const bodyOnlineState = readEnvironmentBridgeState();
  bodyOnlineState.sessions['robot-1']!.latestObservation = {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: new Date().toISOString(),
    capabilities: { actions: ['robotCommand'], robotCommands: ['walk'], movement: true },
    state: { body: { authenticated: true, cameraReady: false } },
  };
  writeEnvironmentBridgeState(bodyOnlineState);
  const unsubscribeOnline = subscribeEnvironmentActions('robot-1', () => {});
  const bodyQueued = await sendAction({
    actions: [{ type: 'robotCommand', command: 'walk', sessionId: 'robot-1' }],
    sessionId: 'robot-1',
    instruction: 'Walk once, then use the returned observation to tell me what changed.',
    userInstruction: 'Walk once, then use the returned observation to tell me what changed.',
  }, {
    username: 'bridge-spec',
    sessionId: 'chat-online',
  } as never, {});
  unsubscribeOnline();
  assert.equal(bodyQueued.status, 'coordinated_for_adapter');
  assert.equal(bodyQueued.count, 1);
  assert.equal(bodyQueued.ready, true);
  assert.equal('response' in bodyQueued, false);
  const queuedBodyCommand = bodyQueued.commands[0];
  assert.ok(queuedBodyCommand);
  const queuedBodyWork = manager.getAllTasks().find(task => task.input.id === queuedBodyCommand.id)!;
  assert.equal(queuedBodyWork.correlationId, queuedBodyCommand.executionId);
  assert.equal(queuedBodyWork.durable?.executionId, queuedBodyCommand.executionId);
  assert.equal(queuedBodyCommand.metadata?.robotObserver, undefined, 'Action results return to the execution, not a fresh feedback graph');
  assert.equal(queuedBodyWork.metadata?.originatingInstruction,
    'Walk once, then use the returned observation to tell me what changed.');

  // A claimed action can finish after its graph fails or is cancelled, even if
  // the adapter's earlier acceptance message was lost or delayed.
  for (const terminal of ['failed', 'cancelled'] as const) {
    for (const accepted of [true, false]) {
      resetState();
      writeEnvironmentBridgeState(bodyOnlineState);
      const unsubscribe = subscribeEnvironmentActions('robot-1', () => {});
      const output = await sendAction({
        actions: [{ type: 'robotCommand', command: 'walk', sessionId: 'robot-1' }],
        sessionId: 'robot-1',
      }, {}, {});
      unsubscribe();
      const command = dispatchEnvironmentActions('robot-1')[0]!;
      assert.equal(command.id, output.commands[0].id);
      const task = manager.getTask(command.workItemId!)!;
      assert.ok(task.startedAt && task.bodyLease);
      const store = openExecutionStore(task.username);
      try {
        const execution = store.get(task.durable!.executionId);
        const lease = store.claim(execution.executionId, execution.definition);
        if (terminal === 'failed') store.settle(lease, 'failed');
        else {
          store.cancel(execution.executionId, { eventId: randomUUID(), kind: 'user_cancelled', payload: {} });
          manager.cancel(task.id, 'Fixture cancellation');
          assert.ok(manager.getTask(task.id)?.cancellationRequestedAt);
        }
        store.release(lease);
        assert.throws(() => store.assertDispatchable(task.durable!.effectId));
        assert.throws(() => store.acceptAction(task.durable!.effectId));
        if (accepted) {
          assert.ok(recordEnvironmentActionResult({ id: randomUUID(), actionId: command.id,
            type: 'accepted', timestamp: new Date().toISOString(), message: 'Accepted before graph termination' }));
        }
        const feedback = { id: randomUUID(), actionId: command.id, type: 'completed' as const,
          timestamp: new Date().toISOString(), message: 'Completed previously claimed action' };
        assert.ok(recordEnvironmentActionResult(feedback));
        assert.ok(recordEnvironmentActionResult(feedback));
        assert.equal(manager.getTask(task.id)?.state, 'completed');
        assert.equal(store.dispatch(task.durable!.effectId).status, 'completed');
        assert.equal(store.get(execution.executionId).status, terminal, 'Physical evidence does not revive the parent');
        assert.equal(store.events(execution.executionId).filter(event => event.eventId === feedback.id).length, 1);
        assert.equal(store.pendingDispatches().filter(effect => effect.executionId === execution.executionId).length, 0);
        const next = enqueueEnvironmentAction({ type: 'robotCommand', command: 'stand', sessionId: 'robot-1' });
        assert.equal(dispatchEnvironmentActions('robot-1')[0]?.id, next.id, 'Terminal receipt releases the body');
      } finally { store.close(); }
    }
  }

  resetState();
  const observerCaptureState = readEnvironmentBridgeState();
  observerCaptureState.sessions['robot-1']!.latestObservation = {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: new Date().toISOString(),
    capabilities: { actions: ['captureImage'], visual: true },
    state: { body: { authenticated: true, cameraReady: true } },
  };
  writeEnvironmentBridgeState(observerCaptureState);
  const unsubscribeObserverCapture = subscribeEnvironmentActions('robot-1', () => {});
  const observerCaptureText = await TextInputNode.execute({}, {}, {
    message: '{"type":"captureImage"}',
    inputKey: '',
  });
  const observerCaptureAction = await JSONParserNode.execute({
    text: observerCaptureText.text,
  }, {}, {});
  assert.equal(observerCaptureAction.success, true);
  assert.deepEqual(observerCaptureAction.data, { type: 'captureImage' });
  const observerWorkflowCapture = await sendAction({
    action: observerCaptureAction.data,
    sessionId: 'robot-1',
    instruction: 'Interpret the returned image as one autonomous observation.',
  }, {
    username: 'bridge-spec',
    sessionId: 'observer-capture',
  } as never, {
    allowedActions: ['captureImage'],
  });
  unsubscribeObserverCapture();
  assert.equal(observerWorkflowCapture.status, 'coordinated_for_adapter');
  const observerWork = manager.getAllTasks().find(task => task.input.id === observerWorkflowCapture.commands[0].id)!;
  assert.equal(observerWork.durable?.executionId, observerWorkflowCapture.commands[0].executionId);
  assert.equal(observerWorkflowCapture.commands[0]?.metadata?.robotObserver, undefined);
  assert.equal('responseMetadata' in observerWorkflowCapture, false);
  assert.equal('conversationResponse' in observerWorkflowCapture, false);
  assert.equal(
    observerWork?.metadata?.originatingInstruction,
    'Interpret the returned image as one autonomous observation.',
  );
  assert.equal(observerWork?.deadline, undefined);

  const continuationObservation = {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: new Date().toISOString(),
    capabilities: { actions: ['robotCommand'], robotCommands: ['wave'] },
    feedback: [{
      id: 'completed-result-1',
      timestamp: new Date().toISOString(),
      type: 'completed' as const,
      message: 'done',
      actionId: 'walk-1',
      data: { command: 'walk' },
    }],
    metadata: {
      robotObserver: {
        cycleId: 'utterance-1',
        step: 2,
        triggerSource: 'user',
        graph: 'environment',
        requestedBy: 'environment-perception',
      },
    },
  };

  const parsedTerminalFeedback = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'The wave completed, and the post-action image has returned.',
      actions: [{ type: 'robotCommand', command: 'wave' }],
      movementRequest: null,
      taskDecision: {
        objective: 'Continue the original objective.',
        outcome: 'act',
        reason: 'The advertised wave command is the selected next action.',
        objectiveComplete: false,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'action_result',
        motionClass: 'open_loop_displacement',
        actionPurpose: 'expression',
      },
    }),
    instruction: 'Continue the original objective using this exact terminal result.',
    userInstruction: '',
    inputSource: 'user',
    observation: continuationObservation,
    sessionId: 'robot-1',
    routingAnalysis: { needsAction: true, actionType: 'robot_movement' },
  }, {});
  assert.equal(parsedTerminalFeedback.actions.length, 1);
  assert.equal(parsedTerminalFeedback.actions[0].command, 'wave');
  assert.equal(parsedTerminalFeedback.movementRequest, null);
  assert.equal(parsedTerminalFeedback.movementRequested, false);
  assert.equal(
    parsedTerminalFeedback.response,
    'The wave completed, and the post-action image has returned.',
  );

  const continuationState = readEnvironmentBridgeState();
  continuationState.sessions['robot-1']!.latestObservation = {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: new Date().toISOString(),
    capabilities: {
      actions: ['robotCommand'],
      robotCommands: ['walk'],
      movement: true,
    },
    state: {
      body: {
        authenticated: true,
        robotId: 'robot-1',
        cameraReady: false,
      },
    },
  };
  writeEnvironmentBridgeState(continuationState);
  const unsubscribeContinuation = subscribeEnvironmentActions('robot-1', () => {});
  const queuedContinuation = await sendAction({
    actions: [{ type: 'robotCommand', command: 'walk', sessionId: 'robot-1' }],
    sessionId: 'robot-1',
    instruction: 'Continue the remaining task.',
  }, {
    username: 'bridge-spec',
    sessionId: 'chat-continuation',
  } as never, {});
  unsubscribeContinuation();
  assert.equal(queuedContinuation.status, 'coordinated_for_adapter');
  assert.equal(queuedContinuation.count, 1);
  assert.equal('response' in queuedContinuation, false);

  const visual = {
    id: 'camera-1',
    timestamp: new Date().toISOString(),
    mimeType: 'image/jpeg',
    dataUrl: `data:image/jpeg;base64,${fs.readFileSync(new URL(
      '../../../../vendor/whisper.cpp/examples/whisper.android.java/README_files/1.jpg',
      import.meta.url,
    )).toString('base64')}`,
  };
  const malformedImageOutput = await environmentImageInputNode.execute({
    visual: { ...visual, dataUrl: 'data:image/jpeg;base64,/9j/2Q==' },
  }, {});
  assert.deepEqual(malformedImageOutput.images, []);
  assert.equal(malformedImageOutput.rejectedCount, 1);
  const maximumJpeg = Buffer.alloc(256 * 1024);
  maximumJpeg.set([0xff, 0xd8, 0xff, 0xda], 0);
  maximumJpeg.set([0xff, 0xd9], maximumJpeg.length - 2);
  const maximumImageOutput = await environmentImageInputNode.execute({
    visual: {
      ...visual,
      id: 'maximum-camera-frame',
      dataUrl: `data:image/jpeg;base64,${maximumJpeg.toString('base64')}`,
    },
  }, {});
  assert.equal(maximumImageOutput.images.length, 1);
  const oversizedJpeg = Buffer.concat([maximumJpeg, Buffer.from([0])]);
  const oversizedImageOutput = await environmentImageInputNode.execute({
    visual: {
      ...visual,
      id: 'oversized-camera-frame',
      dataUrl: `data:image/jpeg;base64,${oversizedJpeg.toString('base64')}`,
    },
  }, {});
  assert.deepEqual(oversizedImageOutput.images, []);
  assert.equal(oversizedImageOutput.rejectedCount, 1);
  const imageOutput = await environmentImageInputNode.execute({ visual }, {});
  assert.deepEqual(imageOutput.images, [
    { type: 'image_url', image_url: { url: visual.dataUrl } },
  ]);

  const captureCycle = {
    cycleId: 'capture-cycle-1',
    step: 2,
    triggerSource: 'user' as const,
    graph: 'environment',
    requestedBy: 'environment-perception' as const,
  };
  const captureGoal = 'Can you take a picture? What can you see?';
  const satisfiedCaptureObservation: EnvironmentObservation = {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: new Date().toISOString(),
    capabilities: {
      actions: ['sendText', 'captureImage'],
      visual: true,
    },
    state: {
      body: {
        authenticated: true,
        robotId: 'robot-1',
        cameraReady: true,
      },
    },
    visual: {
      ...visual,
      metadata: { correlationId: captureCycle.cycleId },
    },
    visuals: [{
      ...visual,
      metadata: { correlationId: captureCycle.cycleId },
    }],
    feedback: [{
      id: 'capture-completed-1',
      timestamp: new Date().toISOString(),
      type: 'completed' as const,
      message: 'done',
      actionId: 'capture-action-1',
      data: { command: 'captureImage' },
    }],
    metadata: {
      correlationId: captureCycle.cycleId,
      actionId: 'capture-action-1',
      robotObserver: captureCycle,
      originatingInstruction: captureGoal,
    },
  };
  const parsedSatisfiedCapture = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I see a blue object and several lights.',
      actions: [],
      movementRequest: null,
      taskDecision: {
        objective: captureGoal,
        outcome: 'complete',
        reason: 'The fresh correlated image supplies the requested visual answer.',
        objectiveComplete: true,
        continuationPolicy: 'none',
        requiredCompletionBasis: 'response',
        actionPurpose: 'information_gain',
      },
    }),
    instruction: captureGoal,
    userInstruction: '',
    inputSource: 'user',
    observation: satisfiedCaptureObservation,
    sessionId: 'robot-1',
    routingAnalysis: { needsAction: true, actionType: 'environment_action' },
  }, {});
  assert.deepEqual(parsedSatisfiedCapture.actions, []);
  assert.equal(parsedSatisfiedCapture.response, 'I see a blue object and several lights.');

  const contextOutput = await environmentContextBuilderNode.execute({
    observation: {
      environmentId: 'test',
      adapter: 'test-adapter',
      sessionId: 'robot-1',
      timestamp: new Date().toISOString(),
      capabilities: {
        actions: ['robotCommand'],
        robotCommands: ['stand', 'wave', 'dance'],
        visual: true,
      },
      visual,
    },
    instruction: 'Find the object in front of the robot.',
    images: imageOutput.images,
    routingAnalysis: {
      needsResponse: false,
      needsConversationHistory: false,
      needsMemory: false,
      needsRobotStatus: false,
      needsEnvironment: true,
      needsVision: false,
      needsAction: true,
    },
  }, {}, { systemPrompt: 'Use the current instruction, observation, and advertised capabilities.' });
  const content = contextOutput.messages.at(-1)?.content;
  assert.equal(typeof content, 'string');
  assert.deepEqual(contextOutput.images, []);
  assert.doesNotMatch(String(content), /Visual frame/);
  const selectorEnvelope = JSON.parse(String(content)) as {
    currentInstruction: string;
    currentEnvironment: {
      capabilities: { actions: string[]; robotCommands: string[] };
      visualFrames: unknown[];
    };
  };
  assert.equal(selectorEnvelope.currentInstruction, 'Find the object in front of the robot.');
  assert.deepEqual(selectorEnvelope.currentEnvironment.capabilities.actions, ['robotCommand']);
  assert.deepEqual(selectorEnvelope.currentEnvironment.capabilities.robotCommands, ['stand', 'wave', 'dance']);
  assert.deepEqual(selectorEnvelope.currentEnvironment.visualFrames, []);
  const selectorSystemPrompt = String(contextOutput.messages[0]?.content);
  assert.equal(
    selectorSystemPrompt,
    'Use the current instruction, observation, and advertised capabilities.',
  );

  const correlatedImageContext = await environmentContextBuilderNode.execute({
    observation: {
      environmentId: 'test',
      adapter: 'test-adapter',
      sessionId: 'robot-1',
      timestamp: new Date().toISOString(),
      capabilities: { actions: ['captureImage'], visual: true },
      visual: { ...visual, metadata: { correlationId: 'capture-1' } },
      metadata: { correlationId: 'capture-1' },
    },
    instruction: 'Take another picture and explain the colors across the whole scene.',
    userInstruction: 'Take another picture and explain the colors across the whole scene.',
    observationCurrent: true,
    images: imageOutput.images,
    routingAnalysis: {
      needsResponse: true,
      needsConversationHistory: false,
      needsMemory: false,
      needsRobotStatus: false,
      needsEnvironment: true,
      needsVision: true,
      needsAction: true,
    },
  }, {}, {});
  assert.equal(Array.isArray(correlatedImageContext.messages.at(-1)?.content), true);
  assert.equal(correlatedImageContext.images.length, 1);
  assert.match(
    String(correlatedImageContext.message),
    /Take another picture and explain the colors across the whole scene/,
  );
  assert.doesNotMatch(String(correlatedImageContext.message), /Describe what the robot sees/);

  const generalQuestionContext = await environmentContextBuilderNode.execute({
    observation: {
      environmentId: 'test',
      adapter: 'test-adapter',
      sessionId: 'robot-1',
      timestamp: new Date().toISOString(),
      capabilities: { actions: ['robotCommand'], visual: true },
      visual: { ...visual, metadata: { correlationId: 'unrelated-visual-1' } },
      metadata: { correlationId: 'unrelated-visual-1' },
    },
    instruction: 'What is happening in France?',
    images: imageOutput.images,
    routingAnalysis: {
      needsResponse: true,
      needsConversationHistory: false,
      needsMemory: false,
      needsRobotStatus: false,
      needsEnvironment: false,
      needsVision: false,
      needsAction: false,
    },
  }, {}, {});
  assert.equal(typeof generalQuestionContext.messages.at(-1)?.content, 'string');
  assert.deepEqual(generalQuestionContext.images, []);
  assert.doesNotMatch(String(generalQuestionContext.message), /Visual frame/);

  console.log('Environment bridge coordinator checks passed');
} finally {
  manager.importState(originalWork);
  if (stateExisted && originalState) fs.writeFileSync(statePath, originalState);
  else if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  if (originalToken === undefined) delete process.env.MH_ENVIRONMENT_BRIDGE_TOKEN;
  else process.env.MH_ENVIRONMENT_BRIDGE_TOKEN = originalToken;
}
