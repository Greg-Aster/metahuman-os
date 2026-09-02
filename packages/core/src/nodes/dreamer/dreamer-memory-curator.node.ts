/**
 * Dreamer Memory Curator Node
 * Curates weighted sample of memories from entire lifetime using exponential decay
 */

import fs from 'node:fs';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { audit } from '../../audit.js';
import { listEpisodicFiles } from '../../memory.js';

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

export function isGeneratedInnerMemory(type: string | undefined): boolean {
  return type === 'dream'
    || type === 'daydream'
    || type === 'reflection'
    || type === 'inner_dialogue';
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

const execute: NodeExecutor = async (_inputs, context, properties) => {
  const username = context.userId || context.username;
  const sampleSize = nonNegativeInteger(properties?.sampleSize, 15);
  const decayDays = positiveNumber(properties?.decayDays, 227);

  if (!username) {
    throw new Error('Dreamer memory curator requires an authenticated username');
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
    const episodicFiles = listEpisodicFiles();
    let invalidMemoryCount = 0;

    if (episodicFiles.length === 0) {
      return { memories: [], count: 0, username };
    }

    for (const filepath of episodicFiles) {
      if (context.signal?.aborted) {
        throw new DOMException('Dream memory curation cancelled', 'AbortError');
      }
      try {
        const content = fs.readFileSync(filepath, 'utf-8');
        const memory = JSON.parse(content) as Memory;

        if (
          typeof memory.id !== 'string'
          || !memory.id.trim()
          || typeof memory.content !== 'string'
          || !memory.content.trim()
        ) {
          invalidMemoryCount++;
          continue;
        }

        const type = memory.type || memory.metadata?.type;
        if (isGeneratedInnerMemory(type)) continue;

        const memoryDate = new Date(memory.timestamp);
        if (Number.isNaN(memoryDate.getTime())) {
          invalidMemoryCount++;
          continue;
        }
        const ageInMs = now.getTime() - memoryDate.getTime();
        const ageInDays = Math.max(0, Math.floor(ageInMs / (1000 * 60 * 60 * 24)));

        const weight = Math.exp(-ageInDays / decayDays);
        memories.push({ ...memory, weight, age: ageInDays });
      } catch {
        invalidMemoryCount++;
      }
    }

    if (invalidMemoryCount > 0) {
      audit({
        level: 'warn',
        category: 'data',
        event: 'dream_curation_invalid_memories',
        details: { invalidMemoryCount, username },
        actor: 'dreamer',
      });
    }

    if (memories.length === 0) {
      return { memories: [], count: 0, invalidMemoryCount, username };
    }

    // Weighted random sampling
    const curated: Memory[] = [];
    const tempMemories = [...memories];

    while (curated.length < sampleSize && tempMemories.length > 0) {
      if (context.signal?.aborted) {
        throw new DOMException('Dream memory curation cancelled', 'AbortError');
      }
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
      return Math.max(0, Math.floor(ageMs / (1000 * 60 * 60 * 24)));
    });
    const avgAgeDays = ages.length > 0 ? Math.floor(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;
    const oldestAgeDays = ages.length > 0 ? Math.max(...ages) : 0;

    return {
      memories: curated,
      count: curated.length,
      avgAgeDays,
      oldestAgeDays,
      invalidMemoryCount,
      username,
    };
  } catch (error) {
    console.error('[DreamerMemoryCurator] Error:', error);
    throw error;
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
    { name: 'invalidMemoryCount', type: 'number' },
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
