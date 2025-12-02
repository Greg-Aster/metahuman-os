/**
 * Reflector LLM Node
 *
 * Generates reflections/summaries with custom prompts
 * Used by reflector agent for inner dialogue
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { callLLM } from '../../model-router.js';

export const ReflectorLLMNode: NodeDefinition = defineNode({
  id: 'reflector_llm',
  name: 'Reflector LLM',
  category: 'chat',
  inputs: [
    { name: 'prompt', type: 'string', description: 'User prompt or reflection text' },
  ],
  outputs: [
    { name: 'response', type: 'llm_response', description: 'Generated reflection' },
  ],
  properties: {
    systemPrompt: '',
    role: 'persona',
    temperature: 0.7,
    maxTokens: 2048,
  },
  propertySchemas: {
    systemPrompt: {
      type: 'text_multiline',
      default: '',
      label: 'System Prompt',
      description: 'Custom system prompt for reflection',
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
      default: 0.7,
      label: 'Temperature',
      min: 0,
      max: 1,
      step: 0.1,
    },
    maxTokens: {
      type: 'slider',
      default: 2048,
      label: 'Max Tokens',
      min: 256,
      max: 4096,
      step: 256,
    },
  },
  description: 'Generates reflections/summaries with custom prompts',

  execute: async (inputs, context, properties) => {
    let userPrompt = typeof inputs[0] === 'string' ? inputs[0] : inputs[0]?.text || inputs[0]?.prompt || inputs[0]?.response || '';
    let systemPrompt = properties?.systemPrompt || '';
    const role = properties?.role || 'persona';
    const temperature = properties?.temperature || 0.7;

    if (userPrompt && userPrompt.trim().length > 0 && role === 'summarizer') {
      const reflection = userPrompt;
      const conciseHint = context.conciseHint || 'Keep it concise.';

      if (temperature >= 0.4) {
        userPrompt = `Here is the full reflection:\n${reflection}\n\nCompose an extended conclusion (2–3 sentences, <= 120 words) that captures the essence and next steps.`;
        systemPrompt = systemPrompt || `You are consolidating a reflective train of thought into a coherent conclusion.\nWrite in the first person.\nUse two or three sentences (<= 120 words) to capture the main insight, emotional tone, and any next step.`;
      } else {
        userPrompt = `Here is the reflection:\n${reflection}\n\nSummarize the core takeaway. ${conciseHint}`;
        systemPrompt = systemPrompt || `You distill reflections into concise first-person takeaways.\n${conciseHint}`;
      }
    } else if (!userPrompt || userPrompt.trim().length === 0) {
      if (context.reflectionPrompt) {
        userPrompt = context.reflectionPrompt;
        systemPrompt = systemPrompt || context.reflectionSystemPrompt || '';
      }
    }

    if (!userPrompt || userPrompt.trim().length === 0) {
      return { response: '', error: 'No prompt provided' };
    }

    if (!systemPrompt || systemPrompt.trim().length === 0) {
      systemPrompt = 'You are an introspective assistant.';
    }

    try {
      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userPrompt },
      ];

      const response = await callLLM({
        role,
        messages,
        cognitiveMode: context.cognitiveMode,
        options: {
          maxTokens: properties?.maxTokens || 2048,
          repeatPenalty: properties?.repeatPenalty || 1.15,
          temperature,
        },
        onProgress: context.emitProgress,
      });

      return { response: response.content };
    } catch (error) {
      console.error('[ReflectorLLM] Error:', error);
      return { response: '', error: (error as Error).message };
    }
  },
});
