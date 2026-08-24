/**
 * Uncurated Memory Loader Node
 * Loads episodic memories that haven't been curated yet
 */

import fs from 'node:fs';
import path from 'node:path';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { getProfilePaths } from '../../paths.js';
import type { EpisodicMemory } from './contracts.js';

const execute: NodeExecutor = async (_inputs, context, properties) => {
  const requestedLimit = Number(properties?.limit ?? 50);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 500) {
    throw new Error(`Curator memory limit must be an integer between 1 and 500, received: ${properties?.limit}`);
  }
  const limit = requestedLimit;

  if (!context.userId) {
    throw new Error('Curator requires a userId to load episodic memories');
  }

  const profilePaths = getProfilePaths(context.userId);
  const episodicPath = path.join(profilePaths.memory, 'episodic');
  const candidates: (EpisodicMemory & { path: string })[] = [];
  const errors: string[] = [];

  if (!fs.existsSync(episodicPath)) {
    return {
      memories: [],
      count: 0,
      hasMore: false,
    };
  }

  function walkDirectory(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (candidates.length > limit) break;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walkDirectory(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const memory = JSON.parse(content) as EpisodicMemory;

          if (memory.metadata?.curated) continue;
          if (memory.metadata?.reinforcementSignal === -1) continue;
          if (memory.tags?.includes('feedback')) continue;
          if (typeof memory.id !== 'string' || !memory.id.trim()) {
            errors.push(`${fullPath}: missing memory id`);
            continue;
          }
          if (typeof memory.timestamp !== 'string' || Number.isNaN(Date.parse(memory.timestamp))) {
            errors.push(`${fullPath}: invalid timestamp`);
            continue;
          }
          if (typeof memory.content !== 'string' || !memory.content.trim()) {
            errors.push(`${fullPath}: missing memory content`);
            continue;
          }

          candidates.push({ ...memory, path: fullPath });
        } catch (error) {
          errors.push(`${fullPath}: ${(error as Error).message}`);
        }
      }
    }
  }

  walkDirectory(episodicPath);

  if (errors.length > 0) {
    throw new Error(`Curator found ${errors.length} invalid episodic memory file(s): ${errors.join('; ')}`);
  }

  return {
    memories: candidates.slice(0, limit),
    count: Math.min(candidates.length, limit),
    hasMore: candidates.length > limit,
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
