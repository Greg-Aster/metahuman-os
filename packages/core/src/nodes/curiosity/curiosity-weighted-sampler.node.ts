/** Curiosity graph adapter for the canonical bounded memory sampler. */

import { sampleCuriosityMemories } from '../../curiosity-memory-sampling.js';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

function positiveNumber(value: unknown, fallback: number, label: string, maximum: number): number {
  const selected = value === undefined ? fallback : value;
  if (typeof selected !== 'number' || !Number.isFinite(selected) || selected <= 0 || selected > maximum) {
    throw new Error(`${label} must be greater than zero and at most ${maximum}`);
  }
  return selected;
}

export const executeCuriosityWeightedSampler: NodeExecutor = async (_inputs, context, properties) => {
  const username = typeof context.username === 'string' && context.username.trim()
    ? context.username.trim()
    : context.userId;
  const sampleSize = positiveNumber(properties?.sampleSize, 5, 'Curiosity sampleSize', 100);
  if (!Number.isSafeInteger(sampleSize)) throw new Error('Curiosity sampleSize must be an integer');
  const decayFactor = positiveNumber(properties?.decayFactor, 14, 'Curiosity decayFactor', 3_650);

  if (!username) {
    return {
      memories: [],
      count: 0,
      error: 'No username in context'
    };
  }

  try {
    const sample = await sampleCuriosityMemories({
      username,
      sampleSize,
      decayDays: decayFactor,
    });

    return {
      memories: sample.memories,
      count: sample.memories.length,
      hasMemories: sample.memories.length > 0,
      username,
      decayFactor,
      diagnostics: sample.diagnostics,
      ...(sample.memories.length === 0 ? { note: 'No usable memories available for sampling' } : {}),
    };
  } catch (error) {
    throw new Error(`Curiosity memory sampling failed: ${(error as Error).message}`);
  }
};

export const CuriosityWeightedSamplerNode: NodeDefinition = defineNode({
  id: 'curiosity_weighted_sampler',
  name: 'Curiosity Weighted Sampler',
  category: 'curiosity',
  inputs: [],
  outputs: [
    { name: 'memories', type: 'array', description: 'Sampled memories' },
    { name: 'count', type: 'number' },
    { name: 'hasMemories', type: 'boolean' },
    { name: 'diagnostics', type: 'object' },
  ],
  properties: {
    sampleSize: 5,
    decayFactor: 14,
  },
  propertySchemas: {
    sampleSize: {
      type: 'number',
      default: 5,
      label: 'Sample Size',
    },
    decayFactor: {
      type: 'number',
      default: 14,
      label: 'Decay Factor (days)',
    },
  },
  description: 'Samples memories using weighted selection with exponential decay',
  execute: executeCuriosityWeightedSampler,
});
