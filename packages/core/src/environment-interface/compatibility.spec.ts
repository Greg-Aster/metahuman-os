import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  dispatchEnvironmentActions,
  enqueueConnectedEnvironmentStops,
  enqueueEnvironmentAction,
  getEnvironmentBridgeStatePath,
  publishEnvironmentObservation,
  readEnvironmentBridgeState,
  recordEnvironmentActionResult,
  writeEnvironmentBridgeState,
} from './index.js';
import { getQueueManager } from '../queue/index.js';
import {
  handleEnvironmentBridgeActionResult,
  handleEnvironmentBridgeObservation,
  handleEnvironmentBridgeStream,
} from '../api/handlers/environment-bridge.js';
import type { UnifiedRequest } from '../api/types.js';
import { parseDirectRobotInstruction, parseEnvironmentModelOutput } from '../nodes/environment/helpers.js';
import { environmentContextBuilderNode } from '../nodes/environment/context-builder.node.js';
import { environmentImageInputNode } from '../nodes/environment/image-input.node.js';
import { environmentSendActionNode } from '../nodes/environment/send-action.node.js';

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
  const stale = enqueueEnvironmentAction({
    type: 'robotCommand',
    command: 'walk',
    sessionId: 'robot-1',
    createdAt: '2000-01-01T00:00:00Z',
  });
  assert.deepEqual(dispatchEnvironmentActions('robot-1'), []);
  assert.equal(manager.getTask(stale.id)?.state, 'expired');

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
  });
  assert.equal(manager.getNextExecutable()?.id, prioritizedObservation.workId, 'environment observations must preempt autonomy');
  assert.notEqual(prioritizedObservation.workId, autonomyWork.id);

  resetState();
  const lifecycle = enqueueEnvironmentAction({ type: 'robotCommand', command: 'stand', sessionId: 'robot-1' });
  assert.equal(dispatchEnvironmentActions('robot-1')[0]?.id, lifecycle.id);
  const accepted = recordEnvironmentActionResult({
    id: 'accepted-1',
    timestamp: new Date().toISOString(),
    type: 'accepted',
    message: 'accepted',
    actionId: lifecycle.id,
  });
  assert.equal(accepted?.status, 'accepted');
  assert.equal(manager.getTask(lifecycle.id)?.state, 'completed');
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
  });
  assert.equal(
    readEnvironmentBridgeState().feedback.filter(item => item.id === 'accepted-1').length,
    1,
  );

  const cancellable = enqueueEnvironmentAction({ type: 'robotCommand', command: 'stand', sessionId: 'robot-1' });
  assert.equal(dispatchEnvironmentActions('robot-1')[0]?.id, cancellable.id);
  const cancelled = recordEnvironmentActionResult({
    id: 'cancelled-1',
    timestamp: new Date().toISOString(),
    type: 'cancelled',
    message: 'cancelled',
    actionId: cancellable.id,
  });
  assert.equal(cancelled?.status, 'cancelled');
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
  const observationTimestamp = new Date().toISOString();
  const observationResponse = await handleEnvironmentBridgeObservation(bridgeRequest({
    Authorization: 'Bearer bridge-secret',
    'X-MetaHuman-Environment-User': 'greggles',
    'X-MetaHuman-Environment-Graph': 'environment',
  }, {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: observationTimestamp,
    capabilities: { actions: ['robotCommand'] },
  }));
  assert.equal(observationResponse.status, 200);
  assert.equal(observationResponse.data.graphQueued, true);
  const observationWorkId = observationResponse.data.workId as string;
  const observationWork = manager.getTask(observationWorkId);
  assert.equal(observationWork?.type, 'environment_observation');
  assert.equal(observationWork?.handler, 'environment.observation');
  assert.equal(observationWork?.resource, 'local-llm');
  assert.equal(observationWork?.username, 'greggles');
  assert.equal(observationWork?.input.graph, 'environment');
  assert.equal(observationWork?.input.observation.sessionId, 'robot-1');

  const structured = parseEnvironmentModelOutput(JSON.stringify({
    response: 'Walking forward.',
    actions: [{ type: 'robotCommand', command: 'walk', simulatorCommand: 'run walk', units: 3 }],
  }), 'robot-1');
  assert.equal(structured.response, 'Walking forward.');
  assert.equal(structured.actions.length, 1);
  assert.equal(structured.actions[0]?.type, 'robotCommand');
  assert.equal(structured.actions[0]?.sessionId, 'robot-1');
  assert.equal(structured.actions[0]?.command, 'walk');
  assert.equal(structured.actions[0]?.units, 3);
  assert.equal('simulatorCommand' in (structured.actions[0] ?? {}), false);
  assert.deepEqual(parseEnvironmentModelOutput('walk forward', 'robot-1').actions, []);
  assert.deepEqual(parseDirectRobotInstruction('please walk forward', 'robot-1'), {
    action: { type: 'robotCommand', command: 'walk', units: undefined, sessionId: 'robot-1' },
    response: 'Walking forward.',
  });
  assert.equal(parseDirectRobotInstruction("don't walk forward", 'robot-1'), null);
  assert.equal(parseDirectRobotInstruction('can you walk forward?', 'robot-1'), null);
  assert.equal(parseDirectRobotInstruction('walk forward 25 steps', 'robot-1')?.action.units, 10);
  assert.deepEqual(
    parseDirectRobotInstruction('Please wave', 'robot-1', ['stand', 'wave', 'dance']),
    {
      action: { type: 'robotCommand', command: 'wave', sessionId: 'robot-1' },
      response: 'I will wave.',
    },
  );
  assert.equal(parseDirectRobotInstruction('Please swim', 'robot-1', ['wave']), null);

  const conversationOnly = await environmentSendActionNode.execute({
    actions: [],
    response: 'Hello from Environment Mode.',
    sessionId: 'robot-1',
  }, { username: 'bridge-spec', sessionId: 'chat-1' } as never, {});
  assert.equal(conversationOnly.status, 'no_actions');
  assert.equal(conversationOnly.response, 'Hello from Environment Mode.');

  const unavailableAction = await environmentSendActionNode.execute({
    actions: [{ type: 'robotCommand', command: 'walk', sessionId: 'robot-1' }],
    response: 'Walking.',
    sessionId: 'robot-1',
  }, { username: 'bridge-spec', sessionId: 'chat-1' } as never, {});
  assert.equal(unavailableAction.status, 'waiting_for_adapter');
  assert.match(String(unavailableAction.response), /no robot adapter is connected/i);

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
  const imageOutput = await environmentImageInputNode.execute({ visual }, {});
  assert.deepEqual(imageOutput.images, [
    { type: 'image_url', image_url: { url: visual.dataUrl } },
  ]);
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
  const content = contextOutput.messages[0]?.content;
  assert.equal(Array.isArray(content), true);
  assert.deepEqual(content.at(-1), {
    type: 'image_url',
    image_url: { url: visual.dataUrl },
  });
  assert.match(String(content[0]?.text), /Supported robot commands: stand, wave, dance/);

  const generalQuestionContext = await environmentContextBuilderNode.execute({
    observation: {
      environmentId: 'test',
      adapter: 'test-adapter',
      sessionId: 'robot-1',
      timestamp: new Date().toISOString(),
      capabilities: { actions: ['robotCommand'], visual: true },
      visual,
    },
    instruction: 'What is happening in France?',
    images: imageOutput.images,
  }, {}, {});
  assert.equal(typeof generalQuestionContext.messages[0]?.content, 'string');
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
