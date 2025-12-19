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
    { name: 'persona', type: 'object', optional: true, description: 'Persona data (identity, personality, values, goals)' },
  ],
  outputs: [
    { name: 'context', type: 'context', description: 'Unified context package (includes persona)' },
    { name: 'unknownSignal', type: 'boolean', description: 'Whether to respond "I don\'t know"' },
    { name: 'iteration', type: 'number', description: 'Current iteration number' },
    { name: 'persona', type: 'object', description: 'Passthrough persona for downstream nodes (Quality Scorer)' },
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
    // Named inputs from graph edges (with array index fallbacks for backwards compatibility)
    // Expected inputs: conversationHistory, cognitiveMode, memories, searchInterpretation
    const queryInput = inputs.query || inputs[0] || context.userMessage || '';
    const modeInput = inputs.cognitiveMode || inputs.mode || inputs[1] || context.cognitiveMode || 'dual';
    const memoriesInput = inputs.memories || inputs[2];
    const conversationHistoryInput = inputs.conversationHistory || inputs[3];
    const searchInterpretation = inputs.searchInterpretation || inputs[4] || null;
    const feedbackContext = inputs.feedbackContext || inputs[5] || null;
    const personaInput = inputs.persona || inputs[6] || null;

    // Handle query - might be a string or object
    const query = typeof queryInput === 'string' ? queryInput : (queryInput?.message || context.userMessage || '');
    const mode = typeof modeInput === 'string' ? modeInput : 'dual';

    // Extract unknownSignal from search interpretation
    const unknownSignal = searchInterpretation?.unknownSignal ?? false;
    const interpretation = searchInterpretation?.interpretation ?? '';
    const rejectedCount = searchInterpretation?.rejectedCount ?? 0;

    // Extract memories - prefer relevantMemories from search interpreter, fall back to direct memories input
    const interpretedMemories = searchInterpretation?.relevantMemories || [];
    const directMemories = Array.isArray(memoriesInput) ? memoriesInput : (memoriesInput?.memories || memoriesInput?.relevantMemories || []);
    const fallbackMemories = interpretedMemories.length > 0 ? interpretedMemories : directMemories;
    const memories = context.contextPackage?.memories || fallbackMemories;

    // Conversation history - from input or context
    const conversationHistory = context.contextPackage?.conversationHistory ||
      (Array.isArray(conversationHistoryInput) ? conversationHistoryInput : conversationHistoryInput?.messages) ||
      context.conversationHistory || [];

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

    // Extract persona data if provided
    const persona = personaInput || context.persona || null;

    // Build context payload
    const contextPayload: Record<string, any> = context.contextPackage
      ? { ...context.contextPackage, query, mode, memories, persona }
      : {
          query,
          mode,
          memories,
          conversationHistory,
          persona,
          timestamp: new Date().toISOString(),
        };

    // Add iterative refinement context
    contextPayload.unknownSignal = unknownSignal;
    contextPayload.interpretation = interpretation;
    contextPayload.iteration = currentIteration;

    if (scratchpad) {
      contextPayload.scratchpad = scratchpad;
    }

    // Pass through feedback from previous iteration (if any)
    // This tells Response Synthesizer what was wrong with the previous attempt
    if (feedbackContext) {
      contextPayload.feedbackContext = {
        iteration: feedbackContext.iteration,
        feedbackType: feedbackContext.feedbackType,
        specificFeedback: feedbackContext.specificFeedback,
        previousAttempts: feedbackContext.previousAttempts,
      };
    }

    if (context.contextInfo) {
      contextPayload.contextText = context.contextInfo;
    }

    return {
      context: contextPayload,
      unknownSignal,
      iteration: currentIteration,
      persona, // Passthrough for Quality Scorer
    };
  },
});
