/**
 * Reflector LLM Node
 *
 * Generates a reflection from graph-owned persona and memory prompts
 * Used by reflector agent for inner dialogue
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { callLLM } from '../../model-router.js';

export const ReflectorLLMNode: NodeDefinition = defineNode({
  id: 'reflector_llm',
  name: 'Reflector LLM',
  category: 'chat',
  inputs: [
    { name: 'systemPrompt', type: 'string', description: 'Persona-aware grounding instructions from the graph' },
    { name: 'prompt', type: 'string', description: 'Historical memory excerpts from the graph' },
  ],
  outputs: [
    { name: 'response', type: 'llm_response', description: 'Generated reflection' },
  ],
  properties: {
    systemPrompt: '',
    role: 'persona',
    temperature: 0.35,
    maxTokens: 384,
    repeatPenalty: 1.15,
  },
  propertySchemas: {
    systemPrompt: {
      type: 'text_multiline',
      default: '',
      label: 'System Prompt',
      description: 'Optional graph-level fallback; the connected prompt node is authoritative',
      rows: 4,
    },
    role: {
      type: 'select',
      default: 'persona',
      label: 'Model Role',
      options: ['persona', 'summarizer', 'fallback'],
    },
    temperature: {
      type: 'slider',
      default: 0.35,
      label: 'Temperature',
      min: 0,
      max: 1,
      step: 0.1,
    },
    maxTokens: {
      type: 'slider',
      default: 384,
      label: 'Max Tokens',
      min: 256,
      max: 4096,
      step: 256,
    },
    repeatPenalty: {
      type: 'number',
      default: 1.15,
      label: 'Repeat Penalty',
    },
  },
  description: 'Generates a reflection from graph-owned persona and historical-memory prompts',

  execute: async (inputs, context, properties) => {
    const promptInput = inputs.prompt ?? inputs[0];
    const systemPromptInput = inputs.systemPrompt;
    const userPrompt = typeof promptInput === 'string' ? promptInput : promptInput?.text || promptInput?.prompt || '';
    const systemPrompt = typeof systemPromptInput === 'string' && systemPromptInput.trim()
      ? systemPromptInput
      : properties?.systemPrompt ?? '';
    const role = properties?.role ?? 'persona';
    const temperature = properties?.temperature ?? 0.35;
    const maxTokens = properties?.maxTokens ?? 384;
    const repeatPenalty = properties?.repeatPenalty ?? 1.15;
    const username = context.userId || context.username;

    if (!userPrompt || userPrompt.trim().length === 0) {
      return { response: '', error: 'No prompt provided' };
    }

    if (!systemPrompt || systemPrompt.trim().length === 0) {
      return { response: '', error: 'No persona-aware system prompt provided' };
    }

    try {
      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userPrompt },
      ];

      const response = await callLLM({
        role,
        messages,
        userId: username,
        cognitiveMode: context.cognitiveMode,
        options: {
          maxTokens,
          repeatPenalty,
          temperature,
        },
        onProgress: context.emitProgress,
      });

      return {
        response: response.content,
        thinking: response.thinking, // Pass through reasoning for graph executor
      };
    } catch (error) {
      console.error('[ReflectorLLM] Error:', error);
      return { response: '', error: (error as Error).message };
    }
  },
});
