/**
 * Memory Marker Node
 * Marks original episodic memories as curated
 */

import fs from 'node:fs';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, _context, _properties) => {
  const curatedResults = inputs[0]?.curatedMemories || [];

  if (!curatedResults || curatedResults.length === 0) {
    return {
      success: true,
      markedCount: 0,
    };
  }

  let markedCount = 0;
  const markedPaths: string[] = [];

  for (const result of curatedResults) {
    const originalMemoryPath = result.originalMemoryPath;

    if (!originalMemoryPath) continue;

    try {
      const content = fs.readFileSync(originalMemoryPath, 'utf-8');
      const memory = JSON.parse(content);

      memory.metadata = memory.metadata || {};
      memory.metadata.curated = true;
      memory.metadata.curatedAt = new Date().toISOString();

      fs.writeFileSync(originalMemoryPath, JSON.stringify(memory, null, 2), 'utf-8');

      markedPaths.push(originalMemoryPath);
      markedCount++;
    } catch (error) {
      console.error(`[MemoryMarker] Failed to mark: ${originalMemoryPath}`, error);
    }
  }

  return {
    success: true,
    markedCount,
    markedPaths,
  };
};

export const MemoryMarkerNode: NodeDefinition = defineNode({
  id: 'memory_marker',
  name: 'Memory Marker',
  category: 'curator',
  inputs: [
    { name: 'curatedMemories', type: 'object', description: 'Curated memories' },
  ],
  outputs: [
    { name: 'success', type: 'boolean' },
    { name: 'markedCount', type: 'number' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Marks original episodic memories as curated',
  execute,
});
