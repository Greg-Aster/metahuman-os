/**
 * Uncurated Memory Loader Node
 * Loads episodic memories that haven't been curated yet
 */

import fs from 'node:fs';
import path from 'node:path';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { getProfilePaths } from '../../index.js';

interface EpisodicMemory {
  id: string;
  timestamp: string;
  content: string;
  type?: string;
  metadata?: {
    processed?: boolean;
    curated?: boolean;
  };
}

const execute: NodeExecutor = async (_inputs, context, properties) => {
  const limit = properties?.limit || 50;

  if (!context.userId) {
    return {
      memories: [],
      count: 0,
      hasMore: false,
      error: 'No userId in context',
    };
  }

  const profilePaths = getProfilePaths(context.userId);
  const episodicPath = path.join(profilePaths.memory, 'episodic');
  const memories: (EpisodicMemory & { path: string })[] = [];

  if (!fs.existsSync(episodicPath)) {
    return {
      memories: [],
      count: 0,
      hasMore: false,
    };
  }

  function walkDirectory(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (memories.length >= limit) break;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walkDirectory(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const memory = JSON.parse(content) as EpisodicMemory;

          if (memory.metadata?.curated) continue;

          memories.push({ ...memory, path: fullPath });
        } catch (error) {
          console.error(`[UncuratedMemoryLoader] Failed to load ${entry.name}:`, (error as Error).message);
        }
      }
    }
  }

  walkDirectory(episodicPath);

  return {
    memories,
    count: memories.length,
    hasMore: memories.length >= limit,
  };
};

export const UncuratedMemoryLoaderNode: NodeDefinition = defineNode({
  id: 'uncurated_memory_loader',
  name: 'Uncurated Memory Loader',
  category: 'curator',
  inputs: [],
  outputs: [
    { name: 'memories', type: 'array', description: 'Uncurated memories' },
    { name: 'count', type: 'number' },
    { name: 'hasMore', type: 'boolean' },
  ],
  properties: {
    limit: 50,
  },
  propertySchemas: {
    limit: {
      type: 'number',
      default: 50,
      label: 'Limit',
    },
  },
  description: 'Loads episodic memories that haven\'t been curated yet',
  execute,
});
