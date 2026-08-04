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

const execute: NodeExecutor = async (inputs, context, properties) => {
  const passthrough = inputs.passthrough ?? null;
  const username = typeof context.username === 'string'
    ? context.username.trim()
    : typeof context.userId === 'string'
      ? context.userId.trim()
      : '';

  if (!username || username === 'anonymous') {
    return { persisted: false, skipped: true, reason: 'No authenticated username', passthrough };
  }

  if (context.composeTarget === 'inner' && !context.bufferEntry) {
    return {
      persisted: false,
      skipped: true,
      reason: 'Inner compose turn is owned by the Inner Dialogue Buffer node',
      bufferPath: getBufferPathForUser(username, 'conversation'),
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
  if (properties?.explicitOnly === true && !explicitEntry) {
    return {
      persisted: false,
      skipped: true,
      reason: 'No explicit conversation entry',
      messageCount: 0,
      bufferPath: getBufferPathForUser(username, 'conversation'),
      response: '',
      responseBufferId: inputs.responseBufferId || '',
      passthrough,
    };
  }
  const entries: Array<Pick<ConversationMessage, 'role' | 'content' | 'meta'>> = [];
  if (explicitEntry && typeof explicitEntry === 'object') {
    entries.push(explicitEntry);
  } else {
    const userText = typeof inputs.userMessage === 'string'
      ? inputs.userMessage.trim()
      : typeof context.userMessage === 'string'
        ? context.userMessage.trim()
        : '';
    const rawResponse = inputs.response ?? inputs.assistantResponse;
    const responseText = typeof rawResponse === 'string'
      ? rawResponse.trim()
      : typeof rawResponse?.response === 'string'
        ? rawResponse.response.trim()
        : typeof rawResponse?.content === 'string'
          ? rawResponse.content.trim()
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
    if (responseText) {
      entries.push({
        role: 'assistant',
        content: responseText,
        meta: {
          ...(context.replyToDesireId ? { replyToDesireId: context.replyToDesireId } : {}),
          ...(context.replyToDesireTitle ? { replyToDesireTitle: context.replyToDesireTitle } : {}),
          ...(context.cognitiveMode ? { cognitiveMode: context.cognitiveMode } : {}),
          ...(context.sessionId ? { sessionId: context.sessionId } : {}),
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
    response: entries.find(entry => entry.role === 'assistant')?.content || '',
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
  properties: {
    explicitOnly: false,
  },
  propertySchemas: {
    explicitOnly: {
      type: 'toggle',
      default: false,
      label: 'Require Explicit Entry',
      description: 'Skip fallback user/assistant derivation when no typed entry is connected.',
    },
  },
  description: 'Validates and persists voiced user/assistant entries to the canonical Conversation Buffer.',
  execute,
});
