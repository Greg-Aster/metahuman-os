/**
 * Curated Memory Saver Node
 * Saves curated memories to curated/conversations directory
 */

import fs from 'node:fs';
import path from 'node:path';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { getProfilePaths } from '../../paths.js';
import { writeJsonAtomically } from './atomic-json.js';
import { isSuccessfulCuration, type CuratorItemResult } from './contracts.js';
import { curatedRecordFilename } from './curated-store.js';

export function saveCuratedResults(
  curatedResults: CuratorItemResult[],
  curatedDir: string,
): { savedCount: number; savedPaths: string[] } {
  fs.mkdirSync(curatedDir, { recursive: true });
  const savedPaths: string[] = [];

  for (const result of curatedResults) {
    if (!isSuccessfulCuration(result)) continue;
    const filepath = path.join(curatedDir, curatedRecordFilename(result.curated));
    writeJsonAtomically(filepath, result.curated);
    savedPaths.push(filepath);
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

  const profilePaths = getProfilePaths(context.userId);
  const curatedDir = path.join(profilePaths.memory, 'curated', 'conversations');
  const saved = saveCuratedResults(curatedResults as CuratorItemResult[], curatedDir);
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
