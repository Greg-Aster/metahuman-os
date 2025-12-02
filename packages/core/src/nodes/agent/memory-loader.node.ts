/**
 * Memory Loader Node
 *
 * Loads unprocessed episodic memories for agent processing
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { searchMemory } from '../../memory.js';

const execute: NodeExecutor = async (_inputs, _context, properties) => {
  const limit = properties?.limit || 10;
  const onlyUnprocessed = properties?.onlyUnprocessed !== false;

  try {
    const memories = searchMemory('');
    const fs = await import('fs');
    const path = await import('path');

    const loadedMemories: any[] = [];

    for (const memoryPath of memories.slice(0, limit * 2)) {
      try {
        const content = fs.readFileSync(memoryPath, 'utf-8');
        const memory = JSON.parse(content);

        if (onlyUnprocessed && memory.metadata?.processed) {
          continue;
        }

        loadedMemories.push({
          path: memoryPath,
          id: path.basename(memoryPath, '.json'),
          ...memory,
        });

        if (loadedMemories.length >= limit) {
          break;
        }
      } catch (error) {
        console.warn(`[MemoryLoader] Failed to load ${memoryPath}:`, error);
      }
    }

    return {
      memories: loadedMemories,
      count: loadedMemories.length,
      hasMore: memories.length > loadedMemories.length,
    };
  } catch (error) {
    console.error('[MemoryLoader] Error:', error);
    return {
      memories: [],
      count: 0,
      hasMore: false,
      error: (error as Error).message,
    };
  }
};

export const MemoryLoaderNode: NodeDefinition = defineNode({
  id: 'memory_loader',
  name: 'Memory Loader',
  category: 'agent',
  inputs: [],
  outputs: [
    { name: 'memories', type: 'array', description: 'Array of loaded memory objects' },
    { name: 'count', type: 'number', description: 'Number of memories loaded' },
    { name: 'hasMore', type: 'boolean', description: 'Whether more memories exist' },
  ],
  properties: {
    limit: 10,
    onlyUnprocessed: true,
  },
  propertySchemas: {
    limit: {
      type: 'number',
      default: 10,
      label: 'Limit',
      description: 'Maximum memories to load',
    },
    onlyUnprocessed: {
      type: 'boolean',
      default: true,
      label: 'Only Unprocessed',
      description: 'Filter for unprocessed memories only',
    },
  },
  description: 'Loads episodic memories from disk, optionally filtering for unprocessed items',
  execute,
});
