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
  inputs: [
    { name: 'sessionId', type: 'string', description: 'Session ID to load context for' },
  ],
  outputs: [
    { name: 'conversationHistory', type: 'array', description: 'Recent conversation messages' },
    { name: 'user', type: 'object', description: 'Current user object' },
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
