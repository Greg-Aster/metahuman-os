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
const contextRouterId = nodeId('orchestrator_llm');
const memoryDecisionId = nodeId('smart_router');
const memoryRouterId = nodeId('memory_router');
const memoryInterpreterId = nodeId('search_interpreter');
const contextId = nodeId('environment_context_builder');
const actionParserId = nodeId('environment_action_parser');
const bridgeId = nodeId('environment_send_action');
const robotBufferId = nodeId('robot_buffer');
const personaId = nodeId('persona_formatter');
const bufferId = nodeId('conversation_buffer');
const validatorId = nodeId('environment_task_validator');
const captureId = nodeId('memory_capture');
const streamId = nodeId('stream_writer');
const ttsId = nodeId('tts');

assert.ok(hasEdge(historyId, 'history', contextId, 'conversationHistory'));
assert.ok(hasEdge(historyId, 'history', contextRouterId, 'conversationHistory'));
assert.ok(hasEdge(contextRouterId, 'analysis', memoryDecisionId, 'orchestratorAnalysis'));
assert.ok(hasEdge(memoryDecisionId, 'memoryHints', memoryRouterId, 'orchestratorHints'));
assert.ok(hasEdge(memoryRouterId, 'memories', memoryInterpreterId, 'searchResults'));
assert.ok(hasEdge(memoryDecisionId, 'memoryHints', memoryInterpreterId, 'orchestratorIntent'));
assert.ok(hasEdge(memoryInterpreterId, 'relevantMemories', contextId, 'memories'));
assert.ok(hasEdge(contextRouterId, 'analysis', contextId, 'routingAnalysis'));
assert.ok(hasEdge(contextRouterId, 'analysis', actionParserId, 'routingAnalysis'));
assert.ok(hasEdge(personaId, 'formatted', contextId, 'personaText'));
assert.ok(hasEdge(bridgeId, 'response', bufferId, 'response'));
assert.ok(hasEdge(validatorId, 'decision', bufferId, 'taskLifecycle'));
assert.ok(hasEdge(bridgeId, 'response', captureId, 'assistantResponse'));
assert.ok(hasEdge(bufferId, 'response', streamId, 'response'));
assert.ok(hasEdge(bufferId, 'response', ttsId, 'conversation'));
assert.ok(hasEdge(bridgeId, 'bridgeRecord', robotBufferId, 'bridgeRecord'));
assert.equal(
  graph.nodes.some(node => node.data?.nodeType === 'response_synthesizer'),
  false,
  'Environment Mode must not rewrite an already generated response with a second LLM pass',
);
assert.equal(
  graph.edges.some(edge => edge.source === personaId && edge.target === bridgeId),
  false,
  'Persona formatting must never enter the movement/action branch',
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
  personaText: '## Identity\n- Name: Ainekio\n- Role: Quadruped robot companion',
  routingAnalysis: { needsMemory: true, isFollowUp: false },
}, {}, {});

assert.equal(context.messages.length, 2);
assert.match(String(context.messages[0]?.content), /My name is Greg/);
assert.match(String(context.messages[0]?.content), /Quadruped robot companion/);
assert.match(String(context.messages.at(-1)?.content), /What is my name/);
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
  routingAnalysis: { needsMemory: false, isFollowUp: false },
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
  routingAnalysis: { needsMemory: false, isFollowUp: true },
}, {}, { recentHistoryLimit: 4 });

const followUpMessages = followUpContext.messages as Array<{ role: string; content: string }>;
assert.equal(
  followUpMessages.filter(message => message.content.startsWith('conversation message')).length,
  4,
  'A genuine follow-up receives only the configured recent dialogue window',
);
assert.equal(
  followUpMessages.some(message => message.content.includes('[Inner thought - daydream]')),
  false,
  'Inner dialogue is not injected as ordinary recent conversation',
);
assert.equal(
  followUpMessages.filter(message => message.content === followUpInstruction).length,
  0,
  'The early-persisted current user message must be removed from recent history',
);
assert.equal(
  followUpMessages.filter(message => message.content.includes(`Task instruction:\n${followUpInstruction}`)).length,
  1,
  'The current instruction must appear exactly once in the final environment prompt',
);

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
