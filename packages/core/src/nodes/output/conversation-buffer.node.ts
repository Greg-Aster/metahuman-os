/**
 * Conversation Buffer Node
 *
 * The only graph node allowed to persist voiced Conversation Buffer entries.
 */

import {
  getBufferPathForUser,
  loadBufferForUser,
  writeBufferEntry,
  type ConversationMessage,
} from '../../conversation-buffer.js';
import { defineNode, type NodeExecutor } from '../types.js';

function entryTimestamp(entry: Record<string, any>, context: Record<string, any>): number {
  const candidate = entry.timestamp ?? context.memoryTimestamp;
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  if (typeof candidate === 'string') {
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function normalizeEntryIdentity(
  entry: ConversationMessage,
  context: Record<string, any>,
): ConversationMessage {
  const meta = entry.meta && typeof entry.meta === 'object' ? { ...entry.meta } : {};
  const explicitKey = typeof meta.idempotencyKey === 'string' ? meta.idempotencyKey.trim() : '';
  const executionKey = typeof context.idempotencyKey === 'string' ? context.idempotencyKey.trim() : '';
  const idempotencyKey = explicitKey || (executionKey ? `${executionKey}:${entry.role}` : '');
  return {
    ...entry,
    content: entry.content.trim(),
    timestamp: entryTimestamp(entry, context),
    meta: {
      ...meta,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    },
  };
}

function assistantResponseText(inputs: Record<string, any>): string {
  const explicitEntry = inputs.entry;
  if (
    explicitEntry
    && typeof explicitEntry === 'object'
    && explicitEntry.role === 'assistant'
    && typeof explicitEntry.content === 'string'
  ) return explicitEntry.content.trim();

  const rawResponse = inputs.response ?? inputs.assistantResponse;
  return typeof rawResponse === 'string'
    ? rawResponse.trim()
    : typeof rawResponse?.response === 'string'
      ? rawResponse.response.trim()
      : typeof rawResponse?.content === 'string'
        ? rawResponse.content.trim()
        : '';
}

function taskLifecycleMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const encoded = JSON.stringify(value);
    if (encoded.length > 8_000) return null;
    return JSON.parse(encoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const execute: NodeExecutor = async (inputs, context) => {
  const passthrough = inputs.passthrough ?? null;
  const assistantResponse = assistantResponseText(inputs);
  const taskLifecycle = taskLifecycleMetadata(inputs.taskLifecycle);
  const assistantMetadata = taskLifecycleMetadata(inputs.metadata) ?? {};
  const username = typeof context.username === 'string'
    ? context.username.trim()
    : typeof context.userId === 'string'
      ? context.userId.trim()
      : '';

  if (!username || username === 'anonymous') {
    return {
      persisted: false,
      skipped: true,
      entries: [],
      reason: 'No authenticated username',
      response: assistantResponse,
      responseBufferId: inputs.responseBufferId || '',
      passthrough,
    };
  }

  if (context.composeTarget === 'inner') {
    return {
      persisted: false,
      skipped: true,
      entries: [],
      reason: 'Inner compose turn is owned by the Inner Dialogue Buffer node',
      bufferPath: getBufferPathForUser(username, 'conversation'),
      response: assistantResponse,
      responseBufferId: inputs.responseBufferId || '',
      passthrough,
    };
  }

  const explicitEntry = inputs.entry;
  const entries: ConversationMessage[] = [];
  if (explicitEntry && typeof explicitEntry === 'object') {
    entries.push({
      ...explicitEntry,
      ...(explicitEntry.role === 'assistant' && (taskLifecycle || Object.keys(assistantMetadata).length > 0)
        ? {
            meta: {
              ...(explicitEntry.meta && typeof explicitEntry.meta === 'object'
                ? explicitEntry.meta
                : {}),
              ...assistantMetadata,
              ...(taskLifecycle ? { taskLifecycle } : {}),
            },
          }
        : {}),
    });
  } else {
    const userText = typeof inputs.userMessage === 'string'
      ? inputs.userMessage.trim()
      : '';
    if (userText) {
      entries.push({
        role: 'user',
        content: userText,
        meta: {
          ...(context.replyToDesireId ? { replyToDesireId: context.replyToDesireId } : {}),
          ...(context.replyToDesireTitle ? { replyToDesireTitle: context.replyToDesireTitle } : {}),
          ...(context.replyToQuestionId ? { replyToQuestionId: context.replyToQuestionId } : {}),
          ...(context.replyToContent ? { replyToContent: context.replyToContent } : {}),
          ...(context.cognitiveMode ? { cognitiveMode: context.cognitiveMode } : {}),
          ...(context.sessionId ? { sessionId: context.sessionId } : {}),
        },
      });
    }
    if (assistantResponse) {
      entries.push({
        role: 'assistant',
        content: assistantResponse,
        meta: {
          ...(context.replyToDesireId ? { replyToDesireId: context.replyToDesireId } : {}),
          ...(context.replyToDesireTitle ? { replyToDesireTitle: context.replyToDesireTitle } : {}),
          ...(context.cognitiveMode ? { cognitiveMode: context.cognitiveMode } : {}),
          ...(context.sessionId ? { sessionId: context.sessionId } : {}),
          ...assistantMetadata,
          ...(taskLifecycle ? { taskLifecycle } : {}),
        },
      });
    }
  }

  const allowedRoles = new Set(['user', 'assistant']);
  const admittedEntries: ConversationMessage[] = [];
  for (const rawEntry of entries) {
    if (!allowedRoles.has(rawEntry.role) || typeof rawEntry.content !== 'string' || !rawEntry.content.trim()) {
      continue;
    }
    const entry = normalizeEntryIdentity(rawEntry, context);
    if (await writeBufferEntry(username, 'conversation', {
      role: entry.role,
      content: entry.content.trim(),
      meta: entry.meta,
      timestamp: entry.timestamp,
    })) {
      const idempotencyKey = typeof entry.meta?.idempotencyKey === 'string'
        ? entry.meta.idempotencyKey
        : '';
      const durableEntry = idempotencyKey
        ? [...loadBufferForUser(username, 'conversation').messages]
            .reverse()
            .find(message => message.meta?.idempotencyKey === idempotencyKey)
        : entry;
      if (!durableEntry) {
        throw new Error('Conversation Buffer did not retain the admitted idempotent entry');
      }
      admittedEntries.push(durableEntry);
    }
  }

  return {
    persisted: admittedEntries.length > 0,
    skipped: admittedEntries.length === 0,
    messageCount: admittedEntries.length,
    entry: admittedEntries[0],
    entries: admittedEntries,
    bufferPath: getBufferPathForUser(username, 'conversation'),
    response: admittedEntries.find(entry => entry.role === 'assistant')?.content || assistantResponse,
    responseBufferId: inputs.responseBufferId || '',
    passthrough,
  };
};

export const ConversationBufferNode = defineNode({
  id: 'conversation_buffer',
  name: 'Conversation Buffer',
  category: 'output',
  inputs: [
    { name: 'entry', type: 'message', optional: true, description: 'One typed conversation entry' },
    { name: 'userMessage', type: 'string', optional: true, description: 'Voiced user message' },
    { name: 'response', type: 'any', optional: true, description: 'Assistant response' },
    { name: 'taskLifecycle', type: 'object', optional: true, description: 'Existing task owner lifecycle decision attached to an assistant result' },
    { name: 'metadata', type: 'object', optional: true, description: 'Origin metadata attached to the assistant response' },
    { name: 'responseBufferId', type: 'string', optional: true, description: 'Pass-through response-buffer ID' },
    { name: 'passthrough', type: 'any', optional: true, description: 'Data forwarded after conversation admission for graph sequencing' },
  ],
  outputs: [
    { name: 'persisted', type: 'boolean' },
    { name: 'skipped', type: 'boolean' },
    { name: 'messageCount', type: 'number' },
    { name: 'entry', type: 'message', optional: true, description: 'First exact entry retained by the buffer' },
    { name: 'entries', type: 'array', description: 'Exact entries retained by the buffer for downstream long-term saving' },
    { name: 'bufferPath', type: 'string' },
    { name: 'response', type: 'string' },
    { name: 'responseBufferId', type: 'string' },
    { name: 'passthrough', type: 'any' },
  ],
  description: 'Validates and persists voiced user/assistant entries to the canonical Conversation Buffer.',
  execute,
});
