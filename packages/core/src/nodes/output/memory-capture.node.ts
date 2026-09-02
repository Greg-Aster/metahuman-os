/**
 * Conversation Memory Saver Node
 *
 * Persists exact user/assistant entries to long-term Persona Memory after
 * short-term Conversation Buffer admission. The stable node id remains
 * `memory_capture` so existing editable graphs keep their public node type.
 */

import type { ConversationMessage } from '../../conversation-buffer.js';
import { captureEventWithDetails, type CaptureResult } from '../../memory.js';
import { defineNode, type NodeDefinition } from '../types.js';

const CONVERSATION_ROLES = new Set<ConversationMessage['role']>(['user', 'assistant']);

function timestampForEntry(entry: ConversationMessage): string {
  const raw = entry.timestamp ?? entry.meta?.timestamp;
  const parsed = typeof raw === 'number'
    ? raw
    : typeof raw === 'string'
      ? Date.parse(raw)
      : Date.now();
  if (!Number.isFinite(parsed)) throw new Error('Conversation memory entry has an invalid timestamp');
  return new Date(parsed).toISOString();
}

function admittedEntries(inputs: Record<string, any>): ConversationMessage[] {
  const rawEntries = Array.isArray(inputs.entries)
    ? inputs.entries
    : inputs.entry && typeof inputs.entry === 'object'
      ? [inputs.entry]
      : [];

  return rawEntries.map((rawEntry, index) => {
    if (!rawEntry || typeof rawEntry !== 'object') {
      throw new Error(`Conversation memory entry ${index + 1} must be an object`);
    }
    const role = rawEntry.role as ConversationMessage['role'];
    const content = typeof rawEntry.content === 'string' ? rawEntry.content.trim() : '';
    if (!CONVERSATION_ROLES.has(role) || !content) {
      throw new Error(`Conversation memory entry ${index + 1} must contain a user or assistant message`);
    }
    return {
      role,
      content,
      timestamp: rawEntry.timestamp,
      meta: rawEntry.meta && typeof rawEntry.meta === 'object' ? { ...rawEntry.meta } : {},
    };
  });
}

export const MemoryCaptureNode: NodeDefinition = defineNode({
  id: 'memory_capture',
  name: 'Conversation Memory Saver',
  category: 'output',
  inputs: [
    { name: 'entry', type: 'message', optional: true, description: 'One Conversation Buffer-admitted entry' },
    { name: 'entries', type: 'array', optional: true, description: 'Ordered Conversation Buffer-admitted entries' },
  ],
  outputs: [
    { name: 'saved', type: 'boolean', description: 'Whether every admitted entry was saved' },
    { name: 'savedCount', type: 'number' },
    { name: 'eventId', type: 'string', optional: true },
    { name: 'eventIds', type: 'array' },
    { name: 'eventPath', type: 'string', optional: true },
    { name: 'eventPaths', type: 'array' },
    { name: 'results', type: 'array' },
  ],
  description: 'Saves each admitted user or assistant entry as its own long-term conversation memory.',

  execute: async (inputs, context) => {
    if (context.composeTarget === 'inner') {
      return { saved: false, savedCount: 0, eventIds: [], eventPaths: [], results: [], reason: 'Inner compose uses the Inner Dialogue Memory Saver' };
    }

    const entries = admittedEntries(inputs);
    if (entries.length === 0) {
      return { saved: false, savedCount: 0, eventIds: [], eventPaths: [], results: [], reason: 'No admitted conversation entries' };
    }

    const username = typeof context.username === 'string'
      ? context.username.trim()
      : typeof context.userId === 'string'
        ? context.userId.trim()
        : '';
    if (!username || username === 'anonymous') {
      throw new Error('Conversation memory saving requires an authenticated username');
    }

    const memoryWritesAllowed = context.recordPersonaMemory ?? context.allowMemoryWrites ?? false;
    if (memoryWritesAllowed !== true) {
      return { saved: false, savedCount: 0, eventIds: [], eventPaths: [], results: [], reason: 'Persona Memory writes disabled' };
    }

    const cognitiveMode = context.cognitiveMode || 'dual';
    const results: CaptureResult[] = entries.map(entry => {
      const timestamp = timestampForEntry(entry);
      const idempotencyKey = typeof entry.meta?.idempotencyKey === 'string'
        ? entry.meta.idempotencyKey.trim()
        : '';
      return captureEventWithDetails(entry.content, {
        type: 'conversation',
        idempotencyKey: idempotencyKey || undefined,
        timestamp,
        metadata: {
          ...entry.meta,
          role: entry.role,
          source: entry.meta?.source || 'conversation',
          cognitiveMode,
          sessionId: entry.meta?.sessionId || context.sessionId,
          userId: context.userId,
          skipDedup: true,
        },
      });
    });

    return {
      saved: results.length === entries.length,
      savedCount: results.length,
      eventId: results[0]?.eventId,
      eventIds: results.map(result => result.eventId),
      eventPath: results[0]?.filePath,
      eventPaths: results.map(result => result.filePath),
      results,
    };
  },
});
