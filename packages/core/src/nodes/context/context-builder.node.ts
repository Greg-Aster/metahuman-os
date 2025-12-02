/**
 * Context Builder Node
 *
 * Combines multiple context sources into unified context package
 */

import { defineNode, type NodeDefinition } from '../types.js';

export const ContextBuilderNode: NodeDefinition = defineNode({
  id: 'context_builder',
  name: 'Context Builder',
  category: 'context',
  inputs: [
    { name: 'query', type: 'string', description: 'User query/message' },
    { name: 'mode', type: 'cognitiveMode', optional: true, description: 'Cognitive mode' },
    { name: 'memories', type: 'array', optional: true, description: 'Relevant memories' },
    { name: 'conversationHistory', type: 'array', optional: true, description: 'Conversation history' },
  ],
  outputs: [
    { name: 'context', type: 'context', description: 'Unified context package' },
  ],
  description: 'Combines multiple context sources into unified context',

  execute: async (inputs, context) => {
    const query = inputs[0] || inputs[2]?.message || context.userMessage || '';
    const mode = inputs[1] || context.cognitiveMode || 'dual';
    const fallbackMemories = inputs[2]?.memories || inputs[1]?.memories || [];
    const memories = context.contextPackage?.memories || fallbackMemories;
    const conversationHistory = context.contextPackage?.conversationHistory || inputs[3]?.messages || context.conversationHistory || [];

    const contextPayload = context.contextPackage
      ? { ...context.contextPackage, query, mode }
      : {
          query,
          mode,
          memories,
          conversationHistory,
          timestamp: new Date().toISOString(),
        };

    if (context.contextInfo) {
      contextPayload.contextText = context.contextInfo;
    }

    return {
      context: contextPayload,
    };
  },
});
