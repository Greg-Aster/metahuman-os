/**
 * Curated Memory Saver Node
 * Saves curated memories to curated/conversations directory
 */

import fs from 'node:fs';
import path from 'node:path';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { getProfilePaths } from '../../index.js';

const execute: NodeExecutor = async (inputs, context, _properties) => {
  const curatedResults = inputs[0]?.curatedMemories || [];

  if (!context.userId) {
    return {
      success: false,
      error: 'No userId in context',
    };
  }

  if (!curatedResults || curatedResults.length === 0) {
    return {
      success: true,
      savedCount: 0,
    };
  }

  try {
    const profilePaths = getProfilePaths(context.userId);
    const curatedDir = path.join(profilePaths.memory, 'curated', 'conversations');
    fs.mkdirSync(curatedDir, { recursive: true });

    let savedCount = 0;
    const savedPaths: string[] = [];

    for (const result of curatedResults) {
      const curated = result.curated;
      if (!curated || !curated.id) continue;

      const dateStr = new Date(curated.originalTimestamp).toISOString().split('T')[0];
      const filename = `${dateStr}-${curated.id}.json`;
      const filepath = path.join(curatedDir, filename);

      fs.writeFileSync(filepath, JSON.stringify(curated, null, 2), 'utf-8');
      savedPaths.push(filepath);
      savedCount++;
    }

    return {
      success: true,
      savedCount,
      savedPaths,
    };
  } catch (error) {
    console.error('[CuratedMemorySaver] Error:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
};

export const CuratedMemorySaverNode: NodeDefinition = defineNode({
  id: 'curated_memory_saver',
  name: 'Curated Memory Saver',
  category: 'curator',
  inputs: [
    { name: 'curatedMemories', type: 'object', description: 'Curated memories from LLM' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
    { name: 'savedCount', type: 'number' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Saves curated memories to curated/conversations directory',
  execute,
});
