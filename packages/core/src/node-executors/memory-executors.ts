/**
 * Memory Node Executors
 *
 * Handles intelligent memory retrieval with AI-driven tier selection.
 * Replaces simple vector search with reasoning-based retrieval.
 */

import { intelligentMemorySearch, type IntelligentRetrievalOptions } from '../intelligent-memory-retrieval.js';
import type { NodeExecutor, ProgressEvent } from './types.js';

/**
 * Intelligent Memory Retrieval Node
 *
 * AI-driven memory search that:
 * 1. Searches recent (hot) memories first
 * 2. Evaluates if results are sufficient using LLM reasoning
 * 3. Automatically searches deeper tiers if needed
 * 4. Returns merged, deduplicated results
 *
 * Properties:
 * - topK: Number of results to return (default: 8)
 * - threshold: Minimum similarity score (default: 0.5)
 * - useAIEvaluation: Use LLM to evaluate results (default: true)
 * - searchAll: Force search all tiers (default: false)
 *
 * Inputs:
 * - inputs[0]: Query string or object with { message }
 *
 * Outputs:
 * - memories: Array of memory results
 * - evaluation: AI evaluation result
 * - tiersSearched: Which memory tiers were searched
 * - query: The query that was searched
 */
export const intelligentMemoryRetrievalExecutor: NodeExecutor = async (inputs, context, properties) => {
  // Extract query from inputs
  const inputData = inputs[0];
  const query = typeof inputData === 'string'
    ? inputData
    : (inputData?.message || inputData?.query || context.userMessage || '');

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return {
      memories: [],
      evaluation: { sufficient: false, reason: 'No query provided', action: 'return', confidence: 0 },
      tiersSearched: [],
      query: '',
    };
  }

  // Extract properties with defaults
  const topK = properties?.topK || properties?.limit || 8;
  const threshold = properties?.threshold || 0.5;
  const useAIEvaluation = properties?.useAIEvaluation !== false;
  const searchAll = properties?.searchAll || false;

  // Create progress emitter that forwards to context
  const onProgress = (message: string) => {
    if (context.emitProgress) {
      context.emitProgress({
        type: 'status',
        message: `🔍 ${message}`,
      } as ProgressEvent);
    }
  };

  try {
    const { results, evaluation, tiersSearched } = await intelligentMemorySearch(query, {
      finalTopK: topK,
      threshold,
      heuristicsOnly: !useAIEvaluation,
      searchAll,
      onProgress,
    });

    // Format results for downstream nodes
    const memories = results.map(r => ({
      content: r.item.text || '',
      timestamp: r.item.timestamp,
      type: r.item.type || 'episodic',
      score: r.score,
      tier: r.tier,
      id: r.item.id,
      path: r.item.path,
    }));

    // Log search details
    console.log(`[IntelligentMemoryRetrieval] Query: "${query.substring(0, 50)}..." | Found: ${memories.length} | Tiers: ${tiersSearched.join(',')} | Reason: ${evaluation.reason}`);

    return {
      memories,
      evaluation: {
        sufficient: evaluation.sufficient,
        reason: evaluation.reason,
        action: evaluation.action,
        confidence: evaluation.confidence,
        refinedQuery: evaluation.refinedQuery,
      },
      tiersSearched,
      query,
    };
  } catch (error) {
    console.error('[IntelligentMemoryRetrieval] Error:', error);
    return {
      memories: [],
      evaluation: { sufficient: false, reason: (error as Error).message, action: 'return', confidence: 0 },
      tiersSearched: [],
      query,
      error: (error as Error).message,
    };
  }
};

/**
 * Memory Tier Search Node
 *
 * Searches a specific memory tier directly (hot, warm, cold, facts).
 * Useful when you know exactly which tier to search.
 *
 * Properties:
 * - tier: 'hot' | 'warm' | 'cold' | 'facts' (required)
 * - topK: Number of results (default: 10)
 * - threshold: Minimum score (default: 0.5)
 */
export const memoryTierSearchExecutor: NodeExecutor = async (inputs, context, properties) => {
  const query = typeof inputs[0] === 'string' ? inputs[0] : (inputs[0]?.query || context.userMessage || '');
  const tier = properties?.tier || 'hot';
  const topK = properties?.topK || 10;
  const threshold = properties?.threshold || 0.5;

  if (!query) {
    return { memories: [], tier, query: '' };
  }

  try {
    // For now, all tiers fall back to hot (full index)
    // TODO: Implement actual tier-specific search when partitions exist
    const { results } = await intelligentMemorySearch(query, {
      finalTopK: topK,
      threshold,
      heuristicsOnly: true,
      searchAll: tier === 'all',
    });

    return {
      memories: results
        .filter(r => r.tier === tier || tier === 'all')
        .map(r => ({
          content: r.item.text,
          timestamp: r.item.timestamp,
          type: r.item.type,
          score: r.score,
          tier: r.tier,
        })),
      tier,
      query,
    };
  } catch (error) {
    console.error(`[MemoryTierSearch] Error searching ${tier}:`, error);
    return { memories: [], tier, query, error: (error as Error).message };
  }
};

/**
 * Memory Evaluation Node
 *
 * Evaluates whether memory search results are sufficient.
 * Can be used in a loop to iteratively refine searches.
 *
 * Inputs:
 * - inputs[0]: Query
 * - inputs[1]: Current results
 *
 * Outputs:
 * - sufficient: boolean
 * - action: recommended next action
 * - refinedQuery: improved query if needed
 */
export const memoryEvaluationExecutor: NodeExecutor = async (inputs, context, properties) => {
  const query = typeof inputs[0] === 'string' ? inputs[0] : (inputs[0]?.query || '');
  const results = inputs[1]?.memories || inputs[1] || [];

  if (!query || results.length === 0) {
    return {
      sufficient: false,
      action: 'search_warm',
      reason: 'No query or results to evaluate',
      confidence: 0,
    };
  }

  // Use intelligent memory retrieval's evaluation logic
  const { evaluation } = await intelligentMemorySearch(query, {
    heuristicsOnly: properties?.heuristicsOnly ?? false,
  });

  return evaluation;
};

/**
 * Memory Router Node
 *
 * Takes orchestrator analysis as input and routes memory search based on
 * the AI-determined memory tier and query hints.
 *
 * This node bridges the orchestrator's intent analysis with the intelligent
 * memory retrieval system, allowing natural AI-driven memory access decisions.
 *
 * Inputs:
 * - inputs[0]: Orchestrator analysis object with { needsMemory, memoryTier, memoryQuery }
 * - inputs[1]: User message (fallback query)
 *
 * Outputs:
 * - memories: Retrieved memories based on orchestrator hints
 * - searchPerformed: Whether memory search was performed
 * - tier: Which tier was searched
 * - query: The query used for search
 * - orchestratorHints: Original hints from orchestrator
 */
export const memoryRouterExecutor: NodeExecutor = async (inputs, context, properties) => {
  const orchestratorAnalysis = inputs[0] || {};
  const userMessage = inputs[1]?.message || inputs[1] || context.userMessage || '';

  // Extract orchestrator hints
  const needsMemory = orchestratorAnalysis.needsMemory || false;
  const memoryTier = orchestratorAnalysis.memoryTier || 'hot';
  const memoryQuery = orchestratorAnalysis.memoryQuery || '';

  // If orchestrator determined no memory is needed, skip search
  if (!needsMemory) {
    return {
      memories: [],
      searchPerformed: false,
      tier: null,
      query: '',
      orchestratorHints: {
        needsMemory,
        memoryTier,
        memoryQuery,
      },
      reason: 'Orchestrator determined memory not needed',
    };
  }

  // Use the refined query from orchestrator, or fall back to user message
  const searchQuery = memoryQuery || userMessage;

  if (!searchQuery || typeof searchQuery !== 'string' || searchQuery.trim().length === 0) {
    return {
      memories: [],
      searchPerformed: false,
      tier: memoryTier,
      query: '',
      orchestratorHints: {
        needsMemory,
        memoryTier,
        memoryQuery,
      },
      reason: 'No valid query for memory search',
    };
  }

  // Extract search properties
  const topK = properties?.topK || 8;
  const threshold = properties?.threshold || 0.5;

  // Emit progress if available
  const onProgress = (message: string) => {
    if (context.emitProgress) {
      context.emitProgress({
        type: 'status',
        message: `🧠 ${message}`,
      } as ProgressEvent);
    }
  };

  try {
    // Route based on orchestrator's tier hint
    // 'all' means search everything, 'facts' means identity/relationship queries
    const searchAll = memoryTier === 'all';

    onProgress(`Searching ${memoryTier} memory tier...`);

    const { results, evaluation, tiersSearched } = await intelligentMemorySearch(searchQuery, {
      finalTopK: topK,
      threshold,
      heuristicsOnly: false, // Use AI evaluation for smart tier escalation
      searchAll,
      onProgress,
    });

    // Format results for downstream nodes
    const memories = results.map(r => ({
      content: r.item.text || '',
      timestamp: r.item.timestamp,
      type: r.item.type || 'episodic',
      score: r.score,
      tier: r.tier,
      id: r.item.id,
      path: r.item.path,
    }));

    console.log(`[MemoryRouter] Orchestrator hint: tier=${memoryTier} | Query: "${searchQuery.substring(0, 40)}..." | Found: ${memories.length} | Tiers searched: ${tiersSearched.join(',')}`);

    return {
      memories,
      searchPerformed: true,
      tier: memoryTier,
      tiersSearched,
      query: searchQuery,
      orchestratorHints: {
        needsMemory,
        memoryTier,
        memoryQuery,
      },
      evaluation,
    };
  } catch (error) {
    console.error('[MemoryRouter] Error:', error);
    return {
      memories: [],
      searchPerformed: false,
      tier: memoryTier,
      query: searchQuery,
      orchestratorHints: {
        needsMemory,
        memoryTier,
        memoryQuery,
      },
      error: (error as Error).message,
    };
  }
};
