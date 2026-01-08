/**
 * Daydreamer Generator Node
 * Generates brief, whimsical daydreams from memory fragments using LLM
 * Lighter version of dreams for waking hours - inner dialogue only
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM, type RouterMessage } from '../../model-router.js';
import { recordSystemActivity } from '../../system-activity.js';
import { scheduler } from '../../agent-scheduler.js';

interface Memory {
  id: string;
  content: string;
}

function markBackgroundActivity() {
  try { recordSystemActivity(); } catch {}
  try { scheduler.recordActivity(); } catch {}
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  const memoriesInput = inputs.memories?.memories || inputs.memories || [];
  const memories = Array.isArray(memoriesInput) ? memoriesInput : [];
  const temperature = properties?.temperature || 0.9;
  const role = properties?.role || 'persona';
  const maxTokens = properties?.maxTokens || 200;
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

  // Daydream-specific prompt - shorter, more whimsical than full dreams
  const systemPrompt = `You are generating a brief daydream - a fleeting inner musing or reverie.

Your daydreams should be:
- Short (2-4 sentences)
- Whimsical or contemplative
- First-person perspective
- May blend memories in creative ways
- Can be slightly surreal or metaphorical
- Never include action items or to-dos
- Pure inner musing, not meant for anyone else to read

This is private inner dialogue - stream of consciousness thoughts that drift through the mind during idle moments.

Start directly with the daydream content, no preamble.`.trim();

  const userPrompt = `Based on these memory fragments, generate a brief daydream:

${memoriesText}

Generate a short, whimsical daydream (2-4 sentences) that weaves these memories together in a creative, contemplative way.`;

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
        max_tokens: maxTokens,
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
  },
  description: 'Generates a brief, whimsical daydream from memory fragments',
  execute,
});
