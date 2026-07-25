/** System Buffer Node: the only node allowed to persist durable system events. */

import { getBufferPathForUser, writeBufferEntry } from '../../conversation-buffer.js';
import { defineNode, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, context) => {
  const username = typeof context.username === 'string'
    ? context.username.trim()
    : typeof context.userId === 'string'
      ? context.userId.trim()
      : '';
  const event = inputs.event ?? inputs.entry ?? context.systemEvent ?? context.bufferEntry;

  if (!username || username === 'anonymous') {
    return { persisted: false, skipped: true, reason: 'No authenticated username' };
  }
  if (!event || typeof event !== 'object' || typeof event.content !== 'string' || !event.content.trim()) {
    return {
      persisted: false,
      skipped: true,
      reason: 'No durable system event',
      bufferPath: getBufferPathForUser(username, 'system'),
    };
  }

  const persisted = await writeBufferEntry(username, 'system', {
    role: 'system',
    content: event.content.trim(),
    meta: {
      type: 'system_event',
      source: 'system',
      severity: 'info',
      ...(event.meta && typeof event.meta === 'object' ? event.meta : {}),
    },
  });

  return {
    persisted,
    skipped: false,
    bufferPath: getBufferPathForUser(username, 'system'),
  };
};

export const SystemBufferNode = defineNode({
  id: 'system_buffer',
  name: 'System Buffer',
  category: 'output',
  inputs: [{ name: 'event', type: 'message', optional: true, description: 'Typed durable system event' }],
  outputs: [
    { name: 'persisted', type: 'boolean' },
    { name: 'skipped', type: 'boolean' },
    { name: 'bufferPath', type: 'string' },
  ],
  description: 'Validates and persists a durable event to the canonical System Buffer.',
  execute,
});
