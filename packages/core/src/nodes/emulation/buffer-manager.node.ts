/**
 * Buffer Manager Node
 * Persists conversation buffer to disk
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import {
  appendToUserBuffer,
  getBufferPathForUser,
  type ConversationBufferMode,
} from '../../conversation-buffer.js';

function resolveMode(value: unknown): ConversationBufferMode {
  return value === 'inner' || value === 'system' ? value : 'conversation';
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  const mode = resolveMode(context.mode || context.dialogueType);
  const sessionId = context.sessionId;
  const username = context.username;
  const explicitUserMessage = inputs.userMessage;
  const userMessage = typeof explicitUserMessage === 'string'
    ? explicitUserMessage.trim()
    : typeof context.userMessage === 'string'
      ? context.userMessage.trim()
      : '';

  if (!username) {
    return {
      persisted: false,
      error: 'No username in context',
    };
  }

  try {
    // Get response from named input first, then positional fallback
    const rawResponse = inputs.response ?? inputs[2] ?? inputs[1];
    const assistantResponse = typeof rawResponse === 'string'
      ? rawResponse
      : rawResponse?.response || rawResponse?.content || rawResponse?.text || rawResponse;
    const responseText = typeof assistantResponse === 'string' ? assistantResponse.trim() : '';

    console.log('[BufferManager] Received response:', responseText ? `${responseText.substring(0, 50)}...` : 'none');

    if (properties?.requireUserMessage === true && !userMessage) {
      return {
        persisted: false,
        reason: 'No conversational user message',
        mode,
        messageCount: 0,
        sessionId,
        bufferPath: getBufferPathForUser(username, mode),
      };
    }

    const historyInput = inputs.conversationHistory;
    const existingMessages = Array.isArray(historyInput)
      ? historyInput
      : Array.isArray(historyInput?.messages)
        ? historyInput.messages
        : [];
    const lastMessage = existingMessages[existingMessages.length - 1];
    const userAlreadySaved = Boolean(
      userMessage
      && lastMessage?.role === 'user'
      && lastMessage?.content === userMessage,
    );
    let appendedCount = 0;

    if (userMessage && !userAlreadySaved) {
      const userMeta: Record<string, unknown> = {};
      if (context.replyToDesireId) userMeta.replyToDesireId = context.replyToDesireId;
      if (context.replyToDesireTitle) userMeta.replyToDesireTitle = context.replyToDesireTitle;
      if (context.replyToQuestionId) userMeta.replyToQuestionId = context.replyToQuestionId;
      if (context.replyToContent) userMeta.replyToContent = context.replyToContent;
      if (context.cognitiveMode) userMeta.cognitiveMode = context.cognitiveMode;
      if (sessionId) userMeta.sessionId = sessionId;

      if (await appendToUserBuffer(username, mode, {
        role: 'user',
        content: userMessage,
        meta: Object.keys(userMeta).length > 0 ? userMeta : undefined,
      })) {
        appendedCount++;
      }
    } else if (userAlreadySaved) {
      console.log('[BufferManager] User message already saved, skipping duplicate');
    }

    if (responseText) {
      const assistantMeta: Record<string, unknown> = {};
      if (context.replyToDesireId) assistantMeta.replyToDesireId = context.replyToDesireId;
      if (context.replyToDesireTitle) assistantMeta.replyToDesireTitle = context.replyToDesireTitle;
      if (context.cognitiveMode) assistantMeta.cognitiveMode = context.cognitiveMode;
      if (sessionId) assistantMeta.sessionId = sessionId;

      if (await appendToUserBuffer(username, mode, {
        role: 'assistant',
        content: responseText,
        meta: Object.keys(assistantMeta).length > 0 ? assistantMeta : undefined,
      })) {
        appendedCount++;
      }
    }

    return {
      persisted: appendedCount > 0,
      mode,
      messageCount: existingMessages.length + appendedCount,
      sessionId,
      bufferPath: getBufferPathForUser(username, mode),
    };
  } catch (error) {
    console.error('[BufferManager] Error:', error);
    return {
      persisted: false,
      error: (error as Error).message,
    };
  }
};

export const BufferManagerNode: NodeDefinition = defineNode({
  id: 'buffer_manager',
  name: 'Buffer Manager',
  category: 'emulation',
  inputs: [
    { name: 'conversationHistory', type: 'array', optional: true, description: 'Conversation history' },
    { name: 'userMessage', type: 'string', optional: true, description: 'Current user message (defaults to execution context)' },
    { name: 'response', type: 'any', optional: true, description: 'Assistant response' },
  ],
  outputs: [
    { name: 'persisted', type: 'boolean' },
    { name: 'messageCount', type: 'number' },
    { name: 'bufferPath', type: 'string' },
  ],
  properties: {
    requireUserMessage: false,
  },
  propertySchemas: {
    requireUserMessage: {
      type: 'toggle',
      default: false,
      label: 'Require User Message',
      description: 'Skip persistence when the execution was not triggered by conversational user text.',
    },
  },
  description: 'Persists conversation buffer to disk',
  execute,
});
