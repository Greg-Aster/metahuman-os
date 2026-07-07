/**
 * Daydreamer Generator Node
 * Generates brief, whimsical daydreams from memory fragments using LLM
 * Lighter version of dreams for waking hours - inner dialogue only
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM, type RouterMessage } from '../../model-router.js';
import { recordSystemActivity } from '../../system-activity.js';
import { scheduler } from '../../agent-scheduler.js';
import { renderPromptTemplate } from '../prompt-template.js';

interface Memory {
  id: string;
  content: string;
}

function markBackgroundActivity() {
  try { recordSystemActivity(); } catch {}
  try { scheduler.recordActivity(); } catch {}
}

const DEFAULT_SYSTEM_PROMPT = `You are generating a brief daydream - a fleeting inner musing or reverie.

Your daydreams should be:
- Short (2-4 sentences)
- Whimsical or contemplative
- First-person perspective
- May blend memories in creative ways
- Can be slightly surreal or metaphorical
- Never include action items or to-dos
- Pure inner musing, not meant for anyone else to read

This is private inner dialogue - stream of consciousness thoughts that drift through the mind during idle moments.

Start directly with the daydream content, no preamble.`;

const DEFAULT_USER_PROMPT_TEMPLATE = `Based on these memory fragments, generate a brief daydream:

{{memoriesText}}

Generate a short, whimsical daydream (2-4 sentences) that weaves these memories together in a creative, contemplative way.`;

const execute: NodeExecutor = async (inputs, context, properties) => {
  const memoriesInput = inputs.memories?.memories || inputs.memories || [];
  const memories = Array.isArray(memoriesInput) ? memoriesInput : [];
  const temperature = properties?.temperature ?? 0.9;
  const role = properties?.role ?? 'persona';
  const maxTokens = properties?.maxTokens ?? 200;
  const systemPrompt = properties?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const userPromptTemplate = properties?.userPromptTemplate ?? DEFAULT_USER_PROMPT_TEMPLATE;
  const username = context.userId || context.username;

  if (memories.length < 3) {
    return {
      daydream: null,
      error: 'Not enough memories (need at least 3)',
      memoryCount: memories.length,
    };
  }

  const memoriesText = memories
    .map((m: Memory, i: number) => {
      const content = (m.content || '').substring(0, 200);
      return `${i + 1}. ${content}`;
    })
    .join('\n');

  const userPrompt = renderPromptTemplate(userPromptTemplate, { memoriesText });

  try {
    markBackgroundActivity();

    const messages: RouterMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await callLLM({
      role,
      messages,
      userId: username,
      options: {
        temperature,
        maxTokens,
      },
    });

    const daydream = response.content.trim();

    if (!daydream || daydream.length < 20) {
      return {
        daydream: null,
        error: 'LLM returned insufficient daydream content',
        memoryCount: memories.length,
      };
    }

    console.log(`[DaydreamerGenerator] Generated daydream: "${daydream.slice(0, 50)}..."`);

    return {
      daydream,
      memoryCount: memories.length,
      sourceIds: memories.map((m: Memory) => m.id).filter(Boolean),
      username,
    };
  } catch (error) {
    console.error('[DaydreamerGenerator] Error:', error);
    return {
      daydream: null,
      error: (error as Error).message,
      memoryCount: memories.length,
    };
  }
};

export const DaydreamerGeneratorNode: NodeDefinition = defineNode({
  id: 'daydreamer_generator',
  name: 'Daydreamer Generator',
  category: 'dreamer',
  inputs: [
    { name: 'memories', type: 'array', description: 'Curated memories' },
    { name: 'personaPrompt', type: 'string', optional: true, description: 'Formatted persona' },
  ],
  outputs: [
    { name: 'daydream', type: 'string', description: 'Generated daydream text' },
    { name: 'memoryCount', type: 'number' },
    { name: 'sourceIds', type: 'array' },
  ],
  properties: {
    temperature: 0.9,
    role: 'persona',
    maxTokens: 200,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    userPromptTemplate: DEFAULT_USER_PROMPT_TEMPLATE,
  },
  propertySchemas: {
    temperature: {
      type: 'number',
      default: 0.9,
      label: 'Temperature',
      description: 'LLM temperature (0.9 for creative but focused)',
    },
    role: {
      type: 'string',
      default: 'persona',
      label: 'LLM Role',
    },
    maxTokens: {
      type: 'number',
      default: 200,
      label: 'Max Tokens',
      description: 'Maximum tokens for short daydream output',
    },
    systemPrompt: {
      type: 'text_multiline',
      default: DEFAULT_SYSTEM_PROMPT,
      label: 'System Prompt',
      description: 'Instructions for the daydream generator.',
      rows: 12,
    },
    userPromptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_USER_PROMPT_TEMPLATE,
      label: 'User Prompt Template',
      description: 'Template variables: {{memoriesText}}.',
      rows: 8,
    },
  },
  description: 'Generates a brief, whimsical daydream from memory fragments',
  execute,
});
