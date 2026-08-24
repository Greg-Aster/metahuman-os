import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';
import { canWriteMemory } from './memory-policy.js';
import { environmentContextBuilderNode } from './nodes/environment/context-builder.node.js';
import { MemoryCaptureNode } from './nodes/output/memory-capture.node.js';
import { ConversationBufferNode } from './nodes/output/conversation-buffer.node.js';
import { createRobotBufferMessage, RobotBufferNode } from './nodes/output/robot-buffer.node.js';

const graph = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'etc/cognitive-graphs/environment-mode.json'), 'utf8'),
) as {
  nodes: Array<{ id: string; data?: { nodeType?: string; properties?: Record<string, unknown> } }>;
  edges: Array<{ source: string; target: string; sourceHandle?: string; targetHandle?: string }>;
};
const conversationBufferSource = fs.readFileSync(
  path.join(ROOT, 'packages/core/src/nodes/output/conversation-buffer.node.ts'),
  'utf8',
);
const robotBufferSource = fs.readFileSync(
  path.join(ROOT, 'packages/core/src/nodes/output/robot-buffer.node.ts'),
  'utf8',
);

assert.match(conversationBufferSource, /writeBufferEntry/);
assert.doesNotMatch(
  conversationBufferSource,
  /writeFileSync/,
  'Conversation Buffer must delegate persistence to the canonical service',
);
assert.match(robotBufferSource, /writeBufferEntry/);
assert.doesNotMatch(
  robotBufferSource,
  /writeFileSync/,
  'Robot Buffer must delegate persistence to the canonical conversation-buffer service',
);

const nodeId = (nodeType: string): string => {
  const matches = graph.nodes.filter(node => node.data?.nodeType === nodeType);
  assert.equal(matches.length, 1, `Environment Mode must contain exactly one ${nodeType} node`);
  return matches[0]!.id;
};
const hasEdge = (source: string, sourceHandle: string, target: string, targetHandle: string): boolean =>
  graph.edges.some(edge =>
    edge.source === source
    && edge.sourceHandle === sourceHandle
    && edge.target === target
    && edge.targetHandle === targetHandle,
  );

const historyId = nodeId('conversation_history');
const memoryRouterId = nodeId('memory_router');
const contextId = nodeId('environment_context_builder');
const personaLoaderId = nodeId('persona_loader');
const personaFormatterId = nodeId('persona_formatter');
const actionParserId = nodeId('environment_action_parser');
const bridgeId = nodeId('environment_send_action');
const robotBufferId = nodeId('robot_buffer');
const bufferId = nodeId('conversation_buffer');
const captureId = nodeId('memory_capture');
const streamId = nodeId('stream_writer');
const ttsId = nodeId('tts');
const taskStateNodes = graph.nodes.filter(node => node.data?.nodeType === 'environment_task_state');
assert.equal(taskStateNodes.length, 2);
const prepareId = taskStateNodes.find(node => node.data?.properties?.phase === 'prepare')?.id;
const reducerId = taskStateNodes.find(node => node.data?.properties?.phase === 'reduce')?.id;
assert.ok(prepareId);
assert.ok(reducerId);

assert.ok(hasEdge(historyId, 'history', contextId, 'conversationHistory'));
assert.ok(hasEdge(prepareId, 'memoryHints', memoryRouterId, 'orchestratorHints'));
assert.ok(hasEdge(memoryRouterId, 'memories', contextId, 'memories'));
assert.ok(hasEdge(personaLoaderId, 'persona', personaFormatterId, 'persona'));
assert.ok(hasEdge(personaFormatterId, 'formatted', contextId, 'personaText'));
assert.ok(hasEdge(prepareId, 'routingAnalysis', contextId, 'routingAnalysis'));
assert.ok(hasEdge(prepareId, 'routingAnalysis', actionParserId, 'routingAnalysis'));
assert.ok(hasEdge(bridgeId, 'conversationResponse', bufferId, 'response'));
assert.ok(hasEdge(actionParserId, 'actions', reducerId, 'actions'));
assert.equal(hasEdge(reducerId, 'decision', bufferId, 'taskLifecycle'), false);
assert.ok(hasEdge(bridgeId, 'conversationResponse', captureId, 'assistantResponse'));
assert.ok(hasEdge(bufferId, 'response', streamId, 'response'));
assert.ok(hasEdge(bufferId, 'response', ttsId, 'conversation'));
assert.ok(hasEdge(bridgeId, 'bridgeRecord', robotBufferId, 'bridgeRecord'));
assert.equal(
  graph.nodes.some(node => node.data?.nodeType === 'response_synthesizer'),
  false,
  'Environment Mode must not rewrite an already generated response with a second LLM pass',
);
assert.equal(ConversationBufferNode.id, 'conversation_buffer');
assert.equal(
  graph.nodes.some(node => ['buffer_manager', 'inner_dialogue_capture', 'reasoning_capture'].includes(node.data?.nodeType || '')),
  false,
  'Environment Mode must not retain legacy buffer writers',
);
assert.equal(graph.nodes.find(node => node.id === robotBufferId)?.data?.properties?.recordNoAction, false);
assert.equal(RobotBufferNode.id, 'robot_buffer');

const robotMessage = createRobotBufferMessage({
  status: 'coordinated_for_adapter',
  message: 'Environment command queued for connected adapter session robot-1.',
  targetSessionId: 'robot-1',
  commandCount: 1,
});
assert.equal(robotMessage.role, 'robot');
assert.match(robotMessage.content, /coordinated_for_adapter/);
assert.equal(robotMessage.meta.direction, 'outbound');
assert.equal(robotMessage.meta.targetSessionId, 'robot-1');

const robotLifecycleMessage = createRobotBufferMessage({
  direction: 'inbound',
  status: 'completed',
  message: 'done',
  targetSessionId: 'robot-1',
  actionId: 'action-1',
  feedback: {
    id: 'feedback-1',
    type: 'completed',
    message: 'done',
  },
});
assert.equal(robotLifecycleMessage.content, 'Robot action completed: done');
assert.equal(robotLifecycleMessage.meta.direction, 'inbound');
assert.equal(robotLifecycleMessage.meta.actionId, 'action-1');
assert.equal(robotLifecycleMessage.meta.idempotencyKey, 'environment-feedback:feedback-1');

assert.equal(canWriteMemory('environment', 'conversation'), true);
assert.equal(canWriteMemory('environment', 'tool_invocation'), false);
assert.equal(canWriteMemory('agent', 'conversation'), false);

const context = await environmentContextBuilderNode.execute({
  observation: {
    environmentId: 'test',
    adapter: 'test-adapter',
    sessionId: 'robot-1',
    timestamp: new Date().toISOString(),
    capabilities: { actions: ['robotCommand'], robotCommands: ['wave'] },
  },
  instruction: 'What is my name?',
  conversationHistory: [
    { role: 'user', content: 'My name is Greg.' },
    { role: 'assistant', content: 'Nice to meet you, Greg.' },
  ],
  memories: [{ content: 'User: My name is Greg.\n\nAssistant: Nice to meet you, Greg.' }],
  routingAnalysis: {
    needsMemory: true,
    needsEnvironment: false,
    needsVision: false,
    needsAction: false,
    isFollowUp: false,
  },
}, {}, {});

assert.equal(context.messages.length, 2);
assert.doesNotMatch(String(context.messages[0]?.content), /My name is Greg/);
const memorySelectorEnvelope = JSON.parse(String(context.messages.at(-1)?.content)) as {
  currentInstruction: string;
  currentEnvironment: { capabilities: { actions: string[]; robotCommands: string[] } };
  memories: string[];
};
assert.equal(memorySelectorEnvelope.currentInstruction, 'What is my name?');
assert.deepEqual(memorySelectorEnvelope.currentEnvironment.capabilities.actions, ['robotCommand']);
assert.deepEqual(memorySelectorEnvelope.currentEnvironment.capabilities.robotCommands, ['wave']);
assert.match(memorySelectorEnvelope.memories[0] ?? '', /My name is Greg/);
assert.equal(
  `${String(context.messages[0]?.content)}\n${String(context.messages[1]?.content)}`.match(/My name is Greg/g)?.length,
  1,
  'Each selected memory enters the selector context exactly once',
);
assert.deepEqual(context.context.contextSelection, {
  recentHistory: false,
  recentHistoryCount: 0,
  semanticMemory: true,
});

const unifiedInnerDialogue = Array.from({ length: 10 }, (_, index) => ({
  role: 'system',
  content: `[Inner thought - daydream]: remembered daydream ${index + 1}`,
}));
const fullConversationWindow = Array.from({ length: 25 }, (_, index) => ({
  role: index % 2 === 0 ? 'user' : 'assistant',
  content: `conversation message ${index + 1}`,
}));
const selfContainedContext = await environmentContextBuilderNode.execute({
  observation: {
    environmentId: 'test',
    adapter: 'test-adapter',
    sessionId: 'robot-1',
    timestamp: new Date().toISOString(),
    capabilities: { actions: [], robotCommands: [] },
  },
  instruction: 'Hello, how are you?',
  conversationHistory: [...unifiedInnerDialogue, ...fullConversationWindow],
  memories: [{ content: 'A stale movement request from an earlier turn.' }],
  routingAnalysis: {
    needsMemory: false,
    needsEnvironment: false,
    needsVision: false,
    needsAction: false,
    isFollowUp: false,
  },
}, {}, {});

const selfContainedMessages = selfContainedContext.messages as Array<{ role: string; content: string }>;
assert.equal(
  selfContainedMessages.length,
  2,
  'A self-contained message receives only supporting context and the current task',
);
assert.equal(
  selfContainedMessages.some(message => message.content.includes('stale movement request')),
  false,
  'Unrequested semantic memory must not enter the prompt',
);
assert.match(
  String(selfContainedMessages.at(-1)?.content),
  /"capabilities":\{"actions":\[\],"robotCommands":\[\]/,
  'The action selector receives the advertised capability contract in its bounded envelope',
);
assert.deepEqual(selfContainedContext.context.contextAdmission, {
  typed: true,
  environment: true,
  vision: false,
  actionContracts: true,
});

const followUpInstruction = 'What did you mean by that?';
const followUpContext = await environmentContextBuilderNode.execute({
  observation: {
    environmentId: 'test',
    adapter: 'test-adapter',
    sessionId: 'robot-1',
    timestamp: new Date().toISOString(),
    capabilities: { actions: [], robotCommands: [] },
  },
  instruction: followUpInstruction,
  conversationHistory: [
    ...unifiedInnerDialogue,
    ...fullConversationWindow,
    { role: 'user', content: followUpInstruction },
  ],
  routingAnalysis: {
    needsMemory: false,
    needsEnvironment: false,
    needsVision: false,
    needsAction: false,
    isFollowUp: true,
  },
}, {}, { recentHistoryLimit: 4 });

const followUpMessages = followUpContext.messages as Array<{ role: string; content: string }>;
const followUpEnvelope = JSON.parse(followUpMessages.at(-1)?.content ?? '{}') as {
  currentInstruction: string;
  recentConversation: Array<{ role: string; content: string }>;
};
assert.equal(
  followUpEnvelope.recentConversation.filter(message => message.content.startsWith('conversation message')).length,
  4,
  'A genuine follow-up receives the configured recent dialogue window once inside the selector envelope',
);
assert.equal(
  followUpEnvelope.recentConversation.some(message => message.content.includes('[Inner thought - daydream]')),
  false,
  'Inner dialogue is not injected as ordinary recent conversation',
);
assert.equal(
  followUpEnvelope.recentConversation.filter(message => message.content === followUpInstruction).length,
  0,
  'The early-persisted current user message must be removed from recent history',
);
assert.equal(followUpEnvelope.currentInstruction, followUpInstruction);
assert.equal(followUpMessages.length, 2, 'The compact selector prompt has one system and one user message');

const currentStateContext = await environmentContextBuilderNode.execute({
  observation: {
    environmentId: 'test',
    adapter: 'test-adapter',
    sessionId: 'robot-1',
    timestamp: new Date().toISOString(),
    capabilities: { actions: ['robotCommand'], robotCommands: ['wave'] },
    state: { batteryPercent: 72 },
  },
  instruction: 'What is the current battery level?',
  routingAnalysis: {
    needsMemory: false,
    needsEnvironment: true,
    needsVision: false,
    needsAction: false,
    isFollowUp: false,
  },
}, {}, { systemPrompt: 'EXECUTION GROUNDING CONTRACT' });

assert.match(String(currentStateContext.message), /batteryPercent/);
assert.match(String(currentStateContext.messages[0]?.content), /EXECUTION GROUNDING CONTRACT/);
assert.deepEqual(currentStateContext.context.contextAdmission, {
  typed: true,
  environment: true,
  vision: false,
  actionContracts: true,
});

const emptyCapture = await MemoryCaptureNode.execute({
  userMessage: '',
  assistantResponse: 'Sensor-only response.',
}, {
  cognitiveMode: 'environment',
  allowMemoryWrites: true,
  userId: 'test-user',
}, {});
assert.equal(emptyCapture.saved, false);
assert.equal(emptyCapture.reason, 'No user message to capture');

console.log('environment-conversation-memory.spec.ts passed');
