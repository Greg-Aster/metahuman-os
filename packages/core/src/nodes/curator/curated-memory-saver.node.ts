/**
 * Curated Memory Saver Node
 * Saves curated memories to curated/conversations directory
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { isSuccessfulCuration, type CuratorItemResult } from './contracts.js';
import { writeCuratedMemory } from './curated-store.js';

export function saveCuratedResults(
  curatedResults: CuratorItemResult[],
  username: string,
): { savedCount: number; savedPaths: string[] } {
  const savedPaths: string[] = [];

  for (const result of curatedResults) {
    if (!isSuccessfulCuration(result)) continue;
    savedPaths.push(writeCuratedMemory(username, result.curated));
  }

  return { savedCount: savedPaths.length, savedPaths };
}

const execute: NodeExecutor = async (inputs, context, _properties) => {
  // Inputs are keyed by targetHandle name from graph edges, not array index
  const curatedResults = inputs.curatedMemories?.curatedMemories || inputs.curatedMemories || inputs[0]?.curatedMemories || [];

  if (!context.userId) {
    throw new Error('Curator requires a userId to save curated memories');
  }

  if (!curatedResults || curatedResults.length === 0) {
    return {
      success: true,
      curatedMemories: [],
      savedCount: 0,
      savedPaths: [],
    };
  }

  const saved = saveCuratedResults(curatedResults as CuratorItemResult[], context.userId);
  return {
    success: true,
    curatedMemories: curatedResults,
    ...saved,
  };
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
    { name: 'curatedMemories', type: 'array' },
    { name: 'savedCount', type: 'number' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Saves curated memories to curated/conversations directory',
  execute,
});
