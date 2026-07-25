import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  clearBufferForUser,
  getBufferNotificationPath,
  getBufferPathForUser,
  loadBufferForUser,
  writeBufferEntry,
  writeConversationBufferSummary,
  type CanonicalBufferMode,
} from './conversation-buffer.js';
import {
  registerProfileStorageConfigGetter,
  systemPaths,
} from './path-builder.js';
import { eventBus } from './infrastructure/event-bus/client.js';
import { loadChatSettingsForUser } from './chat-settings.js';
import { submitRobotBridgeRecord } from './buffer-admission.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-buffer-spec-'));
const username = 'buffer-spec-user';
const originalEventEmit = eventBus.emit.bind(eventBus);
eventBus.emit = () => {};
registerProfileStorageConfigGetter(candidate => candidate === username
  ? { path: root, type: 'internal' }
  : undefined);
systemPaths.run = path.join(root, 'run');

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

  assert.equal(await writeConversationBufferSummary(username, {
    sessionId: 'summary-session',
    content: 'A bounded summary.',
    messageCount: 7,
  }), true);
  assert.equal(loadBufferForUser(username, 'conversation').summaryMarkers.length, 1);

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
  const robotMessages = loadBufferForUser(username, 'robot').messages;
  assert.equal(robotMessages.length, 1, 'replayed bridge feedback must remain idempotent');
  assert.equal(robotMessages[0]?.content, 'Robot action completed: done');
  assert.equal(robotMessages[0]?.meta?.direction, 'inbound');

  console.log('conversation-buffer.spec.ts: all assertions passed');
} finally {
  eventBus.emit = originalEventEmit;
  fs.rmSync(root, { recursive: true, force: true });
}
