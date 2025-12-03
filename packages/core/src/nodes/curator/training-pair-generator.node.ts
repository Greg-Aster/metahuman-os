/**
 * Training Pair Generator Node
 * Converts curated memories to training pair format
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

interface TrainingPair {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  metadata: {
    memoryId: string;
    timestamp: string;
    curatedAt: string;
  };
}

const execute: NodeExecutor = async (inputs, _context, _properties) => {
  const curatedResults = inputs[0]?.curatedMemories || [];

  if (!curatedResults || curatedResults.length === 0) {
    return {
      trainingPairs: [],
      count: 0,
    };
  }

  const trainingPairs: TrainingPair[] = [];

  for (const result of curatedResults) {
    const curated = result.curated;

    if (!curated || !curated.suitableForTraining || !curated.userMessage || !curated.assistantResponse) {
      continue;
    }

    const pair: TrainingPair = {
      messages: [
        {
          role: 'user',
          content: curated.userMessage,
        },
        {
          role: 'assistant',
          content: curated.assistantResponse,
        },
      ],
      metadata: {
        memoryId: curated.id,
        timestamp: curated.originalTimestamp,
        curatedAt: curated.curatedAt,
      },
    };

    trainingPairs.push(pair);
  }

  return {
    trainingPairs,
    count: trainingPairs.length,
  };
};

export const TrainingPairGeneratorNode: NodeDefinition = defineNode({
  id: 'training_pair_generator',
  name: 'Training Pair Generator',
  category: 'curator',
  inputs: [
    { name: 'curatedMemories', type: 'object', description: 'Curated memories' },
  ],
  outputs: [
    { name: 'trainingPairs', type: 'array' },
    { name: 'count', type: 'number' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Converts curated memories to training pair format',
  execute,
});
