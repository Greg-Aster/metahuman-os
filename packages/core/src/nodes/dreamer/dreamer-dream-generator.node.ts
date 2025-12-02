/**
 * Dreamer Dream Generator Node
 * Generates a surreal dream narrative from memory fragments using LLM
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
  const memoriesInput = inputs[0]?.memories || inputs[0] || [];
  const memories = Array.isArray(memoriesInput) ? memoriesInput : [];
  const personaPrompt = inputs[1]?.formatted || inputs[1] || '';
  const temperature = properties?.temperature || 1.0;
  const role = properties?.role || 'persona';
  const username = context.userId || context.username;

  if (memories.length < 3) {
    return {
      dream: null,
      error: 'Not enough memories (need at least 3)',
      memoryCount: memories.length,
    };
  }

  const memoriesText = memories
    .map((m: Memory) => `- A fragment: ${(m.content || '').substring(0, 300)}`)
    .join('\n');

  const systemPrompt = `${personaPrompt ? personaPrompt + '\n\n' : ''}You are the dreamer. You are processing recent experiences into a surreal, metaphorical dream.
Do not be literal. Weave the following memory fragments into an unbound dream narrative.
Use symbolism, look for unexpected connections, break logic, merge impossible things.
The output should feel like a dream—no rules, no structure, pure subconscious flow.
Start the dream directly, without any preamble. Let it be as long or short as it needs to be.`.trim();

  const userPrompt = `Memory Fragments:\n${memoriesText}`;

  try {
    markBackgroundActivity();

    const messages: RouterMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await callLLM({
      role,
      messages,
      options: { temperature },
    });

    const dream = response.content.trim();

    if (!dream) {
      return {
        dream: null,
        error: 'LLM returned empty dream',
        memoryCount: memories.length,
      };
    }

    return {
      dream,
      memoryCount: memories.length,
      sourceIds: memories.map((m: Memory) => m.id).filter(Boolean),
      username,
    };
  } catch (error) {
    console.error('[DreamerDreamGenerator] Error:', error);
    return {
      dream: null,
      error: (error as Error).message,
      memoryCount: memories.length,
    };
  }
};

export const DreamerDreamGeneratorNode: NodeDefinition = defineNode({
  id: 'dreamer_dream_generator',
  name: 'Dreamer Dream Generator',
  category: 'dreamer',
  inputs: [
    { name: 'memories', type: 'array', description: 'Curated memories' },
    { name: 'personaPrompt', type: 'string', optional: true, description: 'Formatted persona' },
  ],
  outputs: [
    { name: 'dream', type: 'string', description: 'Generated dream text' },
    { name: 'memoryCount', type: 'number' },
    { name: 'sourceIds', type: 'array' },
  ],
  properties: {
    temperature: 1.0,
    role: 'persona',
  },
  propertySchemas: {
    temperature: {
      type: 'number',
      default: 1.0,
      label: 'Temperature',
      description: 'LLM temperature (1.0 for maximum creativity)',
    },
    role: {
      type: 'string',
      default: 'persona',
      label: 'LLM Role',
    },
  },
  description: 'Generates a surreal dream narrative from memory fragments',
  execute,
});
