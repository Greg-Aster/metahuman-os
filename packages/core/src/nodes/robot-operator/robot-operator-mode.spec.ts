import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ROOT } from '../../path-builder.js';
import { buildRobotOperatorInstruction } from '../../robot-operator.js';
import { ConversationHistoryNode } from '../context/conversation-history.node.js';
import { TextInputNode } from '../input/text-input.node.js';
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

test('configured Conversation Buffer history reads the canonical conversation context', async () => {
  const conversationHistory = [
    { role: 'user', content: 'The blue ball belongs beside the charging station.' },
    { role: 'assistant', content: 'I will remember where it belongs.' },
  ];
  const result = await ConversationHistoryNode.execute({}, {
    conversationHistory,
  }, { mode: 'conversation', limit: 20 });

  assert.equal(result.mode, 'conversation');
  assert.deepEqual(result.history, conversationHistory);
  assert.equal(result.loadedFromBuffer, false);
});

test('configured Inner Buffer history does not fall back to conversation context', async () => {
  const result = await ConversationHistoryNode.execute({}, {
    conversationHistory: [
      { role: 'user', content: 'Continue the previous push-up task.' },
    ],
  }, { mode: 'inner', limit: 3 });

  assert.equal(result.mode, 'inner');
  assert.deepEqual(result.history, []);
  assert.equal(result.loadedFromBuffer, false);
});

test('Robot Operator instruction input prefers the triggering agent runtime instruction', async () => {
  const runtimeInstruction = buildRobotOperatorInstruction('boredom-movement');
  const result = await TextInputNode.execute({}, {
    environmentTaskInstruction: runtimeInstruction,
    userMessage: 'unrelated user fallback',
  }, {
    message: 'editable graph fallback',
    inputKey: 'environmentTaskInstruction',
  });

  assert.equal(result.text, runtimeInstruction);
  assert.equal(result.hasTextInput, true);
});

test('Buffer History limit zero defers retention to the canonical buffer owner', async () => {
  const retained = Array.from({ length: 80 }, (_, index) => ({
    role: 'reflection',
    content: `Retained inner entry ${index + 1}`,
  }));
  const result = await ConversationHistoryNode.execute({}, {
    conversationHistory: retained,
  }, { mode: 'conversation', limit: 0 });

  assert.equal(result.count, 80);
  assert.equal(result.pruned, false);
});

test('Robot Operator context consolidates separate instructions, conversation, inner context, persona, trigger, and correlated image', async () => {
  const observation = robotObservation();
  const instruction = 'Decide one high-level intention and return configured JSON.';
  const result = await robotOperatorContextBuilderNode.execute({
    instruction,
    observation,
    conversationHistory: [
      {
        role: 'user',
        content: 'The blue ball belongs beside the charging station.',
        meta: {
          cognitiveMode: 'environment',
          taskLifecycle: {
            kind: 'environment_task_lifecycle',
            cycleId: 'ball-cycle',
            objective: 'Remember where the blue ball belongs.',
            outcome: 'complete',
          },
        },
      },
      {
        role: 'system',
        content: '[Inner thought - reflection]: I am curious about how the light in the room has changed.',
        meta: {
          isInnerDialogue: true,
          originalRole: 'reflection',
          dialogueSource: 'reflector',
          tags: ['idle-thought', 'self-reflection', 'inner'],
        },
      },
    ],
    personaText: '## Personality Traits\n- curious: high\n- pragmatic: medium',
    memoryContext: [{ content: 'A past afternoon walk inspired a playful stretch.', timestamp: '2026-07-01T12:00:00.000Z' }],
    images: [{ type: 'image_url', image_url: { url: observation.visual.dataUrl } }],
    frames: [observation.visual],
  }, {}, {});

  assert.equal(result.valid, true);
  assert.equal(result.context.imageCount, 1);
  assert.equal(result.context.recentContextCount, 2);
  assert.equal(result.context.innerContextCount, 1);
  assert.equal(result.context.personaIncluded, true);
  assert.equal(result.context.memoryContextCount, 1);
  assert.equal(result.messages[0]?.content, instruction);
  assert.doesNotMatch(String(result.messages[0]?.content), /curious: high|blue ball/i);
  assert.equal(result.messages[1]?.role, 'assistant');
  assert.match(String(result.messages[1]?.content), /canonical_conversation_history/);
  assert.match(String(result.messages[1]?.content), /curious: high/);
  assert.match(String(result.messages[1]?.content), /blue ball belongs/);
  assert.match(String(result.messages[1]?.content), /curious about how the light/);
  assert.match(String(result.messages[1]?.content), /historical_memory_inspiration/);
  assert.match(String(result.messages[1]?.content), /currentEvidence\":false/);
  assert.match(String(result.messages[1]?.content), /past afternoon walk/);
  const userContent = result.messages[2]?.content as Array<{ type: string; text?: string }>;
  assert.equal(Array.isArray(userContent), true);
  assert.equal(userContent.length, 2);
  assert.doesNotMatch(String(userContent[0]?.text), /curious about how the light/);
  assert.doesNotMatch(String(userContent[0]?.text), /blue ball belongs/i);
  assert.doesNotMatch(String(userContent[0]?.text), /data:image\/jpeg;base64/);
  assert.match(String(userContent[0]?.text), /"source":"autonomy"/);
  assert.match(String(userContent[0]?.text), /captureImage/);
  assert.match(String(userContent[0]?.text), /image captured/);

  const stale = await robotOperatorContextBuilderNode.execute({
    instruction,
    observation,
    images: [{ type: 'image_url', image_url: { url: observation.visual.dataUrl } }],
    frames: [{ ...observation.visual, metadata: { correlationId: 'old-cycle' } }],
  }, {}, {});
  assert.equal(stale.context.imageCount, 0);
  assert.equal(typeof stale.messages[1]?.content, 'string');

  const missingInstruction = await robotOperatorContextBuilderNode.execute({ observation }, {}, {});
  assert.equal(missingInstruction.valid, false);
  assert.match(missingInstruction.error, /connected text input node/i);
});

test('Robot Operator context preserves canonical combined history without adding a second retention policy', async () => {
  const observation = robotObservation();
  const result = await robotOperatorContextBuilderNode.execute({
    instruction: 'Return the configured observation decision JSON.',
    observation,
    conversationHistory: [
      {
        role: 'user',
        content: 'Please remember that I prefer quiet responses in the morning.',
      },
      {
        role: 'system',
        content: 'Oldest admitted observation.',
        meta: {
          isInnerDialogue: true,
          originalRole: 'reflection',
          tags: ['idle-thought', 'inner'],
        },
      },
      { role: 'assistant', content: 'I will keep morning responses quiet.' },
      { role: 'reflection', content: 'Legacy raw inner record must not enter.' },
      { role: 'reasoning', content: 'Private reasoning must not enter.', meta: { tags: ['idle-thought'] } },
    ],
  }, {}, {});

  assert.equal(result.valid, true);
  assert.equal(result.context.recentContextCount, 3);
  assert.equal(result.context.innerContextCount, 1);
  const stimulus = result.context.stimulus;
  assert.deepEqual(
    result.context.recentContext.map((entry: any) => entry.content),
    [
      'Please remember that I prefer quiet responses in the morning.',
      'Oldest admitted observation.',
      'I will keep morning responses quiet.',
    ],
  );
  assert.equal('recentIdleThoughts' in stimulus, false);
  assert.deepEqual(stimulus.capabilities, observation.capabilities);
  assert.equal(stimulus.feedback[0]?.message, 'image captured');
  assert.equal(stimulus.trigger.source, 'autonomy');
  assert.equal('source' in stimulus, false);
  assert.equal('currentObservationContract' in stimulus, false);
  const serialized = JSON.stringify(result.messages);
  assert.match(serialized, /prefer quiet responses/);
  assert.match(serialized, /Oldest admitted observation/);
  assert.match(serialized, /isInnerDialogue/);
  assert.doesNotMatch(serialized, /Legacy raw inner record/);
  assert.doesNotMatch(serialized, /Private reasoning/);
  assert.match(serialized, /captureImage|robotCommand|image captured/);
});

test('Robot Operator parser accepts only complete grounded observation decisions', async () => {
  const delegated = await robotOperatorDecisionParserNode.execute({
    response: '<think>private reasoning</think>{"observed":"A red ball is visible on the floor.","instruction":"I want to get a clearer view of the red ball.","requiresAction":true,"reason":"The current image contains an unfamiliar object worth inspecting."}',
  }, {});
  assert.equal(delegated.valid, true);
  assert.equal(delegated.observed, 'A red ball is visible on the floor.');
  assert.equal(delegated.instruction, 'I want to get a clearer view of the red ball.');
  assert.equal(delegated.requiresAction, true);
  assert.doesNotMatch(JSON.stringify(delegated.decision), /private reasoning/);

  const freeForm = await robotOperatorDecisionParserNode.execute({
    response: '{"category":"model-authored","observed":"The room is dark and still.","instruction":"I want to respond in the way that best fits this moment.","requiresAction":false,"reason":"The present view and my persona shape this intention."}',
  }, {});
  assert.equal(freeForm.valid, true);
  assert.deepEqual(Object.keys(freeForm.decision), ['observed', 'instruction', 'requiresAction', 'reason']);

  const legacyWait = await robotOperatorDecisionParserNode.execute({
    response: '{"route":"wait","instruction":"","reason":"Nothing warrants a response."}',
  }, {});
  assert.equal(legacyWait.valid, false);
  assert.equal(legacyWait.decision, null);

  const incomplete = await robotOperatorDecisionParserNode.execute({
    response: '{"observed":"A doorway is visible.","instruction":"I have chosen a next intention."}',
  }, {});
  assert.equal(incomplete.valid, false);
  assert.equal(incomplete.decision, null);

  const movementWithoutAction = await robotOperatorDecisionParserNode.execute({
    response: '{"observed":"A movement opportunity is available.","instruction":"I will remain still.","requiresAction":false,"reason":"Stillness feels appropriate."}',
  }, {}, { requireAction: true });
  assert.equal(movementWithoutAction.valid, false);
  assert.match(movementWithoutAction.error, /requires an Environment Mode action intention/i);
});

test('Robot Operator dispatches required work and stops observation-only decisions locally', async () => {
  const queued: any[] = [];
  const observation = robotObservation();
  const result = await robotOperatorEnvironmentDispatchNode.execute({
    decision: {
      observed: 'A red ball is visible on the floor.',
      instruction: 'I want to get a clearer view of the red ball.',
      requiresAction: true,
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
    'I want to get a clearer view of the red ball.',
  );
  assert.equal(queued[0].input.observation.visual.id, observation.visual.id);
  assert.equal(queued[0].input.observation.metadata.robotObserver.graph, 'environment');
  assert.equal(queued[0].input.observation.metadata.robotObserver.requestedBy, 'environment-perception');
  assert.equal(queued[0].input.observation.metadata.robotOperatorDecision.requiresAction, true);
  assert.deepEqual(queued[0].input.observation.text, []);
  assert.deepEqual(queued[0].input.observation.feedback, []);

  const second = await robotOperatorEnvironmentDispatchNode.execute({
    decision: {
      observed: 'The room is dark and still.',
      instruction: 'I want to respond in the way that best fits this moment.',
      requiresAction: false,
      reason: 'The present view and my persona shape this intention.',
    },
    observation,
  }, {
    username: 'owner',
    operatorMode: 'semi',
    enqueueRobotOperatorEnvironment: async (input: unknown) => {
      queued.push(input);
      return { id: 'environment-task-2' };
    },
  }, { graph: 'environment', maxSteps: 8 });
  assert.equal(second.queued, false);
  assert.equal(second.status, 'observation_only');
  assert.equal(second.taskId, '');
  assert.equal(queued.length, 1);

  const malformed = await robotOperatorEnvironmentDispatchNode.execute({
    decision: {
      observed: '',
      instruction: 'I have chosen a next intention.',
      requiresAction: false,
      reason: 'The current observation informed it.',
    },
    observation,
  }, {
    username: 'owner',
    operatorMode: 'semi',
    enqueueRobotOperatorEnvironment: async (input: unknown) => {
      queued.push(input);
      return { id: 'unexpected' };
    },
  }, { graph: 'environment', maxSteps: 8 });
  assert.equal(malformed.queued, false);
  assert.equal(malformed.status, 'invalid_decision');
  assert.equal(queued.length, 1);
});

test('Robot Operator dispatch does not reapply trigger mode after the graph decides to delegate', async () => {
  let queued = false;
  const result = await robotOperatorEnvironmentDispatchNode.execute({
    decision: {
      observed: 'The room contains an object that may need attention.',
      instruction: 'I want to investigate the room.',
      requiresAction: true,
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

test('specialized boredom graphs keep trigger deliberation private and delegate outward behavior', () => {
  const legacy = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'etc/cognitive-graphs/robot-operator-mode.json'),
    'utf8',
  ));
  const legacyNodeTypes = legacy.nodes.map((node: any) => node.data?.nodeType);
  assert.equal(legacyNodeTypes.includes('conversation_history'), false);
  assert.equal(legacyNodeTypes.includes('tts'), false);
  assert.equal(legacyNodeTypes.includes('environment_send_action'), false);

  const graphs = Object.fromEntries([
    'boredom-observer',
    'boredom-movement',
    'boredom-reflection',
  ].map(id => [id, JSON.parse(fs.readFileSync(
    path.join(ROOT, 'etc/cognitive-graphs', `${id}-mode.json`),
    'utf8',
  ))]));

  for (const [id, graph] of Object.entries(graphs) as Array<[string, any]>) {
    const nodeTypes = graph.nodes.map((node: any) => node.data?.nodeType);
    assert.equal(nodeTypes.includes('conversation_history'), false, `${id} must not inherit stale conversation authority`);
    assert.equal(nodeTypes.includes('tts'), false, `${id} trigger must not speak directly`);
    assert.equal(nodeTypes.includes('environment_send_action'), false, `${id} trigger must not execute hardware actions`);
    assert.equal(nodeTypes.includes('robot_operator_context_builder'), true);
    assert.equal(nodeTypes.includes('robot_operator_decision_parser'), true);
    assert.equal(nodeTypes.includes('robot_operator_environment_dispatch'), true);
    const inner = graph.nodes.find((node: any) => node.data?.nodeType === 'inner_dialogue_buffer');
    assert.equal(inner?.data?.properties?.dialogueSource, id);
    assert.equal(inner?.data?.properties?.captureMemory, false);
    assert.ok(graph.edges.some((edge: any) => (
      edge.source === inner.id
      && edge.sourceHandle === 'passthrough'
      && edge.target === 'environment-dispatch'
      && edge.targetHandle === 'decision'
    )));
  }

  assert.equal(
    graphs['boredom-observer'].nodes.some((node: any) => node.data?.nodeType === 'environment_image_input'),
    true,
  );
  assert.equal(
    graphs['boredom-movement'].nodes.some((node: any) => node.data?.nodeType === 'environment_image_input'),
    false,
  );
  assert.equal(
    graphs['boredom-movement'].nodes.find((node: any) => node.data?.nodeType === 'robot_operator_decision_parser')
      ?.data?.properties?.requireAction,
    true,
  );
  assert.equal(
    graphs['boredom-reflection'].nodes.some((node: any) => node.data?.nodeType === 'environment_image_input'),
    false,
  );
  assert.equal(
    graphs['boredom-reflection'].nodes.some((node: any) => node.data?.nodeType === 'curiosity_weighted_sampler'),
    true,
  );
  assert.ok(graphs['boredom-reflection'].edges.some((edge: any) => (
    edge.sourceHandle === 'memories' && edge.targetHandle === 'memoryContext'
  )));

  const observerPrompt = buildRobotOperatorInstruction('boredom-observer');
  const movementPrompt = buildRobotOperatorInstruction('boredom-movement');
  const reflectionPrompt = buildRobotOperatorInstruction('boredom-reflection');
  for (const prompt of [observerPrompt, movementPrompt, reflectionPrompt]) {
    assert.match(prompt, /do not execute robot commands, speak, or control hardware/i);
    assert.match(prompt, /Environment Mode alone selects and executes actions/i);
    assert.match(prompt, /private reflection/i);
    assert.match(prompt, /never mention timer, boredom trigger, service, agent, workflow/i);
    assert.match(prompt, /Complete when/i);
  }
  assert.match(observerPrompt, /single current camera observation/i);
  assert.match(movementPrompt, /movement opportunity first/i);
  assert.match(reflectionPrompt, /historical inspiration/i);

  const services = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc/services.json'), 'utf8'));
  const service = services.services['robot-operator'];
  assert.equal(service.boredomObserverGraph, 'boredom-observer');
  assert.equal(service.boredomMovementGraph, 'boredom-movement');
  assert.equal(service.boredomReflectionGraph, 'boredom-reflection');

  const handler = fs.readFileSync(path.join(ROOT, 'packages/core/src/queue/robot-autonomy-trigger-handler.ts'), 'utf8');
  assert.match(handler, /agentId === 'boredom-observer'[\s\S]*type: 'captureImage'/);
  assert.match(handler, /buildRobotAutonomyStimulus\(session\.latestObservation, cycle, agentId\)/);
  assert.doesNotMatch(handler, /type: 'robotCommand'|chooseBoredomMovementCommand/);
});
