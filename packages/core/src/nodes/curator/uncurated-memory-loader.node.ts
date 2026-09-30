/**
 * Uncurated Memory Loader Node
 * Loads episodic memories that haven't been curated yet
 */

import path from 'node:path';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { scanEpisodicMemoryRecords } from '../../memory.js';
import { resolvePath, getStorageStatus } from '../../storage-client.js';
import type { EpisodicMemory } from './contracts.js';
import { sourceCurationStatus } from './curated-store.js';
import { assembleCuratorSources } from './source-assembler.js';

const execute: NodeExecutor = async (_inputs, context, properties) => {
  const requestedLimit = Number(properties?.limit ?? 50);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 500) {
    throw new Error(`Curator memory limit must be an integer between 1 and 500, received: ${properties?.limit}`);
  }
  const limit = requestedLimit;
  const cutoff = properties?.cutoff ? Date.parse(String(properties.cutoff)) : Date.now();
  if (!Number.isFinite(cutoff)) throw new Error('Curator cutoff must be a valid timestamp');

  if (!context.userId) {
    throw new Error('Curator requires a userId to load episodic memories');
  }
  const storage = getStorageStatus(context.userId);
  if (!storage.available) throw new Error(storage.error || 'Profile storage is unavailable');

  const resolved = resolvePath({ username: context.userId, category: 'memory', subcategory: 'episodic' });
  if (!resolved.success || !resolved.path) throw new Error(resolved.error || 'Cannot resolve episodic storage');
  const candidates: (EpisodicMemory & { path: string })[] = [];
  const errors: string[] = [];
  const currentPaths = new Set<string>();
  for (const outcome of scanEpisodicMemoryRecords(context.userId)) {
    if (outcome.status === 'failed') {
      errors.push(`${outcome.relativePath}: ${outcome.error}`);
      continue;
    }
    const memory = outcome.record.event;
    if (Date.parse(memory.timestamp) > cutoff) continue;
    const fullPath = path.join(resolved.path, outcome.record.relativePath);
    if (sourceCurationStatus(context.userId, memory).current) currentPaths.add(fullPath);
    candidates.push({ ...memory, path: fullPath });
  }

  const assembled = assembleCuratorSources(candidates);
  // Assemble first: a changed side must bring its previously reviewed partner
  // back into the same review unit rather than becoming an orphan.
  const pending = assembled.memories.filter(memory =>
    !(memory.sourcePaths ?? [memory.path]).every(sourcePath => currentPaths.has(sourcePath)));
  const memories = pending.slice(0, limit);
  return {
    memories,
    count: memories.length,
    sourceCount: memories.reduce(
      (count, memory) => count + (memory.sourcePaths?.length || 1),
      0,
    ),
    deferredCount: assembled.deferredPaths.length,
    excludedCount: errors.length,
    errors,
    hasMore: pending.length > limit,
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
    { name: 'sourceCount', type: 'number' },
    { name: 'deferredCount', type: 'number' },
    { name: 'excludedCount', type: 'number' },
    { name: 'errors', type: 'array' },
    { name: 'hasMore', type: 'boolean' },
  ],
  properties: {
    limit: 50,
    cutoff: '',
  },
  propertySchemas: {
    cutoff: {
      type: 'string', default: '', label: 'Source cutoff',
      description: 'Review only memories captured at or before this timestamp. Empty uses the start of this batch.',
    },
    limit: {
      type: 'number',
      default: 50,
      label: 'Limit',
    },
  },
  description: 'Loads episodic memories that haven\'t been curated yet',
  execute,
});
