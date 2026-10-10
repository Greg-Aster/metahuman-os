/**
 * Memory Router Node
 *
 * AI-driven memory routing using orchestrator hints.
 * Uses semantic search to retrieve relevant memories based on orchestrator guidance.
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { selectedEnvironmentRoutes } from '../environment/context-routing.js';
import { workResultWaitNode } from '../utility/work-result-wait.node.js';
import { queryIndexWithReconciliation } from '../../vector-index.js';

export function normalizeRequestedMemoryTypes(value: unknown): string[] | undefined {
  const values = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? [value] : []);
  const normalized = values
    .filter((type): type is string => typeof type === 'string')
    .map(type => type.trim().toLowerCase())
    .filter(Boolean);

  return normalized.length > 0 ? [...new Set(normalized)] : undefined;
}

function formatMemoryResults(results: Awaited<ReturnType<typeof queryIndexWithReconciliation>>, threshold: number, memoryTypes?: string[]) {
  const aboveThreshold = results.filter(result => result.score >= threshold);
  // Preserve the existing scoped-recall selection contract.
  const selected = memoryTypes?.length && !aboveThreshold.length && results.length ? results.slice(0, 1) : aboveThreshold;
  return selected.map(({ item, score }) => ({
    content: item.text || '', timestamp: item.timestamp, type: item.memoryType || item.type || 'observation', score, id: item.id,
  }));
}

/** Join the existing Coordinator lookup only at a consumer that selected memory. */
export async function resolveMemoryWork(work: Record<string, any>, context: Parameters<NodeExecutor>[1]) {
  const result = await workResultWaitNode.execute({ work }, context, {});
  const receipt = result.result.result;
  if (receipt.state !== 'completed') throw new Error(`Memory search ${receipt.state}: ${JSON.stringify(receipt.error ?? '')}`);
  return { memories: formatMemoryResults(receipt.result, work.threshold, work.memoryTypes), receivedInput: result.userInput };
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  if (context.environmentInterpretation?.memory) return context.environmentInterpretation.memory;
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
  const needsMemory = selectedEnvironmentRoutes(orchestratorHints).needsMemory ?? true; // Default to true for safety
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

    // Semantic memory scope is selected by the orchestrator LLM. This node
    // only normalizes and executes that decision; it does not infer intent.
    const memoryTypes = normalizeRequestedMemoryTypes(orchestratorHints.memoryTypes);

    console.log(`[memory_router] Searching with topK=${searchTopK}, threshold=${threshold}, types=${memoryTypes?.join(',') ?? 'all'}, query="${query.substring(0, 80)}"`);
    const username = typeof context.username === 'string' ? context.username.trim() : '';
    if (!username || username === 'anonymous') {
      throw new Error('Memory Router requires an authenticated profile username');
    }
    if (properties?.dispatch === true) {
      const work = context.graphExecution!.dispatch({ kind: 'coordinator_work', payload: {
        type: 'semantic_search', username, source: 'environment', maxAttempts: 1,
        input: { query, limit: searchTopK, memoryTypes },
        metadata: { producer: 'memory-router' },
      } });
      return { work: { effectId: work.effectId, threshold, memoryTypes }, query, searchPerformed: false };
    }
    const results = await queryIndexWithReconciliation(query, {
      topK: searchTopK,
      username,
      memoryTypes,
      reconciliationSource: 'memory-router',
    });

    const memories = formatMemoryResults(results, threshold, memoryTypes);

    return {
      memories,
      searchPerformed: true,
      query,
      resultCount: memories.length,
      memoryTier,
      memoryTypes: memoryTypes || [],
    };
  } catch (error) {
    console.error('[memory_router] Search error:', error);
    throw error;
  }
};

export const MemoryRouterNode: NodeDefinition = defineNode({
  id: 'memory_router',
  name: 'Memory Router',
  category: 'memory',
  inputs: [
    { name: 'orchestratorHints', type: 'object', optional: true, description: 'LLM-selected memory routing hints (needsMemory, memoryTier, memoryQuery, memoryTypes)' },
    { name: 'userMessage', type: 'string', description: 'User message as fallback query' },
  ],
  outputs: [
    { name: 'work', type: 'object', description: 'Identified Coordinator memory lookup for a selected context consumer' },
    { name: 'memories', type: 'array', description: 'Retrieved memories' },
    { name: 'searchPerformed', type: 'boolean', description: 'Whether search was actually performed' },
    { name: 'query', type: 'string', description: 'Query used for search' },
    { name: 'resultCount', type: 'number', description: 'Number of results found' },
  ],
  properties: {
    dispatch: false,
    topK: 12,
    threshold: 0.5,
  },
  propertySchemas: {
    dispatch: { type: 'toggle', default: false, label: 'Lookup in Parallel', description: 'Dispatch through the Work Coordinator; selected context builders join the result' },
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
