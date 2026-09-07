import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanonicalBufferMode } from './conversation-buffer.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-buffer-spec-'));
assert.equal(fs.realpathSync(isolatedRoot), isolatedRoot);
process.env.METAHUMAN_ROOT = isolatedRoot;
globalThis.fetch = async () => { throw new Error('Network access is forbidden in buffer contract tests'); };
const { ROOT, registerProfileStorageConfigGetter, systemPaths } = await import('./path-builder.js');
assert.equal(ROOT, isolatedRoot);
assert.ok(systemPaths.logs.startsWith(isolatedRoot + path.sep));
const { eventBus } = await import('./infrastructure/event-bus/client.js');
eventBus.disconnect();
const { setAuditEnabled } = await import('./audit.js');
setAuditEnabled(false);
const {
  clearBufferForUser,
  getBufferNotificationPath,
  getBufferPathForUser,
  loadBufferForUser,
  writeBufferEntry,
  retireBufferAdmissions,
} = await import('./conversation-buffer.js');
const { loadChatSettingsForUser } = await import('./chat-settings.js');
const { submitRobotBridgeRecord } = await import('./buffer-admission.js');
const { openExecutionStore } = await import('./durable-execution/storage.js');

const username = 'buffer-spec-user';
const root = path.join(isolatedRoot, 'profiles', username);
fs.mkdirSync(path.join(isolatedRoot, 'etc', 'cognitive-graphs'), { recursive: true });
fs.copyFileSync(path.join(repo, 'etc', 'chat-settings.json'), path.join(isolatedRoot, 'etc', 'chat-settings.json'));
fs.copyFileSync(path.join(repo, 'etc', 'cognitive-graphs', 'robot-buffer-admission.json'),
  path.join(isolatedRoot, 'etc', 'cognitive-graphs', 'robot-buffer-admission.json'));
registerProfileStorageConfigGetter(candidate => candidate === username
  ? { path: root, type: 'internal' }
  : undefined);

try {
  const globalConfig = JSON.parse(fs.readFileSync(path.join(systemPaths.root, 'etc/chat-settings.json'), 'utf8'));
  const legacyConfig = JSON.parse(JSON.stringify(globalConfig));
  delete legacyConfig.settings.conversationBufferLimit;
  delete legacyConfig.settings.innerBufferLimit;
  delete legacyConfig.settings.systemBufferLimit;
  delete legacyConfig.settings.robotBufferLimit;
  legacyConfig.settings.maxHistoryMessages = { value: 6 };
  legacyConfig.settings.innerDialogHistoryLimit = { value: 21 };
  legacyConfig.settings.innerDialogHistoryDays = { value: 7 };
  fs.mkdirSync(path.join(root, 'etc'), { recursive: true });
  fs.writeFileSync(path.join(root, 'etc/chat-settings.json'), JSON.stringify(legacyConfig, null, 2));
  const migratedSettings = loadChatSettingsForUser(username);
  assert.equal(migratedSettings.conversationBufferLimit, 6);
  assert.equal(migratedSettings.innerBufferLimit, 21);
  assert.equal(migratedSettings.systemBufferLimit, 6);
  assert.equal(migratedSettings.robotBufferLimit, 100);

  globalConfig.settings.conversationBufferLimit.value = 5;
  globalConfig.settings.innerBufferLimit.value = 20;
  globalConfig.settings.systemBufferLimit.value = 20;
  globalConfig.settings.robotBufferLimit.value = 20;
  fs.writeFileSync(path.join(root, 'etc/chat-settings.json'), JSON.stringify(globalConfig, null, 2));

  const counts: Record<CanonicalBufferMode, number> = {
    conversation: 7,
    inner: 22,
    system: 22,
    robot: 22,
  };
  const roles = {
    conversation: 'assistant',
    inner: 'thought',
    system: 'system',
    robot: 'robot',
  } as const;

  for (const mode of Object.keys(counts) as CanonicalBufferMode[]) {
    for (let index = 0; index < counts[mode]; index++) {
      assert.equal(await writeBufferEntry(username, mode, {
        role: roles[mode],
        content: `${mode}-${index}`,
      }), true);
    }
    const expected = mode === 'conversation' ? 5 : 20;
    const buffer = loadBufferForUser(username, mode);
    assert.equal(buffer.messages.length, expected, `${mode} uses its independent retention limit`);
    assert.equal(buffer.messages.at(-1)?.content, `${mode}-${counts[mode] - 1}`);
    assert.equal(fs.existsSync(getBufferNotificationPath(username, mode)), true, `${mode} emits a notification`);
  }

  assert.equal(await writeBufferEntry(username, 'conversation', { role: 'user', content: 'first counted message' }), true);
  assert.equal(await writeBufferEntry(username, 'conversation', { role: 'user', content: 'second counted message' }), true);
  assert.equal(loadBufferForUser(username, 'conversation').userMessageCount, 2);
  assert.equal(await clearBufferForUser(username, 'conversation'), true);
  const clearedConversation = loadBufferForUser(username, 'conversation');
  assert.deepEqual(clearedConversation.messages, []);
  assert.equal(clearedConversation.userMessageCount, 2, 'clearing retained messages must preserve the admission counter');
  assert.equal(await writeBufferEntry(username, 'conversation', { role: 'user', content: 'message after clear' }), true);
  assert.equal(loadBufferForUser(username, 'conversation').userMessageCount, 3);

  const corruptedPath = getBufferPathForUser(username, 'system');
  fs.writeFileSync(corruptedPath, '{invalid json');
  const recovered = loadBufferForUser(username, 'system');
  assert.deepEqual(recovered.messages, []);
  assert.equal(
    fs.readdirSync(path.dirname(corruptedPath)).some(name => name.startsWith('conversation-buffer-system.json.corrupted-')),
    true,
    'Corruption recovery preserves a backup before resetting',
  );

  assert.equal(await clearBufferForUser(username, 'robot'), true);
  assert.deepEqual(loadBufferForUser(username, 'robot').messages, []);

  const completedRecord = {
    direction: 'inbound',
    status: 'completed',
    message: 'done',
    targetSessionId: 'robot-1',
    actionId: 'action-1',
    feedback: {
      id: 'feedback-1',
      timestamp: new Date().toISOString(),
      type: 'completed',
      message: 'done',
      actionId: 'action-1',
    },
  };
  assert.equal(await submitRobotBridgeRecord(username, completedRecord), true);
  assert.equal(await submitRobotBridgeRecord(username, completedRecord), true);
  const executions = openExecutionStore(username);
  try {
    const records = executions.list();
    const states = records.map(execution => execution.status);
    assert.ok(states.length > 0, 'The real buffer admission workflow has a durable execution receipt');
    assert.deepEqual(states, states.map(() => 'completed'), 'Repeated feedback must not conceal a failed graph behind a successful staging node');
    assert.equal(executions.pendingDispatches().length, 0, 'Successful buffer admission leaves no undelivered entry');
    assert.deepEqual(loadBufferForUser(username, 'robot').executionAdmissions?.['environment-feedback:feedback-1'].executionIds,
      records.map(record => record.executionId), 'One feedback receipt retains both delivery execution references');
  } finally { executions.close(); }
  const robotMessages = loadBufferForUser(username, 'robot').messages;
  assert.equal(robotMessages.length, 1, 'replayed bridge feedback must remain idempotent');
  assert.equal(robotMessages[0]?.content, 'Robot action completed: done');
  assert.equal(robotMessages[0]?.meta?.direction, 'inbound');
  await assert.rejects(submitRobotBridgeRecord(username, { ...completedRecord, message: 'Conflicting result.' }),
    /robot buffer admission failed/, 'A successful staging node cannot conceal failed checkpoint/outbox delivery');
  assert.deepEqual(loadBufferForUser(username, 'robot').messages, robotMessages, 'A conflicting stable receipt never changes the published message');

  const replayed = { role: 'assistant' as const, content: 'One committed reply.',
    meta: { idempotencyKey: 'buffer-replay', executionId: 'buffer-execution' } };
  await writeBufferEntry(username, 'conversation', replayed);
  const conversationPath = getBufferPathForUser(username, 'conversation');
  const legacyBuffer = JSON.parse(fs.readFileSync(conversationPath, 'utf8'));
  legacyBuffer.executionAdmissions['buffer-replay'] = { executionId: 'buffer-execution',
    contentHash: legacyBuffer.executionAdmissions['buffer-replay'].contentHash };
  fs.writeFileSync(conversationPath, JSON.stringify(legacyBuffer));
  assert.deepEqual(loadBufferForUser(username, 'conversation').executionAdmissions?.['buffer-replay'].executionIds,
    ['buffer-execution'], 'Existing persisted singular receipts migrate at the buffer owner');
  for (let index = 0; index < 8; index++) await writeBufferEntry(username, 'conversation', { role: 'assistant', content: `later-${index}` });
  const beforeReplay = loadBufferForUser(username, 'conversation').messages;
  assert.equal(beforeReplay.some(message => message.content === replayed.content), false);
  await writeBufferEntry(username, 'conversation', replayed);
  assert.deepEqual(loadBufferForUser(username, 'conversation').messages, beforeReplay,
    'An evicted entry is not republished by a recovered committed delivery');
  const referencedAgain = { ...replayed, meta: { ...replayed.meta, executionId: 'another-execution' } };
  await writeBufferEntry(username, 'conversation', referencedAgain);
  await retireBufferAdmissions(username, 'buffer-execution');
  assert.deepEqual(loadBufferForUser(username, 'conversation').executionAdmissions?.['buffer-replay'].executionIds,
    ['another-execution'], 'Retiring one execution cannot erase another execution\'s admission receipt');
  await assert.rejects(writeBufferEntry(username, 'conversation', { ...replayed, content: 'Conflicting reply.' }), /conflicts/);
  await clearBufferForUser(username, 'conversation');
  await writeBufferEntry(username, 'conversation', referencedAgain);
  assert.deepEqual(loadBufferForUser(username, 'conversation').messages, [], 'Clearing the feed does not replay an old execution');
  await retireBufferAdmissions(username, 'another-execution');
  assert.deepEqual(loadBufferForUser(username, 'conversation').executionAdmissions, {});
  console.log('conversation-buffer.spec.ts: all assertions passed');
} finally {
  eventBus.disconnect();
  fs.rmSync(isolatedRoot, { recursive: true, force: true });
}
