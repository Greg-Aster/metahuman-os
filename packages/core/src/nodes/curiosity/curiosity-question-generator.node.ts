/**
 * Curiosity Question Generator Node
 * Generates a natural, conversational curiosity question via LLM
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM, type RouterMessage } from '../../model-router.js';
import { renderPromptTemplate } from '../prompt-template.js';

const DEFAULT_SYSTEM_PROMPT_TEMPLATE = `{{personaPrompt}}

Looking back at these recent memories, you're genuinely curious about something. Ask the user ONE natural, conversational question that reflects your authentic curiosity.

Be yourself - ask in your own voice, not like an AI. Keep it under 20 words and make it feel like a real question you'd ask a friend.`;

const DEFAULT_USER_PROMPT_TEMPLATE = `Recent experiences you're reflecting on:
{{memoriesText}}

What are you genuinely curious about? Ask one natural question.`;

const execute: NodeExecutor = async (inputs, context, properties) => {
  // Access inputs by handle name, with fallback to indexed access
  const memoriesInput = inputs['memories'] || inputs.memories || inputs[0];
  const memories = Array.isArray(memoriesInput) ? memoriesInput : memoriesInput?.memories || [];
  const personaInput = inputs['personaPrompt'] || inputs.personaPrompt || inputs[1];
  const temperature = properties?.temperature || 0.6;
  const username = context.userId;

  if (!username) {
    return {
      question: '',
      error: 'No username in context'
    };
  }

  if (memories.length === 0) {
    return {
      question: '',
      error: 'No memories provided'
    };
  }

  try {
    const memoriesText = memories.map((m: any, i: number) => `${i + 1}. ${m.content}`).join('\n');
    const personaPrompt = personaInput?.formatted || personaInput || '';

    const promptValues = { personaPrompt, memoriesText };
    const systemPrompt = renderPromptTemplate(
      properties?.systemPrompt || DEFAULT_SYSTEM_PROMPT_TEMPLATE,
      promptValues,
    ).trim();
    const userPrompt = renderPromptTemplate(
      properties?.userPromptTemplate || DEFAULT_USER_PROMPT_TEMPLATE,
      promptValues,
    ).trim();

    const messages: RouterMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const response = await callLLM({
      role: 'persona',
      messages,
      userId: username,
      options: { temperature }
    });

    const question = response.content.trim();

    if (!question) {
      return {
        question: '',
        error: 'LLM returned empty question'
      };
    }

    return {
      question,
      rawQuestion: question,
      username,
      memoriesConsidered: memories.length
    };
  } catch (error) {
    // Ensure error is properly serialized (some errors are empty objects)
    const errMsg = error instanceof Error
      ? error.message
      : (typeof error === 'object' ? JSON.stringify(error) : String(error));
    console.error('[CuriosityQuestionGenerator] Error:', errMsg);
    return {
      question: '',
      error: errMsg || 'Unknown error',
      username
    };
  }
};

export const CuriosityQuestionGeneratorNode: NodeDefinition = defineNode({
  id: 'curiosity_question_generator',
  name: 'Curiosity Question Generator',
  category: 'curiosity',
  inputs: [
    { name: 'memories', type: 'array', description: 'Sampled memories' },
    { name: 'personaPrompt', type: 'string', optional: true, description: 'Formatted persona' },
  ],
  outputs: [
    { name: 'question', type: 'string', description: 'Generated question' },
    { name: 'rawQuestion', type: 'string' },
  ],
  properties: {
    temperature: 0.6,
    systemPrompt: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
    userPromptTemplate: DEFAULT_USER_PROMPT_TEMPLATE,
  },
  propertySchemas: {
    temperature: {
      type: 'number',
      default: 0.6,
      label: 'Temperature',
    },
    systemPrompt: {
      type: 'text_multiline',
      default: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
      label: 'System Prompt',
      description: 'Supports {{personaPrompt}} and {{memoriesText}}.',
      rows: 8,
    },
    userPromptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_USER_PROMPT_TEMPLATE,
      label: 'User Prompt Template',
      description: 'Supports {{personaPrompt}} and {{memoriesText}}.',
      rows: 6,
    },
  },
  description: 'Generates a natural curiosity question via LLM',
  execute,
});
