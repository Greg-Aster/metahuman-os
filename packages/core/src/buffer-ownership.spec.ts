import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';
import { ConversationBufferNode } from './nodes/output/conversation-buffer.node.js';
import { InnerDialogueBufferNode } from './nodes/output/inner-dialogue-buffer.node.js';
import { InnerDialogueSaverNode } from './nodes/cognitive/inner-dialogue-saver.node.js';
import { MemoryCaptureNode } from './nodes/output/memory-capture.node.js';
import { RobotBufferNode } from './nodes/output/robot-buffer.node.js';
import { SystemBufferNode } from './nodes/output/system-buffer.node.js';

const sourceRoots = [
  path.join(ROOT, 'packages/core/src'),
  path.join(ROOT, 'brain'),
];

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(target));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) files.push(target);
  }
  return files;
}

const files = sourceRoots.flatMap(sourceFiles);
const relative = (file: string) => path.relative(ROOT, file);
const storageOwner = 'packages/core/src/conversation-buffer.ts';
const designatedNodes = new Set([
  'packages/core/src/nodes/output/conversation-buffer.node.ts',
  'packages/core/src/nodes/output/inner-dialogue-buffer.node.ts',
  'packages/core/src/nodes/output/system-buffer.node.ts',
  'packages/core/src/nodes/output/robot-buffer.node.ts',
]);

const entryPrimitiveCallers = files
  .filter(file => fs.readFileSync(file, 'utf8').includes('writeBufferEntry'))
  .map(relative)
  .sort();
assert.deepEqual(
  entryPrimitiveCallers,
  [storageOwner, ...designatedNodes].sort(),
  'Only the canonical storage owner and four designated nodes may reference writeBufferEntry',
);

const retiredNames = [
  'appendToUserBuffer',
  'appendReflectionToBuffer',
  'appendDreamToBuffer',
  'appendDaydreamToBuffer',
  'appendReasoningToBuffer',
  'appendSystemMessageToBuffer',
  'appendExecutionProgressToBuffer',
  'appendAgencyMessageToBuffer',
];
for (const name of retiredNames) {
  assert.equal(
    files.some(file => fs.readFileSync(file, 'utf8').includes(name)),
    false,
    `Retired direct writer must be absent: ${name}`,
  );
}

assert.equal(ConversationBufferNode.id, 'conversation_buffer');
assert.equal(InnerDialogueBufferNode.id, 'inner_dialogue_buffer');
assert.equal(MemoryCaptureNode.id, 'memory_capture');
assert.equal(InnerDialogueSaverNode.id, 'inner_dialogue_saver');
assert.deepEqual(MemoryCaptureNode.inputs.map(input => input.name), ['entry', 'entries']);
assert.deepEqual(InnerDialogueSaverNode.inputs.map(input => input.name), ['entry', 'entries', 'gate']);
assert.equal(SystemBufferNode.id, 'system_buffer');
assert.equal(RobotBufferNode.id, 'robot_buffer');

const bufferAdmissionSource = fs.readFileSync(
  path.join(ROOT, 'packages/core/src/buffer-admission.ts'),
  'utf8',
);
assert.doesNotMatch(
  bufferAdmissionSource,
  /inner-buffer-admission/,
  'Inner Dialogue admission must use the canonical nodes without a standalone graph',
);
assert.match(bufferAdmissionSource, /inner-dialogue-buffer\.node/);
assert.match(bufferAdmissionSource, /inner-dialogue-saver\.node/);

const shortTermAdmissionGraphs: Record<string, string> = {
  'system-event.json': 'system_buffer',
  'robot-buffer-admission.json': 'robot_buffer',
};
for (const [fileName, nodeType] of Object.entries(shortTermAdmissionGraphs)) {
  const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc/cognitive-graphs', fileName), 'utf8'));
  assert.equal(graph.nodes.length, 1, `${fileName} must remain a one-node admission workflow`);
  assert.equal(graph.nodes[0]?.data?.nodeType, nodeType, `${fileName} must own ${nodeType}`);
}

const conversationBufferSource = fs.readFileSync(
  path.join(ROOT, 'packages/core/src/nodes/output/conversation-buffer.node.ts'),
  'utf8',
);
const innerBufferSource = fs.readFileSync(
  path.join(ROOT, 'packages/core/src/nodes/output/inner-dialogue-buffer.node.ts'),
  'utf8',
);
assert.doesNotMatch(conversationBufferSource, /captureEvent(?:WithDetails)?/);
assert.doesNotMatch(
  conversationBufferSource,
  /context\.(?:bufferEntry|userMessage|userMessageAdmitted)/,
  'Conversation persistence must come only from explicit graph edges',
);
assert.doesNotMatch(innerBufferSource, /captureEvent(?:WithDetails)?/);

const graphDirectory = path.join(ROOT, 'etc/cognitive-graphs');
assert.equal(
  fs.existsSync(path.join(graphDirectory, 'conversation-buffer-admission.json')),
  false,
  'Conversation turns must be owned by their producing graph, not a standalone admission graph',
);
assert.equal(
  fs.existsSync(path.join(graphDirectory, 'inner-buffer-admission.json')),
  false,
  'Inner Dialogue producers outside a graph must reuse the canonical nodes without a standalone admission graph',
);
const conversationGraphFiles: string[] = [];
for (const fileName of fs.readdirSync(graphDirectory)) {
  if (!fileName.endsWith('.json')) continue;
  const graph = JSON.parse(fs.readFileSync(path.join(graphDirectory, fileName), 'utf8'));
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const conversationBuffers = nodes.filter((node: any) => node.data?.nodeType === 'conversation_buffer');
  if (conversationBuffers.length > 0) conversationGraphFiles.push(fileName);
  const conversationSavers = nodes.filter((node: any) => node.data?.nodeType === 'memory_capture');
  for (const buffer of conversationBuffers) {
    assert.equal(
      edges.some((edge: any) => edge.target === buffer.id && edge.targetHandle === 'conversationHistory'),
      false,
      `${fileName} must not route unused history into Conversation Buffer`,
    );
    assert.ok(
      conversationSavers.some((saver: any) => edges.some((edge: any) => edge.source === buffer.id
        && edge.sourceHandle === 'entries'
        && edge.target === saver.id
        && edge.targetHandle === 'entries')),
      `${fileName} must route every Conversation Buffer entry to a Conversation Memory Saver`,
    );
  }

  const conversationTtsNodes = nodes.filter((node: any) => (
    node.data?.nodeType === 'tts' && node.data?.properties?.defaultMode === 'conversation'
  ));
  for (const tts of conversationTtsNodes) {
    assert.equal(conversationBuffers.length, 1, `${fileName} must contain one Conversation Buffer`);
    assert.ok(
      edges.some((edge: any) => edge.source === conversationBuffers[0].id
        && edge.sourceHandle === 'response'
        && edge.target === tts.id
        && edge.targetHandle === 'conversation'),
      `${fileName} must speak the exact response retained by Conversation Buffer`,
    );
  }

  const innerBuffers = nodes.filter((node: any) => node.data?.nodeType === 'inner_dialogue_buffer');
  const innerSavers = nodes.filter((node: any) => node.data?.nodeType === 'inner_dialogue_saver');
  const dreamSavers = nodes.filter((node: any) => node.data?.nodeType === 'dreamer_dream_saver');
  for (const buffer of innerBuffers) {
    const downstreamInnerSaver = innerSavers.some((saver: any) => edges.some((edge: any) => edge.source === buffer.id
      && edge.sourceHandle === 'entries'
      && edge.target === saver.id
      && edge.targetHandle === 'entries'));
    const upstreamDreamSaver = dreamSavers.some((saver: any) => edges.some((edge: any) => edge.source === saver.id
      && ['bufferEntries', 'dream'].includes(edge.sourceHandle)
      && edge.target === buffer.id
      && ['entries', 'text'].includes(edge.targetHandle)));
    assert.ok(
      downstreamInnerSaver || upstreamDreamSaver,
      `${fileName} must route every Inner Dialogue Buffer entry through a specialized long-term saver`,
    );
  }
}

assert.deepEqual(conversationGraphFiles.sort(), [
  'agent-mode.json',
  'boredom-autonomy-mode.json',
  'curiosity-mode.json',
  'dual-mode.json',
  'emulation-mode.json',
  'environment-mode.json',
  'response-pipeline.json',
  'robot-action-result-mode.json',
  'robot-goal-review-mode.json',
]);

const directInnerDialogueCapture = files.filter(file => {
  const source = fs.readFileSync(file, 'utf8');
  if (relative(file) === 'packages/core/src/nodes/cognitive/inner-dialogue-saver.node.ts') return false;
  return /type:\s*['"]inner_dialogue['"]/.test(source);
}).map(relative);
assert.deepEqual(
  directInnerDialogueCapture,
  [],
  'Production inner-dialogue writers must admit through the buffer and specialized saver workflow',
);

const legacyNodeTypes = new Set(['buffer_manager', 'inner_dialogue_capture', 'reasoning_capture', 'dual_writer']);
for (const fileName of fs.readdirSync(graphDirectory)) {
  if (!fileName.endsWith('.json')) continue;
  const graph = JSON.parse(fs.readFileSync(path.join(graphDirectory, fileName), 'utf8'));
  for (const node of graph.nodes || []) {
    assert.equal(
      legacyNodeTypes.has(node.data?.nodeType),
      false,
      `${fileName} contains retired node type ${node.data?.nodeType}`,
    );
  }
}

const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc/chat-settings.json'), 'utf8')).settings;
for (const key of ['conversationBufferLimit', 'innerBufferLimit', 'systemBufferLimit', 'robotBufferLimit']) {
  assert.ok(settings[key], `Canonical retention setting is required: ${key}`);
}
for (const key of ['maxHistoryMessages', 'innerDialogHistoryLimit', 'innerDialogHistoryDays']) {
  assert.equal(settings[key], undefined, `Legacy retention setting must be absent: ${key}`);
}

const publicCore = fs.readFileSync(path.join(ROOT, 'packages/core/src/index.ts'), 'utf8');
assert.doesNotMatch(publicCore, /export \* from ['"]\.\/conversation-buffer/);
assert.doesNotMatch(publicCore, /\bwriteBufferEntry\b/);
assert.doesNotMatch(publicCore, /\bsubmitBufferEntry\b/);
assert.doesNotMatch(publicCore, /\bsubmitConversationEntry\b|\bsubmitAgencyConversationEntry\b/);

const productionSource = files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
for (const retiredConversationPath of [
  'conversation-buffer-admission',
  'userMessageAdmitted',
  'submitConversationEntry',
  'submitAgencyConversationEntry',
  'handleAppendBuffer',
]) {
  assert.equal(
    productionSource.includes(retiredConversationPath),
    false,
    `Retired conversation admission path must be absent: ${retiredConversationPath}`,
  );
}

console.log('buffer-ownership.spec.ts: all assertions passed');
