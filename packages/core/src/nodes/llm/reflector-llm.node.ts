/**
 * Reflector LLM Node
 *
 * Generates reflections/summaries with custom prompts
 * Used by reflector agent for inner dialogue
 */

import { defineNode, type NodeDefinition } from '../types.js';
import { callLLM } from '../../model-router.js';
import { renderPromptTemplate } from '../prompt-template.js';

const DEFAULT_FALLBACK_SYSTEM_PROMPT = 'You are an introspective assistant.';
const DEFAULT_EXTENDED_SUMMARY_SYSTEM_PROMPT = `You are consolidating a reflective train of thought into a coherent conclusion.
Write in the first person.
Use two or three sentences (<= 120 words) to capture the main insight, emotional tone, and any next step.`;
const DEFAULT_EXTENDED_SUMMARY_USER_TEMPLATE = `Here is the full reflection:
{{reflection}}

Compose an extended conclusion (2-3 sentences, <= 120 words) that captures the essence and next steps.`;
const DEFAULT_CONCISE_SUMMARY_SYSTEM_TEMPLATE = `You distill reflections into concise first-person takeaways.
{{conciseHint}}`;
const DEFAULT_CONCISE_SUMMARY_USER_TEMPLATE = `Here is the reflection:
{{reflection}}

Summarize the core takeaway. {{conciseHint}}`;

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
    fallbackSystemPrompt: DEFAULT_FALLBACK_SYSTEM_PROMPT,
    extendedSummarySystemPrompt: DEFAULT_EXTENDED_SUMMARY_SYSTEM_PROMPT,
    extendedSummaryUserTemplate: DEFAULT_EXTENDED_SUMMARY_USER_TEMPLATE,
    conciseSummarySystemTemplate: DEFAULT_CONCISE_SUMMARY_SYSTEM_TEMPLATE,
    conciseSummaryUserTemplate: DEFAULT_CONCISE_SUMMARY_USER_TEMPLATE,
    role: 'persona',
    temperature: 0.7,
    maxTokens: 2048,
    repeatPenalty: 1.15,
  },
  propertySchemas: {
    systemPrompt: {
      type: 'text_multiline',
      default: '',
      label: 'System Prompt',
      description: 'Custom system prompt for reflection',
      rows: 4,
    },
    fallbackSystemPrompt: {
      type: 'text_multiline',
      default: DEFAULT_FALLBACK_SYSTEM_PROMPT,
      label: 'Fallback System Prompt',
      rows: 3,
    },
    extendedSummarySystemPrompt: {
      type: 'text_multiline',
      default: DEFAULT_EXTENDED_SUMMARY_SYSTEM_PROMPT,
      label: 'Extended Summary System Prompt',
      rows: 5,
    },
    extendedSummaryUserTemplate: {
      type: 'text_multiline',
      default: DEFAULT_EXTENDED_SUMMARY_USER_TEMPLATE,
      label: 'Extended Summary User Template',
      description: 'Template variables: {{reflection}}.',
      rows: 7,
    },
    conciseSummarySystemTemplate: {
      type: 'text_multiline',
      default: DEFAULT_CONCISE_SUMMARY_SYSTEM_TEMPLATE,
      label: 'Concise Summary System Template',
      description: 'Template variables: {{conciseHint}}.',
      rows: 4,
    },
    conciseSummaryUserTemplate: {
      type: 'text_multiline',
      default: DEFAULT_CONCISE_SUMMARY_USER_TEMPLATE,
      label: 'Concise Summary User Template',
      description: 'Template variables: {{reflection}}, {{conciseHint}}.',
      rows: 6,
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
    repeatPenalty: {
      type: 'number',
      default: 1.15,
      label: 'Repeat Penalty',
    },
  },
  description: 'Generates reflections/summaries with custom prompts',

  execute: async (inputs, context, properties) => {
    const promptInput = inputs.prompt ?? inputs[0];
    let userPrompt = typeof promptInput === 'string' ? promptInput : promptInput?.text || promptInput?.prompt || promptInput?.response || '';
    let systemPrompt = properties?.systemPrompt ?? '';
    const role = properties?.role ?? 'persona';
    const temperature = properties?.temperature ?? 0.7;
    const maxTokens = properties?.maxTokens ?? 2048;
    const repeatPenalty = properties?.repeatPenalty ?? 1.15;
    const username = context.userId || context.username;

    if (userPrompt && userPrompt.trim().length > 0 && role === 'summarizer') {
      const reflection = userPrompt;
      const conciseHint = context.conciseHint || 'Keep it concise.';

      if (temperature >= 0.4) {
        userPrompt = renderPromptTemplate(properties?.extendedSummaryUserTemplate ?? DEFAULT_EXTENDED_SUMMARY_USER_TEMPLATE, { reflection });
        systemPrompt = systemPrompt || (properties?.extendedSummarySystemPrompt ?? DEFAULT_EXTENDED_SUMMARY_SYSTEM_PROMPT);
      } else {
        userPrompt = renderPromptTemplate(properties?.conciseSummaryUserTemplate ?? DEFAULT_CONCISE_SUMMARY_USER_TEMPLATE, { reflection, conciseHint });
        systemPrompt = systemPrompt || renderPromptTemplate(
          properties?.conciseSummarySystemTemplate ?? DEFAULT_CONCISE_SUMMARY_SYSTEM_TEMPLATE,
          { conciseHint },
        );
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
      systemPrompt = properties?.fallbackSystemPrompt ?? DEFAULT_FALLBACK_SYSTEM_PROMPT;
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
