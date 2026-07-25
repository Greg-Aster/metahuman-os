import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';
import { ConversationBufferNode } from './nodes/output/conversation-buffer.node.js';
import { InnerDialogueBufferNode } from './nodes/output/inner-dialogue-buffer.node.js';
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

const summaryPrimitiveCallers = files
  .filter(file => fs.readFileSync(file, 'utf8').includes('writeConversationBufferSummary'))
  .map(relative)
  .sort();
assert.deepEqual(
  summaryPrimitiveCallers,
  [storageOwner, 'packages/core/src/nodes/output/conversation-buffer.node.ts'].sort(),
  'Only Conversation Buffer may invoke the summary storage primitive',
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
assert.equal(SystemBufferNode.id, 'system_buffer');
assert.equal(RobotBufferNode.id, 'robot_buffer');

const admissionGraphs: Record<string, string> = {
  'conversation-buffer-admission.json': 'conversation_buffer',
  'inner-buffer-admission.json': 'inner_dialogue_buffer',
  'system-event.json': 'system_buffer',
  'robot-buffer-admission.json': 'robot_buffer',
};
for (const [fileName, nodeType] of Object.entries(admissionGraphs)) {
  const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc/cognitive-graphs', fileName), 'utf8'));
  assert.equal(graph.nodes.length, 1, `${fileName} must remain a one-node admission workflow`);
  assert.equal(graph.nodes[0]?.data?.nodeType, nodeType, `${fileName} must own ${nodeType}`);
}

const legacyNodeTypes = new Set(['buffer_manager', 'inner_dialogue_capture', 'reasoning_capture', 'dual_writer']);
for (const fileName of fs.readdirSync(path.join(ROOT, 'etc/cognitive-graphs'))) {
  if (!fileName.endsWith('.json')) continue;
  const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'etc/cognitive-graphs', fileName), 'utf8'));
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
assert.doesNotMatch(publicCore, /\bwriteBufferEntry\b|\bwriteConversationBufferSummary\b/);
assert.doesNotMatch(publicCore, /\bsubmitBufferEntry\b/);

console.log('buffer-ownership.spec.ts: all assertions passed');
