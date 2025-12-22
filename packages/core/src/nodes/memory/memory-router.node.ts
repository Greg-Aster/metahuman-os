/**
 * Memory Router Node
 *
 * AI-driven memory routing using orchestrator hints.
 * Uses semantic search to retrieve relevant memories based on orchestrator guidance.
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { queryIndex } from '../../vector-index.js';

const execute: NodeExecutor = async (inputs, context, properties) => {
  // Extract inputs
  const orchestratorHints = inputs.orchestratorHints ?? inputs[0] ?? {};

  // user_input node returns an object { message, inputSource, ... } not a plain string
  const userInputRaw = inputs.userMessage ?? inputs[1];
  const userMessage = typeof userInputRaw === 'string'
    ? userInputRaw
    : (userInputRaw?.message || context.userMessage || '');

  // Extract properties
  const topK = properties?.topK ?? 8;
  const threshold = properties?.threshold ?? 0.5;

  // Check if orchestrator says we need memory
  const needsMemory = orchestratorHints.needsMemory ?? true; // Default to true for safety
  const memoryTier = orchestratorHints.memoryTier ?? 'normal';

  // memoryQuery can be string or object - extract string value
  let memoryQuery = orchestratorHints.memoryQuery;
  if (typeof memoryQuery === 'object' && memoryQuery !== null) {
    memoryQuery = memoryQuery.query || memoryQuery.text || JSON.stringify(memoryQuery);
  }
  memoryQuery = memoryQuery || userMessage;

  const queryPreview = typeof memoryQuery === 'string' ? memoryQuery.substring(0, 50) : String(memoryQuery);
  console.log(`[memory_router] needsMemory=${needsMemory}, tier=${memoryTier}`);
  console.log(`[memory_router] orchestratorHints.memoryQuery raw:`, orchestratorHints.memoryQuery);
  console.log(`[memory_router] userMessage:`, userMessage?.substring(0, 50));
  console.log(`[memory_router] final query: "${queryPreview}..."`);

  // If orchestrator explicitly says no memory needed, return empty
  if (needsMemory === false) {
    console.log('[memory_router] Orchestrator says no memory needed, skipping search');
    return {
      memories: [],
      searchPerformed: false,
      reason: 'orchestrator_skip',
    };
  }

  // Determine search depth based on memory tier
  let searchTopK = topK;
  if (memoryTier === 'shallow') {
    searchTopK = Math.min(topK, 4);
  } else if (memoryTier === 'deep') {
    searchTopK = Math.max(topK, 12);
  } else if (memoryTier === 'exhaustive') {
    searchTopK = Math.max(topK, 20);
  }

  // Search the vector index
  try {
    let query = memoryQuery || userMessage;

    // Ensure query is a string
    if (typeof query !== 'string') {
      query = String(query);
    }

    if (!query || query === 'undefined' || query === 'null') {
      console.log('[memory_router] No query available, skipping search');
      return {
        memories: [],
        searchPerformed: false,
        reason: 'no_query',
      };
    }

    console.log(`[memory_router] Searching with topK=${searchTopK}, threshold=${threshold}, query="${query.substring(0, 80)}"`);
    const results = await queryIndex(query, { topK: searchTopK });

    // Filter by threshold and format results
    const memories = results
      .filter(r => r.score >= threshold)
      .map(r => ({
        content: r.item.text || '',
        timestamp: r.item.timestamp,
        type: r.item.type || 'observation',
        score: r.score,
        id: r.item.id,
      }));

    console.log(`[memory_router] Found ${memories.length} memories above threshold ${threshold}`);
    // Log first 3 memory snippets for debugging
    memories.slice(0, 3).forEach((m, i) => {
      console.log(`[memory_router] Memory ${i + 1} (score=${m.score.toFixed(3)}): "${m.content.substring(0, 100)}..."`);
    });

    return {
      memories,
      searchPerformed: true,
      query,
      resultCount: memories.length,
      memoryTier,
    };
  } catch (error) {
    console.error('[memory_router] Search error:', error);
    return {
      memories: [],
      searchPerformed: false,
      error: (error as Error).message,
    };
  }
};

export const MemoryRouterNode: NodeDefinition = defineNode({
  id: 'memory_router',
  name: 'Memory Router',
  category: 'memory',
  inputs: [
    { name: 'orchestratorHints', type: 'object', description: 'Memory routing hints from orchestrator (needsMemory, memoryTier, memoryQuery)' },
    { name: 'userMessage', type: 'string', description: 'User message as fallback query' },
  ],
  outputs: [
    { name: 'memories', type: 'array', description: 'Retrieved memories' },
    { name: 'searchPerformed', type: 'boolean', description: 'Whether search was actually performed' },
    { name: 'query', type: 'string', description: 'Query used for search' },
    { name: 'resultCount', type: 'number', description: 'Number of results found' },
  ],
  properties: {
    topK: 12,
    threshold: 0.5,
  },
  propertySchemas: {
    topK: {
      type: 'slider',
      default: 8,
      label: 'Top K Results',
      min: 1,
      max: 20,
      step: 1,
    },
    threshold: {
      type: 'slider',
      default: 0.5,
      label: 'Similarity Threshold',
      min: 0,
      max: 1,
      step: 0.05,
    },
  },
  description: 'AI-driven memory routing using orchestrator hints',
  execute,
});
