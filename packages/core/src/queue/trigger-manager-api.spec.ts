import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createTriggerManagerStream } from '../api/handlers/trigger-manager.js';
import { TriggerManager, type TriggerManagerConfig } from './trigger-manager.js';
import type { QueueSystem } from './queue-system.js';
import { UnifiedQueueManager } from './unified-queue-manager.js';

const config: TriggerManagerConfig = {
  version: '1',
  revision: 1,
  globalSettings: { pauseAll: false, timezone: 'UTC' },
  agents: {},
};

const queue = new UnifiedQueueManager();
const triggers = new TriggerManager(queue, config);
const source = new EventEmitter() as EventEmitter & { triggers: TriggerManager };
source.triggers = triggers;
const system = source as unknown as QueueSystem;
const abort = new AbortController();
const beforeTriggerListeners = triggers.listenerCount('stateChange');
const beforeQueueListeners = source.listenerCount('queue');
const stream = createTriggerManagerStream(system, abort.signal)[Symbol.asyncIterator]();

const initial = await stream.next();
assert.equal(initial.done, false);
assert.match(initial.value, /"type":"snapshot"/);
assert.equal(triggers.listenerCount('stateChange'), beforeTriggerListeners + 1);
assert.equal(source.listenerCount('queue'), beforeQueueListeners + 1);

abort.abort();
const finished = await stream.next();
assert.equal(finished.done, true);
assert.equal(triggers.listenerCount('stateChange'), beforeTriggerListeners);
assert.equal(source.listenerCount('queue'), beforeQueueListeners);

triggers.dispose();
console.log('trigger manager API stream contract passed');
