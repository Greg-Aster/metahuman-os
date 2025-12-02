/**
 * Orchestrator LLM Node
 *
 * Lightweight intent analysis for routing decisions
 * Determines memory needs, response style, and instructions
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { callLLM } from '../../model-router.js';

export const OrchestratorLLMNode: NodeDefinition = defineNode({
  id: 'orchestrator_llm',
  name: 'Orchestrator LLM',
  category: 'chat',
  inputs: [
    { name: 'message', type: 'string', description: 'User message to analyze' },
  ],
  outputs: [
    { name: 'needsMemory', type: 'boolean', description: 'Whether memory search is needed' },
    { name: 'memoryTier', type: 'string', description: 'Memory tier to search' },
    { name: 'memoryQuery', type: 'string', description: 'Optimized search query' },
    { name: 'responseStyle', type: 'string', description: 'Suggested response style' },
    { name: 'instructions', type: 'string', description: 'Instructions for persona' },
  ],
  description: 'Lightweight intent analysis for routing decisions',

  execute: async (inputs, context) => {
    const inputData = inputs[0];
    const userMessage = typeof inputData === 'string'
      ? inputData
      : (inputData?.message || context.userMessage || '');

    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
      return {
        needsMemory: false,
        memoryTier: 'hot',
        memoryQuery: '',
        responseStyle: 'conversational',
        instructions: 'Respond naturally to the greeting.',
        error: 'No user message provided',
      };
    }

    try {
      const systemPrompt = `You are the Intent Orchestrator for a personal AI memory system. Analyze queries and route them through a tiered memory architecture.

## OUTPUT FORMAT
Respond with JSON only:
{
  "needsMemory": boolean,
  "memoryTier": "hot" | "warm" | "cold" | "facts" | "all",
  "memoryQuery": "optimized search query if different from input",
  "responseStyle": "verbose" | "concise" | "conversational",
  "instructions": "guidance for persona"
}

## MEMORY TIERS
- "hot": Last 14 days (recent events, current projects)
- "warm": 2 weeks to 3 months (medium-term context)
- "cold": 3+ months (long-term history)
- "facts": Timeless identity info (possessions, relationships, preferences)
- "all": When timeframe is unclear`;

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: `Analyze: "${userMessage}"` },
      ];

      const response = await callLLM({
        role: 'orchestrator',
        messages,
        cognitiveMode: context.cognitiveMode,
        options: {
          maxTokens: 512,
          repeatPenalty: 1.15,
          temperature: 0.2,
        },
        onProgress: context.emitProgress,
      });

      try {
        const parsed = JSON.parse(response.content);
        return {
          needsMemory: parsed.needsMemory || false,
          memoryTier: parsed.memoryTier || 'hot',
          memoryQuery: parsed.memoryQuery || '',
          responseStyle: parsed.responseStyle || 'conversational',
          instructions: parsed.instructions || 'Respond naturally',
          raw: response.content,
        };
      } catch {
        const needsMemoryMatch = response.content.match(/needsMemory[":]\s*(true|false)/i);
        const tierMatch = response.content.match(/memoryTier[":]\s*["']?(hot|warm|cold|facts|all)/i);
        return {
          needsMemory: needsMemoryMatch?.[1]?.toLowerCase() === 'true' || false,
          memoryTier: tierMatch?.[1]?.toLowerCase() || 'hot',
          memoryQuery: '',
          responseStyle: 'conversational',
          instructions: 'Respond naturally',
          raw: response.content,
        };
      }
    } catch (error) {
      console.error('[OrchestratorLLM] Error:', error);
      return {
        needsMemory: false,
        memoryTier: 'hot',
        memoryQuery: '',
        responseStyle: 'conversational',
        instructions: 'Respond naturally to the user',
        error: (error as Error).message,
      };
    }
  },
});
