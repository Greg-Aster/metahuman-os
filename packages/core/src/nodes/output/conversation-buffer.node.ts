/**
 * Conversation Buffer Node
 *
 * The only graph node allowed to persist voiced Conversation Buffer entries.
 */

import {
  getBufferPathForUser,
  writeBufferEntry,
  writeConversationBufferSummary,
  type ConversationMessage,
} from '../../conversation-buffer.js';
import { defineNode, type NodeExecutor } from '../types.js';

function assistantResponseText(inputs: Record<string, any>, context: Record<string, any>): string {
  const explicitEntry = inputs.entry ?? context.bufferEntry;
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
  const assistantResponse = assistantResponseText(inputs, context);
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
      reason: 'No authenticated username',
      response: assistantResponse,
      responseBufferId: inputs.responseBufferId || '',
      passthrough,
    };
  }

  if (context.composeTarget === 'inner' && !context.bufferEntry) {
    return {
      persisted: false,
      skipped: true,
      reason: 'Inner compose turn is owned by the Inner Dialogue Buffer node',
      bufferPath: getBufferPathForUser(username, 'conversation'),
      response: assistantResponse,
      responseBufferId: inputs.responseBufferId || '',
      passthrough,
    };
  }

  const summary = inputs.summary ?? context.bufferSummary;
  if (summary && typeof summary === 'object') {
    const persisted = await writeConversationBufferSummary(username, {
      sessionId: String(summary.sessionId || ''),
      content: String(summary.content || ''),
      messageCount: Number(summary.messageCount || 0),
    });
    return {
      persisted,
      skipped: !persisted,
      messageCount: 0,
      bufferPath: getBufferPathForUser(username, 'conversation'),
      response: '',
      responseBufferId: '',
      passthrough,
    };
  }

  const explicitEntry = inputs.entry ?? context.bufferEntry;
  const entries: Array<Pick<ConversationMessage, 'role' | 'content' | 'meta'>> = [];
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
      : typeof context.userMessage === 'string'
        ? context.userMessage.trim()
        : '';
    if (userText && context.userMessageAdmitted !== true) {
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
  let persistedCount = 0;
  for (const entry of entries) {
    if (!allowedRoles.has(entry.role) || typeof entry.content !== 'string' || !entry.content.trim()) {
      continue;
    }
    if (await writeBufferEntry(username, 'conversation', {
      role: entry.role,
      content: entry.content.trim(),
      meta: entry.meta,
    })) {
      persistedCount++;
    }
  }

  return {
    persisted: persistedCount > 0,
    skipped: persistedCount === 0,
    messageCount: persistedCount,
    bufferPath: getBufferPathForUser(username, 'conversation'),
    response: entries.find(entry => entry.role === 'assistant')?.content || assistantResponse,
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
    { name: 'conversationHistory', type: 'array', optional: true, description: 'Legacy history edge; persistence does not derive ownership from it' },
    { name: 'taskLifecycle', type: 'object', optional: true, description: 'Existing task owner lifecycle decision attached to an assistant result' },
    { name: 'metadata', type: 'object', optional: true, description: 'Origin metadata attached to the assistant response' },
    { name: 'responseBufferId', type: 'string', optional: true, description: 'Pass-through response-buffer ID' },
    { name: 'summary', type: 'object', optional: true, description: 'Conversation summary marker' },
    { name: 'passthrough', type: 'any', optional: true, description: 'Data forwarded after conversation admission for graph sequencing' },
  ],
  outputs: [
    { name: 'persisted', type: 'boolean' },
    { name: 'skipped', type: 'boolean' },
    { name: 'messageCount', type: 'number' },
    { name: 'bufferPath', type: 'string' },
    { name: 'response', type: 'string' },
    { name: 'responseBufferId', type: 'string' },
    { name: 'passthrough', type: 'any' },
  ],
  description: 'Validates and persists voiced user/assistant entries to the canonical Conversation Buffer.',
  execute,
});
