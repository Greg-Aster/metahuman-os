/**
 * Session Context Node
 *
 * Provides conversation history and user context
 */

import { defineNode, type NodeDefinition } from '../types.js';

export const SessionContextNode: NodeDefinition = defineNode({
  id: 'session_context',
  name: 'Session Context',
  category: 'context',
  inputs: [],
  outputs: [
    { name: 'conversationHistory', type: 'array', description: 'Conversation history messages' },
    { name: 'user', type: 'user', description: 'User object' },
    { name: 'sessionId', type: 'string', description: 'Current session ID' },
  ],
  description: 'Provides conversation history and user context',

  execute: async (inputs, context) => {
    return {
      conversationHistory: context.conversationHistory || [],
      user: context.user || {
        id: context.userId || 'anonymous',
        username: context.username || 'user',
        role: context.userRole || 'user',
      },
      sessionId: context.sessionId,
    };
  },
});
