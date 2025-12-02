/**
 * Curiosity Weighted Sampler Node
 * Samples memories using weighted selection with exponential decay
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { getProfilePaths } from '../../index.js';

const technicalKeywords = [
  'metahuman', 'ai agent', 'organizer', 'reflector', 'boredom-service',
  'llm', 'ollama', 'typescript', 'package.json', 'astro', 'dev server',
  'audit', 'persona', 'memory system', 'cli', 'codebase', 'development'
];

async function getAllMemoriesForUser(username: string): Promise<Array<{ file: string; timestamp: Date; content: any }>> {
  const profilePaths = getProfilePaths(username);
  const episodicDir = profilePaths.episodic;
  const allMemories: Array<{ file: string; timestamp: Date; content: any }> = [];

  async function walk(dir: string, acc: Array<{ file: string; timestamp: Date; content: any }>) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      let stats;
      try {
        stats = await fs.stat(fullPath);
      } catch { continue; }

      if (stats.isDirectory()) {
        await walk(fullPath, acc);
      } else if (stats.isFile() && entry.endsWith('.json')) {
        try {
          const content = JSON.parse(await fs.readFile(fullPath, 'utf-8'));
          if (content.type === 'curiosity_question' ||
              content.type === 'reflection' ||
              content.type === 'inner_dialogue' ||
              content.type === 'dream') continue;

          acc.push({
            file: fullPath,
            timestamp: new Date(content.timestamp),
            content
          });
        } catch {}
      }
    }
  }

  await walk(episodicDir, allMemories);
  allMemories.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return allMemories;
}

const execute: NodeExecutor = async (_inputs, context, properties) => {
  const username = context.userId;
  const sampleSize = properties?.sampleSize || 5;
  const decayFactor = properties?.decayFactor || 14;

  if (!username) {
    return {
      memories: [],
      count: 0,
      error: 'No username in context'
    };
  }

  try {
    const allMemories = await getAllMemoriesForUser(username);

    if (allMemories.length === 0) {
      return {
        memories: [],
        count: 0,
        note: 'No memories available for sampling'
      };
    }

    const now = Date.now();
    const selected: any[] = [];
    const usedIndices = new Set<number>();

    for (let i = 0; i < sampleSize && selected.length < Math.min(sampleSize, allMemories.length); i++) {
      const weights = allMemories.map((mem, idx) => {
        if (usedIndices.has(idx)) return 0;

        const ageInDays = (now - mem.timestamp.getTime()) / (1000 * 60 * 60 * 24);
        let weight = Math.exp(-ageInDays / decayFactor);

        const contentLower = mem.content.content?.toLowerCase() || '';
        const isTechnical = technicalKeywords.some(kw => contentLower.includes(kw));
        if (isTechnical) weight *= 0.3;

        return weight;
      });

      const totalWeight = weights.reduce((sum, w) => sum + w, 0);
      if (totalWeight === 0) break;

      let rand = Math.random() * totalWeight;
      let cumulativeWeight = 0;

      for (let idx = 0; idx < allMemories.length; idx++) {
        cumulativeWeight += weights[idx];
        if (rand <= cumulativeWeight) {
          selected.push(allMemories[idx].content);
          usedIndices.add(idx);
          break;
        }
      }
    }

    return {
      memories: selected,
      count: selected.length,
      username,
      decayFactor
    };
  } catch (error) {
    console.error('[CuriosityWeightedSampler] Error:', error);
    return {
      memories: [],
      count: 0,
      error: (error as Error).message,
      username
    };
  }
};

export const CuriosityWeightedSamplerNode: NodeDefinition = defineNode({
  id: 'curiosity_weighted_sampler',
  name: 'Curiosity Weighted Sampler',
  category: 'curiosity',
  inputs: [],
  outputs: [
    { name: 'memories', type: 'array', description: 'Sampled memories' },
    { name: 'count', type: 'number' },
  ],
  properties: {
    sampleSize: 5,
    decayFactor: 14,
  },
  propertySchemas: {
    sampleSize: {
      type: 'number',
      default: 5,
      label: 'Sample Size',
    },
    decayFactor: {
      type: 'number',
      default: 14,
      label: 'Decay Factor (days)',
    },
  },
  description: 'Samples memories using weighted selection with exponential decay',
  execute,
});
