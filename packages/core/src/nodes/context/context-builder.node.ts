/**
 * Context Builder Node
 *
 * Combines multiple context sources into unified context package.
 * Supports iterative refinement via scratchpad mode.
 *
 * Key capabilities:
 * - Aggregates memories, conversation history, and system context
 * - Tracks iteration state for feedback loops
 * - Passes through unknownSignal from search interpreter
 * - Accumulates rejected interpretations for context
 */

import { defineNode, type NodeDefinition } from '../types.js';

interface ScratchpadState {
  iteration: number;
  previousAttempts: Array<{
    response?: string;
    qualityScore?: number;
    issues?: string[];
  }>;
  rejectedMemories: Array<{
    content: string;
    reason: string;
  }>;
}

export const ContextBuilderNode: NodeDefinition = defineNode({
  id: 'context_builder',
  name: 'Context Builder',
  category: 'context',
  inputs: [
    { name: 'query', type: 'string', description: 'User query/message' },
    { name: 'mode', type: 'cognitiveMode', optional: true, description: 'Cognitive mode' },
    { name: 'memories', type: 'array', optional: true, description: 'Relevant memories' },
    { name: 'conversationHistory', type: 'array', optional: true, description: 'Conversation history' },
    { name: 'searchInterpretation', type: 'object', optional: true, description: 'Search interpreter result (unknownSignal, interpretation)' },
    { name: 'feedbackContext', type: 'object', optional: true, description: 'Feedback from previous iteration' },
  ],
  outputs: [
    { name: 'context', type: 'context', description: 'Unified context package' },
    { name: 'unknownSignal', type: 'boolean', description: 'Whether to respond "I don\'t know"' },
    { name: 'iteration', type: 'number', description: 'Current iteration number' },
  ],
  properties: {
    scratchpadMode: false,
    maxRejectedMemories: 5,
  },
  propertySchemas: {
    scratchpadMode: {
      type: 'toggle',
      default: false,
      label: 'Scratchpad Mode',
    },
    maxRejectedMemories: {
      type: 'slider',
      default: 5,
      label: 'Max Rejected Memories',
      min: 0,
      max: 10,
      step: 1,
    },
  },
  description: 'Combines multiple context sources into unified context with iteration tracking',

  execute: async (inputs, context, properties) => {
    // Debug: log inputs
    console.log('[context_builder] DEBUG inputs keys:', Object.keys(inputs));
    console.log('[context_builder] DEBUG inputs[0] type:', typeof inputs[0], inputs[0] ? Object.keys(inputs[0]) : 'null');

    // Handle flexible input wiring - memories can come from slot 0 (from memory_router) or slot 2
    const slot0 = inputs[0];
    const isSlot0Memories = slot0 && (Array.isArray(slot0) || slot0.memories || slot0.relevantMemories);

    console.log('[context_builder] DEBUG isSlot0Memories:', isSlot0Memories);
    console.log('[context_builder] DEBUG slot0?.memories length:', slot0?.memories?.length);

    const query = isSlot0Memories
      ? (context.userMessage || '')
      : (slot0 || inputs[2]?.message || context.userMessage || '');
    const mode = inputs[1] || context.cognitiveMode || 'dual';

    // Extract search interpretation result (from search_interpreter node)
    const searchInterpretation = inputs[4] || inputs.searchInterpretation || null;
    const feedbackContext = inputs[5] || inputs.feedbackContext || null;

    // Extract unknownSignal from search interpretation
    const unknownSignal = searchInterpretation?.unknownSignal ?? false;
    const interpretation = searchInterpretation?.interpretation ?? '';
    const rejectedCount = searchInterpretation?.rejectedCount ?? 0;

    // Extract memories - prefer relevantMemories from search interpreter, fall back to raw memories
    const interpretedMemories = searchInterpretation?.relevantMemories || [];
    const memoriesFromSlot0 = Array.isArray(slot0) ? slot0 : (slot0?.memories || slot0?.relevantMemories || []);
    const memoriesFromSlot2 = inputs[2]?.memories || [];
    const fallbackMemories = interpretedMemories.length > 0 ? interpretedMemories : (memoriesFromSlot0.length > 0 ? memoriesFromSlot0 : memoriesFromSlot2);
    const memories = context.contextPackage?.memories || fallbackMemories;

    console.log('[context_builder] DEBUG memoriesFromSlot0:', memoriesFromSlot0.length);
    console.log('[context_builder] DEBUG interpretedMemories:', interpretedMemories.length);
    console.log('[context_builder] DEBUG final memories:', memories.length);
    console.log('[context_builder] DEBUG unknownSignal:', unknownSignal);
    const conversationHistory = context.contextPackage?.conversationHistory || inputs[3]?.messages || context.conversationHistory || [];

    // Scratchpad state for iterative refinement
    const scratchpadMode = properties?.scratchpadMode ?? false;
    const maxRejectedMemories = properties?.maxRejectedMemories ?? 5;
    const currentIteration = feedbackContext?.iteration ?? 1;

    let scratchpad: ScratchpadState | null = null;
    if (scratchpadMode || feedbackContext) {
      scratchpad = {
        iteration: currentIteration,
        previousAttempts: feedbackContext?.previousAttempts ?? [],
        rejectedMemories: [],
      };

      // Track rejected memories for context if search interpreter provided them
      if (searchInterpretation && rejectedCount > 0) {
        // Note: We don't have the full rejected list, but we track the count
        scratchpad.rejectedMemories = [];
      }
    }

    // Build context payload
    const contextPayload: Record<string, any> = context.contextPackage
      ? { ...context.contextPackage, query, mode, memories }
      : {
          query,
          mode,
          memories,
          conversationHistory,
          timestamp: new Date().toISOString(),
        };

    // Add iterative refinement context
    contextPayload.unknownSignal = unknownSignal;
    contextPayload.interpretation = interpretation;
    contextPayload.iteration = currentIteration;

    if (scratchpad) {
      contextPayload.scratchpad = scratchpad;
    }

    // Add context guidance for persona based on unknownSignal
    if (unknownSignal) {
      contextPayload.contextGuidance = 'No relevant memories found. Respond honestly that you don\'t know or don\'t have information about this topic.';
    } else if (memories.length > 0) {
      contextPayload.contextGuidance = `Found ${memories.length} relevant memories. Base your response on these memories.`;
    }

    console.log('[context_builder] DEBUG contextPayload.memories count:', contextPayload.memories?.length || 0);
    console.log('[context_builder] DEBUG contextPayload.unknownSignal:', contextPayload.unknownSignal);

    if (context.contextInfo) {
      contextPayload.contextText = context.contextInfo;
    }

    return {
      context: contextPayload,
      unknownSignal,
      iteration: currentIteration,
    };
  },
});
