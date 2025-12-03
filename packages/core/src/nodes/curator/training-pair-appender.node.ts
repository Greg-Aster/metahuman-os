/**
 * Training Pair Appender Node
 * Appends training pairs to daily JSONL file
 */

import fs from 'node:fs';
import path from 'node:path';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { getProfilePaths } from '../../index.js';

const execute: NodeExecutor = async (inputs, context, properties) => {
  const trainingPairs = inputs[0]?.trainingPairs || [];

  if (!context.userId) {
    return {
      success: false,
      error: 'No userId in context',
    };
  }

  if (!trainingPairs || trainingPairs.length === 0) {
    return {
      success: true,
      appendedCount: 0,
    };
  }

  try {
    const profilePaths = getProfilePaths(context.userId);
    const trainingDir = path.join(profilePaths.memory, 'curated', 'training-datasets');
    fs.mkdirSync(trainingDir, { recursive: true });

    const outputFile = properties?.outputFile || path.join(trainingDir, `persona-training-${new Date().toISOString().split('T')[0]}.jsonl`);

    let appendedCount = 0;
    for (const pair of trainingPairs) {
      const line = JSON.stringify(pair) + '\n';
      fs.appendFileSync(outputFile, line, 'utf-8');
      appendedCount++;
    }

    return {
      success: true,
      file: outputFile,
      appendedCount,
    };
  } catch (error) {
    console.error('[TrainingPairAppender] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const TrainingPairAppenderNode: NodeDefinition = defineNode({
  id: 'training_pair_appender',
  name: 'Training Pair Appender',
  category: 'curator',
  inputs: [
    { name: 'trainingPairs', type: 'object', description: 'Training pairs' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
    { name: 'file', type: 'string' },
    { name: 'appendedCount', type: 'number' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Appends training pairs to daily JSONL file',
  execute,
});
