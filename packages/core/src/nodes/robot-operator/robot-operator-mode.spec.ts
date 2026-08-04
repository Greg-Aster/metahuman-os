import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ROOT } from '../../path-builder.js';
import { robotOperatorContextBuilderNode } from './context-builder.node.js';
import { robotOperatorDecisionParserNode } from './decision-parser.node.js';
import { robotOperatorEnvironmentDispatchNode } from './environment-dispatch.node.js';

function robotObservation() {
  return {
    environmentId: 'ainekio',
    adapter: 'ainekio-gateway',
    sessionId: 'robot-1',
    timestamp: '2026-08-03T12:00:00.000Z',
    capabilities: {
      actions: ['captureImage', 'robotCommand', 'sendText'],
      robotCommands: ['walk', 'wave', 'stop'],
      visual: true,
      movement: true,
    },
    state: { body: { authenticated: true, cameraReady: true } },
    visual: {
      id: 'camera-1',
      timestamp: '2026-08-03T12:00:00.000Z',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      metadata: { correlationId: 'cycle-1' },
    },
    visuals: [],
    feedback: [{
      id: 'capture-completed',
      timestamp: '2026-08-03T12:00:00.000Z',
      type: 'completed' as const,
      message: 'image captured',
      actionId: 'capture-1',
    }],
    metadata: {
      correlationId: 'cycle-1',
      robotObserver: {
        cycleId: 'cycle-1',
        step: 1,
        maxSteps: 8,
        triggerSource: 'autonomy' as const,
        graph: 'robot-operator',
        requestedBy: 'robot-observer' as const,
      },
    },
  };
}

test('Robot Operator context combines configured prompt, persona, history, and only the correlated image', async () => {
  const observation = robotObservation();
  const result = await robotOperatorContextBuilderNode.execute({
    observation,
    conversationHistory: [
      { role: 'user', content: 'Please keep an eye on the room.' },
      { role: 'assistant', content: 'I will stay observant.' },
    ],
    personaText: '## Personality Traits\n- curious: high\n- pragmatic: medium',
    images: [{ type: 'image_url', image_url: { url: observation.visual.dataUrl } }],
    frames: [observation.visual],
  }, {}, {
    systemPrompt: 'Decide one high-level intention and return configured JSON.',
    historyLimit: 12,
  });

  assert.equal(result.valid, true);
  assert.equal(result.context.imageCount, 1);
  assert.equal(result.context.historyCount, 2);
  assert.match(String(result.messages[0]?.content), /high-level intention/);
  assert.match(String(result.messages[0]?.content), /curious: high/);
  const userContent = result.messages[1]?.content as Array<{ type: string; text?: string }>;
  assert.equal(Array.isArray(userContent), true);
  assert.equal(userContent.length, 2);
  assert.match(String(userContent[0]?.text), /Please keep an eye on the room/);
  assert.doesNotMatch(String(userContent[0]?.text), /data:image\/jpeg;base64/);

  const stale = await robotOperatorContextBuilderNode.execute({
    observation,
    images: [{ type: 'image_url', image_url: { url: observation.visual.dataUrl } }],
    frames: [{ ...observation.visual, metadata: { correlationId: 'old-cycle' } }],
  }, {}, { systemPrompt: 'Return configured JSON.', historyLimit: 12 });
  assert.equal(stale.context.imageCount, 0);
  assert.equal(typeof stale.messages[1]?.content, 'string');
});

test('Robot Operator parser accepts only explicit environment or wait decisions', async () => {
  const delegated = await robotOperatorDecisionParserNode.execute({
    response: '<think>private reasoning</think>{"route":"environment","instruction":"I see a red ball and want to investigate it.","reason":"The object is new and fits my curious personality."}',
  }, {});
  assert.equal(delegated.valid, true);
  assert.equal(delegated.route, 'environment');
  assert.equal(delegated.instruction, 'I see a red ball and want to investigate it.');
  assert.doesNotMatch(JSON.stringify(delegated.decision), /private reasoning/);

  const waiting = await robotOperatorDecisionParserNode.execute({
    response: '{"route":"wait","instruction":"","reason":"Nothing warrants a response."}',
  }, {});
  assert.equal(waiting.valid, true);
  assert.equal(waiting.route, 'wait');
  assert.equal(waiting.instruction, '');

  const command = await robotOperatorDecisionParserNode.execute({
    response: '{"route":"robotCommand","instruction":"walk","reason":"move"}',
  }, {});
  assert.equal(command.valid, false);
  assert.equal(command.route, 'wait');
});

test('Robot Operator dispatch carries one intention and the same image into Environment Mode', async () => {
  const queued: any[] = [];
  const observation = robotObservation();
  const result = await robotOperatorEnvironmentDispatchNode.execute({
    decision: {
      route: 'environment',
      instruction: 'I see a red ball and want to investigate it.',
      reason: 'The object is interesting and relevant to my current persona.',
    },
    observation,
  }, {
    username: 'owner',
    operatorMode: 'semi',
    robotOperatorEnvironmentGraph: 'environment',
    enqueueRobotOperatorEnvironment: async (input: unknown) => {
      queued.push(input);
      return { id: 'environment-task-1' };
    },
  }, { graph: 'environment', maxSteps: 8 });

  assert.equal(result.queued, true);
  assert.equal(result.taskId, 'environment-task-1');
  assert.equal(queued.length, 1);
  assert.equal(queued[0].input.graph, 'environment');
  assert.equal(
    queued[0].input.observation.metadata.originatingInstruction,
    'I see a red ball and want to investigate it.',
  );
  assert.equal(queued[0].input.observation.visual.id, observation.visual.id);
  assert.equal(queued[0].input.observation.metadata.robotObserver.graph, 'environment');
  assert.equal(queued[0].input.observation.metadata.robotObserver.requestedBy, 'environment-perception');
  assert.deepEqual(queued[0].input.observation.text, []);
  assert.deepEqual(queued[0].input.observation.feedback, []);

  const wait = await robotOperatorEnvironmentDispatchNode.execute({
    decision: { route: 'wait', instruction: '', reason: 'No response is useful.' },
    observation,
  }, {
    username: 'owner',
    operatorMode: 'semi',
    enqueueRobotOperatorEnvironment: async (input: unknown) => {
      queued.push(input);
      return { id: 'unexpected' };
    },
  }, { graph: 'environment', maxSteps: 8 });
  assert.equal(wait.queued, false);
  assert.equal(wait.status, 'wait');
  assert.equal(queued.length, 1);
});

test('Robot Operator dispatch does not reapply trigger mode after the graph decides to delegate', async () => {
  let queued = false;
  const result = await robotOperatorEnvironmentDispatchNode.execute({
    decision: {
      route: 'environment',
      instruction: 'I want to investigate the room.',
      reason: 'A current observation looks interesting.',
    },
    observation: robotObservation(),
  }, {
    username: 'owner',
    operatorMode: 'reactive',
    enqueueRobotOperatorEnvironment: async () => {
      queued = true;
      return { id: 'environment-task' };
    },
  }, { graph: 'environment', maxSteps: 8 });
  assert.equal(result.queued, true);
  assert.equal(result.status, 'queued');
  assert.equal(result.taskId, 'environment-task');
  assert.equal(queued, true);
});

test('Robot Operator graph records one bounded inner intention before Environment dispatch', () => {
  const graph = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'etc/cognitive-graphs/robot-operator-mode.json'),
    'utf8',
  ));
  const nodeTypes = new Set(graph.nodes.map((node: any) => node.data?.nodeType));
  for (const forbidden of [
    'environment_action_parser',
    'environment_task_validator',
    'movement_generator',
    'environment_send_action',
    'tts',
    'conversation_buffer',
    'robot_buffer',
    'memory_capture',
  ]) {
    assert.equal(nodeTypes.has(forbidden), false, `Robot Operator Mode must not contain ${forbidden}`);
  }
  assert.equal(nodeTypes.has('robot_operator_context_builder'), true);
  assert.equal(nodeTypes.has('robot_operator_decision_parser'), true);
  assert.equal(nodeTypes.has('robot_operator_environment_dispatch'), true);
  const innerNodes = graph.nodes.filter((node: any) => node.data?.nodeType === 'inner_dialogue_buffer');
  assert.equal(innerNodes.length, 1);
  assert.equal(innerNodes[0]?.data?.properties?.captureMemory, false);
  assert.equal(innerNodes[0]?.data?.properties?.role, 'reflection');
  assert.equal(innerNodes[0]?.data?.properties?.dialogueSource, 'robot-operator-mode');
  const intentionEdge = graph.edges.find((edge: any) => (
    edge.source === 'decision-parser'
    && edge.sourceHandle === 'instruction'
    && edge.target === 'intention-inner-dialogue'
    && edge.targetHandle === 'text'
  ));
  assert.ok(intentionEdge, 'clean authored intention must enter the canonical Inner Dialogue Buffer');
  const dispatchEdge = graph.edges.find((edge: any) => (
    edge.source === 'intention-inner-dialogue'
    && edge.sourceHandle === 'passthrough'
    && edge.target === 'environment-dispatch'
    && edge.targetHandle === 'decision'
  ));
  assert.ok(dispatchEdge, 'Environment dispatch must follow Inner Dialogue admission');
  assert.equal(graph.edges.some((edge: any) => (
    edge.source === 'decision-parser'
    && edge.target === 'environment-dispatch'
  )), false, 'decision parser must not bypass the Inner Dialogue checkpoint');
  const prompt = graph.nodes.find((node: any) => node.data?.nodeType === 'robot_operator_context_builder')
    ?.data?.properties?.systemPrompt;
  assert.match(String(prompt), /decide WHAT/i);
  assert.match(String(prompt), /Environment Mode decides HOW/i);
  assert.match(String(prompt), /outstanding, unexecuted objective/i);
  assert.match(String(prompt), /I want to, I intend to, or I would like to/i);
  assert.match(String(prompt), /Do not use I will for a physical action/i);
  assert.match(String(prompt), /Never state or imply that an action is already happening or has completed/i);
  assert.match(String(prompt), /not itself a spoken response/i);

  const services = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc/services.json'), 'utf8'));
  assert.equal(services.services['robot-operator'].graph, 'robot-operator');
  assert.equal(services.services['robot-operator'].environmentGraph, 'environment');

  const observer = fs.readFileSync(path.join(ROOT, 'packages/core/src/queue/robot-observer-handler.ts'), 'utf8');
  const boredom = fs.readFileSync(path.join(ROOT, 'packages/core/src/queue/boredom-movement-handler.ts'), 'utf8');
  const executionEngine = fs.readFileSync(path.join(ROOT, 'packages/core/src/queue/execution-engine.ts'), 'utf8');
  assert.doesNotMatch(observer, /callLLM|model-router/);
  assert.doesNotMatch(boredom, /callLLM|model-router/);
  assert.doesNotMatch(boredom, /chooseBoredomMovementCommand/);
  assert.match(executionEngine, /robotObserver\?\.graph \|\| task\.input\.graph/);
  assert.match(executionEngine, /robotOperatorEnvironmentGraph/);
});
