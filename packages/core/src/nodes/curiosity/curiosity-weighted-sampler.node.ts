/** Curiosity graph adapter for the canonical bounded memory sampler. */

import { sampleCuriosityMemories } from '../../curiosity-memory-sampling.js';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (_inputs, context, properties) => {
  const username = typeof context.username === 'string' && context.username.trim()
    ? context.username.trim()
    : context.userId;
  const sampleSize = properties?.sampleSize || 5;
  const decayFactor = properties?.decayFactor || 14;

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
  execute,
});
