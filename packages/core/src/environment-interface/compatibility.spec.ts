import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  attachEnvironmentActionContext,
  dispatchEnvironmentActions,
  enqueueConnectedEnvironmentStops,
  enqueueEnvironmentAction,
  getEnvironmentBridgeStatePath,
  publishEnvironmentObservation,
  readEnvironmentBridgeState,
  recordEnvironmentActionResult,
  recordEnvironmentObservation,
  recordEnvironmentRobotStatus,
  subscribeEnvironmentActions,
  writeEnvironmentBridgeState,
} from './index.js';
import { getQueueManager } from '../queue/index.js';
import {
  environmentObservationNeedsCognition,
  environmentObservationStartsUserTurn,
  handleEnvironmentBridgeActionResult,
  handleEnvironmentBridgeObservation,
  handleEnvironmentBridgeStream,
} from '../api/handlers/environment-bridge.js';
import type { UnifiedRequest } from '../api/types.js';
import { parseEnvironmentModelOutput } from '../nodes/environment/helpers.js';
import { environmentActionParserNode } from '../nodes/environment/action-parser.node.js';
import { environmentContextBuilderNode } from '../nodes/environment/context-builder.node.js';
import { environmentImageInputNode } from '../nodes/environment/image-input.node.js';
import { environmentInstructionInterpreterNode } from '../nodes/environment/instruction-interpreter.node.js';
import { environmentSendActionNode } from '../nodes/environment/send-action.node.js';
import type { EnvironmentObservation } from './types.js';

const statePath = getEnvironmentBridgeStatePath();
const stateExisted = fs.existsSync(statePath);
const originalState = stateExisted ? fs.readFileSync(statePath) : undefined;
const originalToken = process.env.MH_ENVIRONMENT_BRIDGE_TOKEN;
const manager = getQueueManager();
const originalWork = manager.exportState();

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
  assert.equal(manager.getTask(stale.id)?.state, 'expired');

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
  assert.equal(manager.getTask(movement.id)?.state, 'cancelled');

  resetState();
  const emergencyMovement = enqueueEnvironmentAction({ type: 'robotCommand', command: 'walk', sessionId: 'robot-1' });
  const emergencyStops = enqueueConnectedEnvironmentStops('greggles', 'spec emergency stop', Date.parse('2026-07-14T12:00:00Z'));
  assert.equal(emergencyStops.length, 1);
  assert.equal(emergencyStops[0]?.type, 'stop');
  assert.equal(manager.getTask(emergencyStops[0]!.id)?.priority, 'critical');
  assert.equal(manager.getTask(emergencyMovement.id)?.state, 'cancelled');

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
  assert.equal(manager.getTask(claimedCommand!.id)?.state, 'leased');
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
  assert.equal(manager.getTask(robotOneCommand.id)?.state, 'queued', 'a session must not claim another session\'s work');

  resetState();
  const autonomyWork = manager.enqueue({
    type: 'operator_policy',
    handler: 'operator.policy',
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
  assert.equal(manager.getTask(lifecycle.id)?.state, 'leased');
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
  assert.equal(manager.getTask(cancellable.id)?.state, 'cancelled');

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
  const contextualResult = attachEnvironmentActionContext({
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
    },
  });
  assert.equal(
    contextualResult.metadata?.originatingInstruction,
    'Wave, then use the returned view to tell me what changed.',
    'action context must be recovered from MetaHuman work rather than trusted from the adapter',
  );
  const contextualTiming = contextualResult.metadata?.actionTiming as Record<string, unknown>;
  assert.equal(contextualTiming.queueEnteredAt, resultAction.createdAt);
  assert.equal(contextualTiming.leaseGrantedAt, manager.getTask(resultAction.id)?.startedAt);
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
        maxSteps: 4,
        triggerSource: 'user',
        graph: 'robot-operator',
        requestedBy: 'robot-observer',
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
  const contextualExpiry = attachEnvironmentActionContext(expiredCaptureObservation);
  assert.equal(contextualExpiry.metadata?.correlationId, 'observer-capture-cycle');
  assert.equal(
    (contextualExpiry.metadata?.robotObserver as { requestedBy?: string })?.requestedBy,
    'robot-observer',
  );
  assert.equal(environmentObservationNeedsCognition(contextualExpiry), false);
  const expiredCaptureResponse = await handleEnvironmentBridgeObservation(bridgeRequest({
    Authorization: 'Bearer bridge-secret',
  }, expiredCaptureObservation as unknown as Record<string, unknown>), () => 'robot-owner');
  assert.equal(expiredCaptureResponse.status, 200);
  assert.equal(expiredCaptureResponse.data.graphQueued, false);
  assert.equal(expiredCaptureResponse.data.reason, 'state_only_observation');
  assert.equal(
    manager.getAllTasks().filter(task => task.type === 'environment_observation').length,
    0,
    'an initial Robot Observer capture failure must remain lifecycle telemetry instead of becoming a chat prompt',
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
      source: 'environment',
      text: 'Please stop and listen to this instead.',
      timestamp: new Date().toISOString(),
      channel: 'microphone',
    }],
  }), true, 'robot microphone transcripts must start a new interrupting user turn');
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

  const structured = parseEnvironmentModelOutput(JSON.stringify({
    response: 'Walking forward.',
    actions: [{ type: 'robotCommand', command: 'walk', simulatorCommand: 'run walk', units: 3 }],
    taskDecision: {
      outcome: 'act',
      reason: 'Walk once.',
      objectiveComplete: false,
      continuationPolicy: 'bounded',
      requiredCompletionBasis: 'action_result',
      motionClass: 'open_loop_displacement',
    },
  }), 'robot-1');
  assert.equal(structured.response, 'Walking forward.');
  assert.equal(structured.actions.length, 1);
  assert.equal(structured.actions[0]?.type, 'robotCommand');
  assert.equal(structured.actions[0]?.sessionId, 'robot-1');
  assert.equal(structured.actions[0]?.command, 'walk');
  assert.equal(structured.actions[0]?.units, 3);
  assert.equal('simulatorCommand' in (structured.actions[0] ?? {}), false);
  assert.equal(structured.taskDecision?.motionClass, 'open_loop_displacement');
  assert.deepEqual(parseEnvironmentModelOutput('walk forward', 'robot-1').actions, []);

  const conversationOnly = await environmentSendActionNode.execute({
    actions: [],
    response: 'Hello from Environment Mode.',
    sessionId: 'robot-1',
  }, { username: 'bridge-spec', sessionId: 'chat-1' } as never, {});
  assert.equal(conversationOnly.status, 'no_actions');
  assert.equal(conversationOnly.response, 'Hello from Environment Mode.');
  assert.equal(conversationOnly.bridgeRecord.status, 'no_actions');
  assert.equal(conversationOnly.bridgeRecord.commandCount, 0);
  assert.deepEqual(conversationOnly.bridgeRecord.requestedActions, []);
  assert.equal(conversationOnly.bridgeRecord.correlationId, 'chat-1');

  const emptyConversation = await environmentSendActionNode.execute({
    actions: [],
    response: '',
    sessionId: 'robot-1',
  }, { username: 'bridge-spec', sessionId: 'chat-empty' } as never, {});
  assert.equal(emptyConversation.status, 'no_actions');
  assert.match(emptyConversation.response, /no environment action was produced/i);

  const unavailableAction = await environmentSendActionNode.execute({
    actions: [{ type: 'robotCommand', command: 'walk', sessionId: 'robot-1' }],
    response: 'Walking.',
    sessionId: 'robot-1',
  }, { username: 'bridge-spec', sessionId: 'chat-1' } as never, {});
  assert.equal(unavailableAction.status, 'waiting_for_adapter');
  assert.match(String(unavailableAction.response), /no robot adapter is connected/i);
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
  const bodyOffline = await environmentSendActionNode.execute({
    actions: [{ type: 'robotCommand', command: 'walk', sessionId: 'robot-1' }],
    response: 'Walking.',
    sessionId: 'robot-1',
  }, { username: 'bridge-spec', sessionId: 'chat-offline' } as never, {});
  unsubscribeOffline();
  assert.equal(bodyOffline.status, 'rejected');
  assert.equal(bodyOffline.reason, 'robot_body_offline');
  assert.equal(bodyOffline.count, 0);
  assert.equal(bodyOffline.adapterReady, true);
  assert.equal(bodyOffline.bodyAuthenticated, false);
  assert.doesNotMatch(String(bodyOffline.response), /^Walking\.?$/i);

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
  const bodyQueued = await environmentSendActionNode.execute({
    actions: [{ type: 'robotCommand', command: 'walk', sessionId: 'robot-1' }],
    response: 'Walking.',
    sessionId: 'robot-1',
  }, {
    username: 'bridge-spec',
    sessionId: 'chat-online',
    userMessage: 'Walk once, then use the returned observation to tell me what changed.',
  } as never, {});
  unsubscribeOnline();
  assert.equal(bodyQueued.status, 'coordinated_for_adapter');
  assert.equal(bodyQueued.count, 1);
  assert.equal(bodyQueued.ready, true);
  assert.equal(bodyQueued.response, 'Walking.');
  const queuedBodyCommand = bodyQueued.commands[0];
  assert.ok(queuedBodyCommand);
  const queuedCycle = queuedBodyCommand.metadata?.robotObserver as
    | { requestedBy?: string; graph?: string }
    | undefined;
  assert.equal(
    queuedCycle?.requestedBy,
    'environment-perception',
    'a user-originated asynchronous action must reuse the bounded perception cycle',
  );
  assert.equal(
    queuedCycle?.graph,
    'environment',
    'user-owned action feedback must return to Environment Mode instead of creating a Robot Operator intention',
  );
  assert.equal(
    manager.getTask(queuedBodyCommand.id)?.metadata?.originatingInstruction,
    'Walk once, then use the returned observation to tell me what changed.',
  );

  const feedbackInstruction = await environmentInstructionInterpreterNode.execute({
    observation: {
      environmentId: 'ainekio',
      adapter: 'ainekio-gateway',
      sessionId: 'robot-1',
      timestamp: new Date().toISOString(),
      capabilities: { actions: ['sendText'] },
      feedback: [{
        id: 'rejected-result-1',
        timestamp: new Date().toISOString(),
        type: 'rejected',
        message: 'requested robot is not connected',
        actionId: 'walk-1',
      }],
    },
  }, { userMessage: '' });
  assert.match(String(feedbackInstruction.instruction), /Robot action rejected/);
  assert.match(String(feedbackInstruction.instruction), /do not issue a new action/);

  const contextualInstruction = await environmentInstructionInterpreterNode.execute({
    observation: contextualResult,
  }, { userMessage: '' });
  assert.equal(
    contextualInstruction.instruction,
    [
      'Robot action completed: done. This terminal result is evidence for validation only; do not issue a new action from this event.',
      'Original user objective (still authoritative for completion validation; do not directly re-execute it in this pass): Wave, then use the returned view to tell me what changed.',
    ].join('\n'),
  );
  assert.match(
    String((contextualInstruction.text as Array<{ text?: string }>)[0]?.text),
    /Robot action completed/,
  );

  const continuationInstruction = await environmentInstructionInterpreterNode.execute({
    observation: {
      environmentId: 'ainekio',
      adapter: 'ainekio-gateway',
      sessionId: 'robot-1',
      timestamp: new Date().toISOString(),
      capabilities: { actions: ['robotCommand'] },
      feedback: [{
        id: 'completed-result-1',
        timestamp: new Date().toISOString(),
        type: 'completed',
        message: 'done',
        actionId: 'walk-1',
        data: { command: 'walk' },
      }],
      metadata: {
        robotObserver: {
          cycleId: 'utterance-1',
          step: 2,
          maxSteps: 3,
          triggerSource: 'user',
          graph: 'environment',
          requestedBy: 'environment-perception',
        },
      },
    },
  }, { userMessage: '' });
  assert.match(String(continuationInstruction.instruction), /evidence for validation only/);
  assert.match(String(continuationInstruction.instruction), /do not issue a new action/);

  const parsedTerminalFeedback = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'The wave completed, and the post-action image has returned.',
      actions: [{ type: 'robotCommand', command: 'wave' }],
      movementRequest: { description: 'wave again' },
    }),
    instruction: continuationInstruction.instruction,
    observation: continuationInstruction.observation,
    sessionId: 'robot-1',
    routingAnalysis: { needsAction: true, actionType: 'robot_movement' },
  }, {});
  assert.deepEqual(parsedTerminalFeedback.actions, []);
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
  const queuedContinuation = await environmentSendActionNode.execute({
    actions: [{ type: 'robotCommand', command: 'walk', sessionId: 'robot-1' }],
    response: 'Continuing the remaining task.',
    sessionId: 'robot-1',
  }, {
    username: 'bridge-spec',
    sessionId: 'chat-continuation',
    userMessage: '',
    robotObserver: {
      cycleId: 'continuation-cycle-1',
      step: 1,
      maxSteps: 3,
      triggerSource: 'user',
      graph: 'environment',
      requestedBy: 'environment-perception',
    },
  } as never, {});
  unsubscribeContinuation();
  assert.equal(queuedContinuation.status, 'coordinated_for_adapter');
  assert.equal(queuedContinuation.count, 1);
  assert.equal(queuedContinuation.response, 'Continuing the remaining task.');

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
    maxSteps: 3,
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
  const satisfiedCaptureInstruction = await environmentInstructionInterpreterNode.execute({
    observation: satisfiedCaptureObservation,
  }, { userMessage: '' });
  assert.match(String(satisfiedCaptureInstruction.instruction), /fresh correlated robot image has returned/i);
  assert.match(String(satisfiedCaptureInstruction.instruction), /do not request another image/i);
  assert.match(
    String(satisfiedCaptureInstruction.instruction),
    /Original user goal: Can you take a picture/,
  );
  assert.doesNotMatch(
    String(satisfiedCaptureInstruction.instruction),
    /^Can you take a picture\? What can you see\?$/,
  );
  const normalizedCaptureObservation = satisfiedCaptureInstruction.observation as {
    capabilities: { actions: string[] };
  };
  assert.equal(normalizedCaptureObservation.capabilities.actions.includes('captureImage'), false);

  const parsedSatisfiedCapture = await environmentActionParserNode.execute({
    response: JSON.stringify({
      response: 'I see a blue object and several lights.',
      actions: [],
      movementRequest: null,
    }),
    instruction: satisfiedCaptureInstruction.instruction,
    observation: satisfiedCaptureInstruction.observation,
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
  }, {}, {});
  const content = contextOutput.messages.at(-1)?.content;
  assert.equal(typeof content, 'string');
  assert.deepEqual(contextOutput.images, []);
  assert.doesNotMatch(String(content), /Visual frame/);
  assert.match(String(content), /Supported robot commands: stand, wave, dance/);
  assert.match(String(content), /never put a bare command string in actions/i);
  assert.match(String(content), /"type":"robotCommand"/);

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
    images: imageOutput.images,
    routingAnalysis: {
      needsMemory: false,
      needsEnvironment: true,
      needsVision: true,
      needsAction: false,
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
      needsMemory: false,
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
