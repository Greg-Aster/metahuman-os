/**
 * Dreamer Memory Curator Node
 * Curates weighted sample of memories from entire lifetime using exponential decay
 */

import fs from 'node:fs';
import path from 'node:path';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { audit } from '../../audit.js';
import { getProfilePaths } from '../../paths.js';

interface Memory {
  id: string;
  timestamp: string;
  content: string;
  type?: string;
  metadata?: {
    type?: string;
    tags?: string[];
    entities?: string[];
    processed?: boolean;
  };
}

const execute: NodeExecutor = async (_inputs, context, properties) => {
  const username = context.userId || context.username;
  const sampleSize = properties?.sampleSize || 15;
  const decayDays = properties?.decayDays || 227;

  if (!username) {
    console.error('[DreamerMemoryCurator] No username in context');
    return {
      memories: [],
      count: 0,
      error: 'No username in context',
    };
  }

  const now = new Date();
  const memories: Array<Memory & { weight: number; age: number }> = [];

  audit({
    level: 'info',
    category: 'action',
    event: 'dream_curation_started',
    details: { sampleSize, decayDays, scope: 'lifetime', username },
    actor: 'dreamer',
  });

  try {
    const profilePaths = getProfilePaths(username);
    const episodicDir = profilePaths.episodic;

    function walkDir(dir: string): string[] {
      const files: string[] = [];
      if (!fs.existsSync(dir)) return files;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...walkDir(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const episodicFiles = walkDir(episodicDir);

    if (episodicFiles.length === 0) {
      return { memories: [], count: 0, username };
    }

    for (const filepath of episodicFiles) {
      try {
        const content = fs.readFileSync(filepath, 'utf-8');
        const memory = JSON.parse(content) as Memory;

        const type = memory.type || memory.metadata?.type;
        if (type === 'dream' || type === 'reflection' || type === 'inner_dialogue') continue;

        const memoryDate = new Date(memory.timestamp);
        if (Number.isNaN(memoryDate.getTime())) continue;
        const ageInMs = now.getTime() - memoryDate.getTime();
        const ageInDays = Math.floor(ageInMs / (1000 * 60 * 60 * 24));

        const weight = Math.exp(-ageInDays / decayDays);
        memories.push({ ...memory, weight, age: ageInDays });
      } catch {}
    }

    if (memories.length === 0) {
      return { memories: [], count: 0, username };
    }

    // Weighted random sampling
    const curated: Memory[] = [];
    const tempMemories = [...memories];

    while (curated.length < sampleSize && tempMemories.length > 0) {
      const totalWeight = tempMemories.reduce((sum, m) => sum + m.weight, 0);
      let random = Math.random() * totalWeight;

      for (let i = 0; i < tempMemories.length; i++) {
        random -= tempMemories[i].weight;
        if (random <= 0) {
          const { weight, age, ...memory } = tempMemories[i];
          curated.push(memory);
          tempMemories.splice(i, 1);
          break;
        }
      }
    }

    const ages = curated.map(m => {
      const memDate = new Date(m.timestamp);
      const ageMs = now.getTime() - memDate.getTime();
      return Math.floor(ageMs / (1000 * 60 * 60 * 24));
    });
    const avgAgeDays = ages.length > 0 ? Math.floor(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;
    const oldestAgeDays = ages.length > 0 ? Math.max(...ages) : 0;

    return {
      memories: curated,
      count: curated.length,
      avgAgeDays,
      oldestAgeDays,
      username,
    };
  } catch (error) {
    console.error('[DreamerMemoryCurator] Error:', error);
    return {
      memories: [],
      count: 0,
      error: (error as Error).message,
      username,
    };
  }
};

export const DreamerMemoryCuratorNode: NodeDefinition = defineNode({
  id: 'dreamer_memory_curator',
  name: 'Dreamer Memory Curator',
  category: 'dreamer',
  inputs: [],
  outputs: [
    { name: 'memories', type: 'array', description: 'Curated memories' },
    { name: 'count', type: 'number' },
    { name: 'avgAgeDays', type: 'number' },
    { name: 'oldestAgeDays', type: 'number' },
  ],
  properties: {
    sampleSize: 15,
    decayDays: 227,
  },
  propertySchemas: {
    sampleSize: {
      type: 'number',
      default: 15,
      label: 'Sample Size',
    },
    decayDays: {
      type: 'number',
      default: 227,
      label: 'Decay Days',
      description: 'Days for exponential decay weighting',
    },
  },
  description: 'Curates weighted sample of memories from entire lifetime',
  execute,
});
