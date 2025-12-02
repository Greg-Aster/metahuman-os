/**
 * Loop Memory Search Node
 * Searches for memories based on keywords from thought chain
 * Designed to work inside loops, avoiding already-seen memories
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { searchMemory } from '../../memory.js';

const execute: NodeExecutor = async (inputs, context, properties) => {
  const searchTerms = inputs[0]?.nextSearchTerms || inputs[0] || [];
  const seenIds = new Set(inputs[1]?.seenMemoryIds || context.seenMemoryIds || []);
  const maxResults = properties?.maxResults || 3;
  const excludeSeen = properties?.excludeSeen !== false;

  if (!Array.isArray(searchTerms) || searchTerms.length === 0) {
    return {
      memories: [],
      memoryIds: [],
      searchTermsUsed: [],
    };
  }

  try {
    const results: any[] = [];
    const searchTermsUsed: string[] = [];
    const newMemoryIds: string[] = [];

    for (const term of searchTerms) {
      if (results.length >= maxResults) break;

      const found = searchMemory(term);
      for (const memoryPath of found) {
        if (results.length >= maxResults) break;

        // Extract ID from path
        const memoryId = memoryPath.split('/').pop()?.replace('.json', '') || memoryPath;

        if (excludeSeen && seenIds.has(memoryId)) continue;

        results.push({
          id: memoryId,
          path: memoryPath,
          searchTerm: term,
        });
        newMemoryIds.push(memoryId);

        if (!searchTermsUsed.includes(term)) {
          searchTermsUsed.push(term);
        }
      }
    }

    return {
      memories: results,
      memoryIds: newMemoryIds,
      searchTermsUsed,
      totalFound: results.length,
    };
  } catch (error) {
    console.error('[LoopMemorySearch] Error:', error);
    return {
      memories: [],
      memoryIds: [],
      searchTermsUsed: [],
      error: (error as Error).message,
    };
  }
};

export const LoopMemorySearchNode: NodeDefinition = defineNode({
  id: 'loop_memory_search',
  name: 'Loop Memory Search',
  category: 'thought',
  inputs: [
    { name: 'searchTerms', type: 'array', description: 'Keywords to search' },
    { name: 'seenIds', type: 'object', optional: true, description: 'Already seen memory IDs' },
  ],
  outputs: [
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
