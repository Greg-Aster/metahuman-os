import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setAuditEnabled } from '../audit.js';
import { TriggerManager } from './trigger-manager.js';
import { TriggerConfigService, type TriggerManagerConfig } from './trigger-config-service.js';
import { UnifiedQueueManager } from './unified-queue-manager.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-trigger-manager-'));
const configPath = path.join(tempRoot, 'agents.json');

const config: TriggerManagerConfig = {
  version: '1.0.0',
  revision: 1,
  globalSettings: {
    pauseAll: false,
    timezone: 'UTC',
    quietHours: { enabled: false, start: '22:00', end: '08:00' },
  },
  agents: {
    organizer: {
      id: 'organizer',
      enabled: true,
      type: 'manual',
      lifecycle: 'scheduled-work',
      handler: 'agent.organizer',
      priority: 'normal',
      allowedModes: ['reactive', 'semi', 'full'],
      startupPolicy: 'skip',
      maxRetries: 1,
    },
    reflector: {
      id: 'reflector',
      enabled: true,
      type: 'activity',
      lifecycle: 'scheduled-work',
      handler: 'agent.reflector',
      priority: 'low',
      allowedModes: ['semi', 'full'],
      startupPolicy: 'skip',
      inactivityThreshold: 1,
      maxRetries: 1,
    },
    digest: {
      id: 'digest',
      enabled: true,
      type: 'interval',
      lifecycle: 'scheduled-work',
      handler: 'agent.digest',
      priority: 'low',
      allowedModes: ['semi', 'full'],
      startupPolicy: 'skip',
      interval: 1,
      maxRetries: 0,
    },
    summarizer: {
      id: 'summarizer',
      enabled: true,
      type: 'event',
      lifecycle: 'scheduled-work',
      handler: 'agent.summarizer',
      priority: 'normal',
      allowedModes: ['reactive', 'semi', 'full'],
      startupPolicy: 'skip',
      eventPattern: 'memory.*',
      maxRetries: 0,
    },
    mood: {
      id: 'mood',
      enabled: true,
      type: 'event',
      lifecycle: 'scheduled-work',
      handler: 'agent.mood',
      priority: 'normal',
      allowedModes: ['reactive', 'semi', 'full'],
      startupPolicy: 'skip',
      eventPattern: 'conversation.user-message.appended',
      eventCountThreshold: 10,
      eventCountField: 'userMessageCount',
      idleResetSeconds: 60,
      maxRetries: 0,
    },
    broken: {
      id: 'broken',
      enabled: true,
      type: 'manual',
      lifecycle: 'scheduled-work',
      handler: 'agent.broken',
      priority: 'normal',
      allowedModes: ['reactive', 'semi', 'full'],
      startupPolicy: 'skip',
      maxRetries: 0,
    },
  },
};

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
setAuditEnabled(false);

try {
  const service = new TriggerConfigService(configPath);
  const queue = new UnifiedQueueManager();
  const manager = new TriggerManager(queue);
  manager.setHandlerInspector(agent => ({
    registered: agent.id !== 'broken',
    sourceResolvable: agent.id !== 'broken',
  }));
  service.subscribe(read => manager.applyConfig(read));
  const initial = service.load();

  assert.equal(initial.scope, 'system');
  assert.equal(manager.getSnapshot().config.runtimeRevision, 1);
  assert.equal(manager.getSnapshot().timezone, 'UTC');

  manager.start();
  assert.equal(manager.getSnapshot().lifecycle, 'running');
  assert.ok(manager.getSnapshot().triggers.find(trigger => trigger.id === 'digest')?.nextRun);
  const reactiveDue = manager.evaluateActivityTriggers(Date.now() + 2_000);
  assert.deepEqual(reactiveDue, []);
  assert.equal(manager.getSnapshot().triggers.find(trigger => trigger.id === 'reflector')?.lastSuppressionReason, 'mode:reactive');

  manager.setAutonomyMode('semi');
  const admitted = manager.evaluateActivityTriggers(Date.now() + 2_000);
  assert.equal(admitted.length, 1);
  assert.equal(queue.getTask(admitted[0])?.metadata?.producer, 'trigger-manager');

  manager.pauseAll();
  assert.equal(manager.triggerEvent('memory.updated').length, 0);
  assert.equal(manager.getSnapshot().triggers.find(trigger => trigger.id === 'summarizer')?.lastSuppressionReason, 'global-pause');
  manager.resumeAll();
  const eventTasks = manager.triggerEvent('memory.updated.detail');
  assert.equal(eventTasks.length, 1);
  assert.equal(queue.getTask(eventTasks[0])?.source, 'system');
  const nextEventTasks = manager.triggerEvent('memory.updated.again');
  assert.equal(nextEventTasks.length, 1, 'events are distinct unless an explicit debounce is configured');
  assert.notEqual(nextEventTasks[0], eventTasks[0]);

  for (let userMessageCount = 1; userMessageCount < 10; userMessageCount += 1) {
    assert.deepEqual(manager.triggerEvent('conversation.user-message.appended', {
      username: 'greggles',
      userMessageCount,
    }), []);
  }
  const moodTasks = manager.triggerEvent('conversation.user-message.appended', {
    username: 'greggles',
    userMessageCount: 10,
  });
  assert.equal(moodTasks.length, 1, 'Mood should admit work on the configured message-count boundary');
  const moodTask = queue.getTask(moodTasks[0]);
  assert.equal(moodTask?.username, 'greggles');
  assert.equal(moodTask?.type, 'mood_review');
  assert.equal(moodTask?.input.triggerData.userMessageCount, 10);
  assert.equal(moodTask?.input.triggerData.eventCount, 10);
  assert.deepEqual(manager.triggerEvent('conversation.user-message.appended', {
    username: 'greggles',
    userMessageCount: 10,
  }), [], 'replaying the same persisted message count must not duplicate Mood work');

  manager.setAutonomyMode('full');
  assert.equal(manager.getSnapshot().autonomyMode, 'full');
  await new Promise(resolve => setTimeout(resolve, 1_100));
  const intervalTask = queue.getAllTasks().find(task => task.metadata?.triggerId === 'digest');
  assert.ok(intervalTask, 'a due interval must be admitted in full mode');
  assert.equal(intervalTask?.metadata?.producer, 'trigger-manager');

  const updated = service.update({ agents: { reflector: { enabled: false } } }, 'test');
  assert.equal(updated.revision, 2);
  const snapshot = manager.getSnapshot();
  assert.equal(snapshot.config.persistedRevision, 2);
  assert.equal(snapshot.config.runtimeRevision, 2);
  assert.equal(snapshot.triggers.find(trigger => trigger.id === 'reflector')?.enabled, false);
  assert.deepEqual(manager.evaluateActivityTriggers(Date.now() + 5_000), []);

  const idleTasks = manager.evaluateActivityTriggers(Date.now() + 61_000);
  assert.equal(idleTasks.length, 1, 'Mood should admit one baseline reset after its idle cooldown');
  const idleTask = queue.getTask(idleTasks[0]);
  assert.equal(idleTask?.metadata?.triggerId, 'mood');
  assert.equal(idleTask?.username, 'greggles');
  assert.deepEqual(idleTask?.input.args, ['--baseline']);
  assert.equal(idleTask?.input.triggerData.idleReset, true);
  assert.deepEqual(manager.evaluateActivityTriggers(Date.now() + 62_000), [], 'an idle period must not enqueue repeated baseline resets');

  const typeChanged = service.update({
    agents: {
      reflector: {
        type: 'interval',
        inactivityThreshold: null,
        interval: 120,
      },
    },
  }, 'test');
  assert.equal(typeChanged.config.agents.reflector.type, 'interval');
  assert.equal(typeChanged.config.agents.reflector.interval, 120);
  assert.equal(typeChanged.config.agents.reflector.inactivityThreshold, undefined);

  assert.throws(
    () => service.update({ agents: { organizer: { imaginarySetting: true } } }, 'test'),
    /Unknown trigger field/,
  );
  assert.throws(
    () => service.update({ futureSettings: {} } as any, 'test'),
    /Unknown trigger configuration field/,
  );
  assert.throws(
    () => service.update({ agents: { organizer: { id: 'different-agent' } } }, 'test'),
    /must match its catalog key/,
  );
  assert.throws(
    () => service.update({ agents: { organizer: { lifecycle: 'service' } } }, 'test'),
    /belongs in services\.json/,
  );
  assert.throws(
    () => service.update({ agents: { summarizer: { eventPattern: 'memory.*.invalid' } } }, 'test'),
    /only supports a trailing \.\* wildcard/,
  );

  const invalidConfigPath = path.join(tempRoot, 'agents-invalid.json');
  fs.writeFileSync(invalidConfigPath, `${JSON.stringify({ ...config, unknownCatalogField: true })}\n`, 'utf8');
  assert.throws(
    () => new TriggerConfigService(invalidConfigPath).load(),
    /Unknown trigger configuration field/,
  );

  const manualTaskId = manager.triggerManual('organizer', 'owner', ['--dry-run']);
  assert.ok(manualTaskId);
  assert.deepEqual(queue.getTask(manualTaskId!)?.input.args, ['--dry-run']);
  queue.pause();
  const queuedWhilePaused = manager.triggerManual('organizer', 'owner');
  assert.equal(queue.isPaused(), true);
  assert.equal(queue.getTask(queuedWhilePaused!)?.state, 'queued');
  queue.resume();

  assert.equal(manager.triggerManual('broken', 'owner'), null);
  assert.equal(manager.getSnapshot().triggers.find(trigger => trigger.id === 'broken')?.lastSuppressionReason, 'invalid-handler');
  manager.dispose();
} finally {
  setAuditEnabled(true);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('trigger manager contract passed');
