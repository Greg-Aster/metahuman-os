/**
 * Loop Memory Search Node
 * Searches for memories based on keywords from thought chain
 * Designed to work inside loops, avoiding already-seen memories
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { queryIndexWithReconciliation, type MemoryIndexQueryOptions, type VectorIndexItem } from '../../vector-index.js';

const GENERATED_INNER_TYPES = new Set([
  'curiosity_question',
  'daydream',
  'dream',
  'inner_dialogue',
  'reasoning',
  'reflection',
  'reflection_summary',
]);

export interface LoopMemorySearchDependencies {
  query: (
    query: string,
    options?: MemoryIndexQueryOptions,
  ) => Promise<Array<{ item: VectorIndexItem; score: number }>>;
}

const DEFAULT_DEPENDENCIES: LoopMemorySearchDependencies = {
  query: (query, options = {}) => queryIndexWithReconciliation(query, {
    ...options,
    username: options.username || '',
    reconciliationSource: 'loop-memory-search',
  }),
};

export async function executeLoopMemorySearch(
  inputs: Record<string, any>,
  context: Record<string, any>,
  properties: Record<string, any> = {},
  dependencies: LoopMemorySearchDependencies = DEFAULT_DEPENDENCIES,
): Promise<Record<string, any>> {
  const evaluation = inputs.evaluation || {};
  const searchTerms = Array.isArray(evaluation.nextSearchTerms)
    ? evaluation.nextSearchTerms
      .filter((value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()))
      .map((value: string) => value.trim())
      .slice(0, 3)
    : [];
  const seenIds = new Set<string>(
    Array.isArray(evaluation.seenMemoryIds)
      ? evaluation.seenMemoryIds.filter((value: unknown): value is string => typeof value === 'string')
      : [],
  );
  const maxResults = Number(properties?.maxResults ?? 3);
  const excludeSeen = properties?.excludeSeen !== false;
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 5) {
    throw new Error('Loop Memory Search maxResults must be an integer from 1 to 5');
  }

  const exitData = { ...evaluation };
  if (evaluation.isComplete === true || searchTerms.length === 0) {
    return {
      shouldExit: true,
      exitData,
      context: null,
      memories: [],
      memoryIds: [],
      searchTermsUsed: [],
    };
  }

  const username = typeof context.username === 'string' ? context.username.trim() : '';
  if (!username || username === 'anonymous') {
    throw new Error('Loop Memory Search requires an authenticated username');
  }

  const matches = await dependencies.query(searchTerms.join(' '), {
    topK: Math.min(15, maxResults * 3),
    username,
  });
  const memories: string[] = [];
  const memoryIds: string[] = [];

  for (const match of matches) {
    if (memories.length >= maxResults) break;
    const item = match.item;
    const memoryType = item.memoryType?.trim().toLowerCase() || '';
    if (GENERATED_INNER_TYPES.has(memoryType)) continue;
    if (excludeSeen && seenIds.has(item.id)) continue;
    const text = item.text.trim();
    if (!text) continue;
    memories.push(text.slice(0, 1_200));
    memoryIds.push(item.id);
    seenIds.add(item.id);
  }

  const nextContext = memories.length > 0
    ? {
      seedMemory: evaluation.seedMemory,
      relatedMemories: memories,
      thoughts: evaluation.thoughts,
      seenMemoryIds: [...seenIds],
    }
    : null;

  return {
    shouldExit: memories.length === 0,
    exitData,
    context: nextContext,
    memories,
    memoryIds,
    searchTermsUsed: searchTerms,
    totalFound: memories.length,
  };
}

const execute: NodeExecutor = (inputs, context, properties) =>
  executeLoopMemorySearch(inputs, context, properties);

export const LoopMemorySearchNode: NodeDefinition = defineNode({
  id: 'loop_memory_search',
  name: 'Loop Memory Search',
  category: 'thought',
  inputs: [
    { name: 'evaluation', type: 'object', description: 'Thought evaluation and accumulated chain state' },
  ],
  outputs: [
    { name: 'shouldExit', type: 'boolean', description: 'Whether the chain should be aggregated now' },
    { name: 'exitData', type: 'object', description: 'Accumulated thoughts for aggregation' },
    { name: 'context', type: 'object', optional: true, description: 'Related memory context for the next thought' },
    { name: 'memories', type: 'array', description: 'Found memories' },
    { name: 'memoryIds', type: 'array', description: 'Memory IDs' },
    { name: 'searchTermsUsed', type: 'array', description: 'Terms that yielded results' },
  ],
  properties: {
    maxResults: 3,
    excludeSeen: true,
  },
  propertySchemas: {
    maxResults: {
      type: 'number',
      default: 3,
      label: 'Max Results',
    },
    excludeSeen: {
      type: 'boolean',
      default: true,
      label: 'Exclude Seen',
    },
  },
  description: 'Searches for memories based on keywords, avoiding already-seen memories',
  execute,
});
