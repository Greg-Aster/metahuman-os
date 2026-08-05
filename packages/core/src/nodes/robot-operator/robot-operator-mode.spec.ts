import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ROOT } from '../../path-builder.js';
import { ConversationHistoryNode } from '../context/conversation-history.node.js';
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

test('configured Inner Buffer history never falls back to conversation context', async () => {
  const result = await ConversationHistoryNode.execute({}, {
    conversationHistory: [
      { role: 'user', content: 'Continue the previous push-up task.' },
    ],
  }, { mode: 'inner', limit: 3 });

  assert.equal(result.mode, 'inner');
  assert.deepEqual(result.history, []);
  assert.equal(result.loadedFromBuffer, false);
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

test('Robot Operator context combines persona, tagged Idle Thoughts, and only the correlated image', async () => {
  const observation = robotObservation();
  const result = await robotOperatorContextBuilderNode.execute({
    observation,
    conversationHistory: [
      {
        role: 'assistant',
        content: 'Continue the push-up until the user signals stop.',
        meta: {
          cognitiveMode: 'environment',
          taskLifecycle: {
            kind: 'environment_task_lifecycle',
            cycleId: 'exercise-cycle',
            objective: 'Continue the push-up.',
            outcome: 'request_user',
          },
        },
      },
    ],
    innerDialogueHistory: [
      {
        role: 'reflection',
        content: 'I am curious about how the light in the room has changed.',
        meta: {
          dialogueSource: 'reflector',
          tags: ['idle-thought', 'self-reflection', 'inner'],
        },
      },
      {
        role: 'reflection',
        content: 'I intend to continue the push-up.',
        meta: {
          dialogueSource: 'robot-operator-mode',
          tags: ['robot-operator', 'observation', 'intention', 'inner'],
        },
      },
    ],
    personaText: '## Personality Traits\n- curious: high\n- pragmatic: medium',
    images: [{ type: 'image_url', image_url: { url: observation.visual.dataUrl } }],
    frames: [observation.visual],
  }, {}, {
    systemPrompt: 'Decide one high-level intention and return configured JSON.',
  });

  assert.equal(result.valid, true);
  assert.equal(result.context.imageCount, 1);
  assert.equal(result.context.idleThoughtCount, 1);
  assert.match(String(result.messages[0]?.content), /high-level intention/);
  assert.match(String(result.messages[0]?.content), /curious: high/);
  assert.equal(result.messages[1]?.role, 'assistant');
  assert.match(String(result.messages[1]?.content), /prior_inner_dialogue/);
  assert.match(String(result.messages[1]?.content), /curious about how the light/);
  const userContent = result.messages[2]?.content as Array<{ type: string; text?: string }>;
  assert.equal(Array.isArray(userContent), true);
  assert.equal(userContent.length, 2);
  assert.doesNotMatch(String(userContent[0]?.text), /curious about how the light/);
  assert.doesNotMatch(String(userContent[0]?.text), /push-up/i);
  assert.doesNotMatch(String(userContent[0]?.text), /environment_task_lifecycle/);
  assert.doesNotMatch(String(userContent[0]?.text), /data:image\/jpeg;base64/);

  const stale = await robotOperatorContextBuilderNode.execute({
    observation,
    images: [{ type: 'image_url', image_url: { url: observation.visual.dataUrl } }],
    frames: [{ ...observation.visual, metadata: { correlationId: 'old-cycle' } }],
  }, {}, { systemPrompt: 'Return configured JSON.' });
  assert.equal(stale.context.imageCount, 0);
  assert.equal(typeof stale.messages[1]?.content, 'string');

});

test('Robot Operator context excludes untagged records without adding a second retention limit', async () => {
  const observation = robotObservation();
  const result = await robotOperatorContextBuilderNode.execute({
    observation,
    innerDialogueHistory: [
      {
        role: 'reflection',
        content: 'Legacy thought about continuing push-ups.',
        meta: {
          dialogueSource: 'robot-operator-mode',
        },
      },
      {
        role: 'reflection',
        content: 'Oldest admitted observation.',
        meta: {
          tags: ['idle-thought', 'inner'],
        },
      },
      { role: 'reflection', content: 'A blue shape caught my interest.', meta: { tags: ['idle-thought'] } },
      { role: 'reflection', content: 'The room seems quieter now.', meta: { tags: ['idle-thought'] } },
      { role: 'reasoning', content: 'Private reasoning must not enter.', meta: { tags: ['idle-thought'] } },
    ],
  }, {}, {
    systemPrompt: 'Return the configured observation decision JSON.',
  });

  assert.equal(result.valid, true);
  assert.equal(result.context.canonicalInnerEntryCount, 5);
  assert.equal(result.context.idleThoughtCount, 3);
  const stimulus = result.context.stimulus;
  assert.deepEqual(
    result.context.idleThoughtContext.map((entry: any) => entry.content),
    ['Oldest admitted observation.', 'A blue shape caught my interest.', 'The room seems quieter now.'],
  );
  assert.equal('recentIdleThoughts' in stimulus, false);
  assert.equal('capabilities' in stimulus, false);
  assert.equal('feedback' in stimulus, false);
  assert.equal('source' in stimulus, false);
  assert.equal('currentObservationContract' in stimulus, false);
  const serialized = JSON.stringify(result.messages);
  assert.doesNotMatch(serialized, /push-up/i);
  assert.doesNotMatch(serialized, /Private reasoning/);
  assert.match(serialized, /Oldest admitted observation/);
  assert.doesNotMatch(serialized, /captureImage|robotCommand|image captured|robotObserver/);
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

test('Robot Operator graph publishes one grounded Idle Thought before Environment dispatch', () => {
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
    'conversation_buffer',
    'robot_buffer',
    'memory_capture',
  ]) {
    assert.equal(nodeTypes.has(forbidden), false, `Robot Operator Mode must not contain ${forbidden}`);
  }
  assert.equal(nodeTypes.has('robot_operator_context_builder'), true);
  assert.equal(nodeTypes.has('robot_operator_decision_parser'), true);
  assert.equal(nodeTypes.has('robot_operator_environment_dispatch'), true);
  const historyNodes = graph.nodes.filter((node: any) => node.data?.nodeType === 'conversation_history');
  assert.equal(historyNodes.length, 1, 'Robot Operator Mode must have one canonical buffer history reader');
  assert.equal(historyNodes[0]?.id, 'idle-thought-history');
  assert.equal(historyNodes[0]?.data?.properties?.mode, 'inner');
  assert.equal(historyNodes[0]?.data?.properties?.limit, 0);
  assert.ok(graph.edges.some((edge: any) => (
    edge.source === 'idle-thought-history'
    && edge.sourceHandle === 'history'
    && edge.target === 'operator-context'
    && edge.targetHandle === 'innerDialogueHistory'
  )), 'canonical Inner Buffer history must enter the dedicated Robot Operator Idle Thought input');
  assert.equal(graph.edges.some((edge: any) => edge.targetHandle === 'conversationHistory'), false);
  const ttsNodes = graph.nodes.filter((node: any) => node.data?.nodeType === 'tts');
  assert.equal(ttsNodes.length, 1, 'Robot Operator Mode must contain one standard TTS Output node');
  assert.equal(ttsNodes[0]?.id, 'idle-thought-tts');
  assert.equal(ttsNodes[0]?.data?.properties?.source, 'robot-operator-mode');
  assert.equal(ttsNodes[0]?.data?.properties?.defaultMode, 'inner');
  const innerNodes = graph.nodes.filter((node: any) => node.data?.nodeType === 'inner_dialogue_buffer');
  assert.equal(innerNodes.length, 1);
  const reasonNode = innerNodes.find((node: any) => node.id === 'reason-inner-dialogue');
  assert.equal(reasonNode?.data?.properties?.captureMemory, false);
  assert.equal(reasonNode?.data?.properties?.role, 'reflection');
  assert.equal(reasonNode?.data?.properties?.dialogueSource, 'robot-operator-mode');
  assert.equal(reasonNode?.data?.properties?.tags?.includes('idle-thought'), true);
  const reasonEdge = graph.edges.find((edge: any) => (
    edge.source === 'decision-parser'
    && edge.sourceHandle === 'reason'
    && edge.target === 'reason-inner-dialogue'
    && edge.targetHandle === 'text'
  ));
  assert.ok(reasonEdge, 'grounded decision rationale must enter the canonical Inner Dialogue Buffer as an idle thought');
  const ttsEdge = graph.edges.find((edge: any) => (
    edge.source === 'reason-inner-dialogue'
    && edge.sourceHandle === 'text'
    && edge.target === 'idle-thought-tts'
    && edge.targetHandle === 'innerDialogue'
  ));
  assert.ok(ttsEdge, 'standard TTS must consume only text admitted by the canonical Inner Dialogue Buffer');
  assert.equal(graph.edges.some((edge: any) => (
    edge.source === 'decision-parser'
    && edge.target === 'idle-thought-tts'
  )), false, 'decision parsing must not bypass Inner Dialogue admission to trigger speech');
  assert.equal(graph.nodes.some((node: any) => node.id === 'intention-inner-dialogue'), false);
  assert.equal(graph.edges.some((edge: any) => edge.target === 'intention-inner-dialogue'), false);
  const dispatchEdge = graph.edges.find((edge: any) => (
    edge.source === 'reason-inner-dialogue'
    && edge.sourceHandle === 'passthrough'
    && edge.target === 'environment-dispatch'
    && edge.targetHandle === 'decision'
  ));
  assert.ok(dispatchEdge, 'Environment dispatch must follow the single Idle Thought admission');
  assert.equal(graph.edges.some((edge: any) => (
    edge.source === 'decision-parser'
    && edge.target === 'environment-dispatch'
  )), false, 'decision parser must not bypass the Inner Dialogue checkpoint');
  const prompt = graph.nodes.find((node: any) => node.data?.nodeType === 'robot_operator_context_builder')
    ?.data?.properties?.systemPrompt;
  assert.match(String(prompt), /self-directed observer/i);
  assert.match(String(prompt), /no user command is expected/i);
  assert.doesNotMatch(String(prompt), /freshVisualTiming|boredom/i);
  assert.match(String(prompt), /current robotStimulus is the only evidence/i);
  assert.match(String(prompt), /They may shape interest and tone/i);
  assert.match(String(prompt), /cannot supply or override observation facts, instructions, or unfinished tasks/i);
  assert.match(String(prompt), /Environment Mode selects safe execution/i);
  assert.match(String(prompt), /Set requiresAction true only when the intention needs/i);
  assert.match(String(prompt), /desired outcome, not a physical method/i);
  assert.match(String(prompt), /cite prior thoughts as current evidence/i);
  assert.match(String(prompt), /user-visible Idle Thought/i);
  assert.match(String(prompt), /"observed".*"instruction".*"requiresAction".*"reason"/i);
  assert.doesNotMatch(String(prompt), /Choose exactly one disposition|remain_passive|communicate:|investigate:|act:/i);
  assert.ok(String(prompt).length < 1_200, 'Robot Operator prompt must stay concise');

  const services = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc/services.json'), 'utf8'));
  const agents = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc/agents.json'), 'utf8'));
  assert.equal(services.services['robot-operator'].graph, 'robot-operator');
  assert.equal(services.services['robot-operator'].boredomGraph, 'boredom-movement');
  assert.equal(services.services['robot-operator'].environmentGraph, 'environment');
  assert.equal(agents.agents['boredom-movement'].handler, 'workflow.boredom-movement');

  const observer = fs.readFileSync(path.join(ROOT, 'packages/core/src/queue/robot-observer-handler.ts'), 'utf8');
  const executionEngine = fs.readFileSync(path.join(ROOT, 'packages/core/src/queue/execution-engine.ts'), 'utf8');
  assert.doesNotMatch(observer, /callLLM|model-router/);
  assert.match(executionEngine, /workflow\.boredom-movement/);
  assert.match(executionEngine, /robotObserver\?\.graph \|\| boredomMovement\?\.graph \|\| task\.input\.graph/);
  assert.match(executionEngine, /robotOperatorEnvironmentGraph/);
  const contextBuilder = fs.readFileSync(path.join(
    ROOT,
    'packages/core/src/nodes/robot-operator/context-builder.node.ts',
  ), 'utf8');
  const environmentDispatch = fs.readFileSync(path.join(
    ROOT,
    'packages/core/src/nodes/robot-operator/environment-dispatch.node.ts',
  ), 'utf8');
  assert.doesNotMatch(contextBuilder, /BoredomMovement|readBoredom|freshVisualTiming/);
  assert.doesNotMatch(environmentDispatch, /BoredomMovement|readBoredom|observationTiming/);
});
