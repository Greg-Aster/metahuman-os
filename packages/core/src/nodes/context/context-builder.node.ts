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
    // Debug: log inputs
    console.log('[context_builder] DEBUG inputs keys:', Object.keys(inputs));
    console.log('[context_builder] DEBUG inputs[0] type:', typeof inputs[0], inputs[0] ? Object.keys(inputs[0]) : 'null');

    // Handle flexible input wiring - memories can come from slot 0 (from memory_router) or slot 2
    const slot0 = inputs[0];
    const isSlot0Memories = slot0 && (Array.isArray(slot0) || slot0.memories);

    console.log('[context_builder] DEBUG isSlot0Memories:', isSlot0Memories);
    console.log('[context_builder] DEBUG slot0?.memories length:', slot0?.memories?.length);

    const query = isSlot0Memories
      ? (context.userMessage || '')
      : (slot0 || inputs[2]?.message || context.userMessage || '');
    const mode = inputs[1] || context.cognitiveMode || 'dual';

    // Extract memories from various possible input locations
    const memoriesFromSlot0 = Array.isArray(slot0) ? slot0 : (slot0?.memories || []);
    const memoriesFromSlot2 = inputs[2]?.memories || [];
    const fallbackMemories = memoriesFromSlot0.length > 0 ? memoriesFromSlot0 : memoriesFromSlot2;
    const memories = context.contextPackage?.memories || fallbackMemories;

    console.log('[context_builder] DEBUG memoriesFromSlot0:', memoriesFromSlot0.length);
    console.log('[context_builder] DEBUG final memories:', memories.length);
    const conversationHistory = context.contextPackage?.conversationHistory || inputs[3]?.messages || context.conversationHistory || [];

    // Always include memories in the context payload - this is the critical fix
    // The memories extracted from slot0 (memory_router output) must be passed through
    const contextPayload = context.contextPackage
      ? { ...context.contextPackage, query, mode, memories }
      : {
          query,
          mode,
          memories,
          conversationHistory,
          timestamp: new Date().toISOString(),
        };

    console.log('[context_builder] DEBUG contextPayload.memories count:', contextPayload.memories?.length || 0);

    if (context.contextInfo) {
      contextPayload.contextText = context.contextInfo;
    }

    return {
      context: contextPayload,
    };
  },
});
