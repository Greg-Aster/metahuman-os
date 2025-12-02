/**
 * Intelligent Memory Retrieval
 *
 * AI-driven memory search that reasons about whether results are sufficient
 * and automatically searches deeper tiers when needed.
 *
 * Flow:
 * 1. Search hot tier (recent memories)
 * 2. LLM evaluates: "Are these results sufficient?"
 * 3. If not, search warm/cold tiers based on LLM recommendation
 * 4. Merge and deduplicate results
 */

import { queryIndex, type VectorIndexItem } from './vector-index.js';
import { callLLMJSON } from './model-router.js';

// ============================================================================
// Types
// ============================================================================

export interface MemoryResult {
  item: VectorIndexItem;
  score: number;
  tier: 'hot' | 'warm' | 'cold' | 'facts';
}

export interface RetrievalEvaluation {
  sufficient: boolean;
  reason: string;
  action: 'return' | 'search_warm' | 'search_cold' | 'search_facts' | 'search_all';
  refinedQuery?: string;
  confidence: number;
}

export interface IntelligentRetrievalOptions {
  /** Initial number of results to fetch from hot tier */
  initialTopK?: number;
  /** Final number of results to return */
  finalTopK?: number;
  /** Minimum score threshold */
  threshold?: number;
  /** Skip LLM evaluation if top score is above this */
  highConfidenceThreshold?: number;
  /** Enable progress callbacks */
  onProgress?: (message: string) => void;
  /** Force search all tiers (skip evaluation) */
  searchAll?: boolean;
  /** Disable LLM evaluation (use heuristics only) */
  heuristicsOnly?: boolean;
}

// ============================================================================
// Evaluation Prompt
// ============================================================================

function buildEvaluationPrompt(
  query: string,
  results: MemoryResult[],
): string {
  const topScores = results.slice(0, 5).map(r => r.score.toFixed(3));
  const resultSummaries = results.slice(0, 5).map((r, i) => {
    const text = r.item.text.length > 200
      ? r.item.text.substring(0, 200) + '...'
      : r.item.text;
    const date = r.item.timestamp
      ? new Date(r.item.timestamp).toLocaleDateString()
      : 'unknown date';
    return `${i + 1}. [${r.score.toFixed(2)}] (${date}) ${text}`;
  }).join('\n');

  return `You are evaluating memory search results to decide if more context is needed.

Query: "${query}"
Results found: ${results.length}
Top scores: ${topScores.join(', ')}

Result summaries:
${resultSummaries || '(no results)'}

Evaluate:
1. Do these results directly answer or provide useful context for the query?
2. Are the similarity scores confident (>0.7) or weak (<0.5)?
3. Does the query imply a need for historical/older information?
4. Is the user asking about a specific person, project, or event that might have deeper history?
5. Are there knowledge gaps that older memories might fill?

Respond with JSON:
{
  "sufficient": true/false,
  "reason": "Brief explanation (1 sentence)",
  "action": "return" | "search_warm" | "search_cold" | "search_facts" | "search_all",
  "refinedQuery": "Optional: better search query if current results are off-target",
  "confidence": 0.0-1.0
}

Guidelines:
- If top score > 0.7 and results are relevant: sufficient=true, action="return"
- If scores are weak (<0.5) or results seem off-topic: sufficient=false, action="search_warm" or "search_all"
- If query asks about identity/relationships: action="search_facts"
- If query implies past experience or patterns: action="search_cold"`;
}

// ============================================================================
// Heuristic Evaluation (no LLM)
// ============================================================================

function evaluateWithHeuristics(
  query: string,
  results: MemoryResult[],
  options: IntelligentRetrievalOptions
): RetrievalEvaluation {
  const topScore = results[0]?.score ?? 0;
  const avgScore = results.length > 0
    ? results.reduce((sum, r) => sum + r.score, 0) / results.length
    : 0;

  // High confidence - return immediately
  if (topScore > (options.highConfidenceThreshold ?? 0.85) && results.length >= 3) {
    return {
      sufficient: true,
      reason: 'High confidence results found',
      action: 'return',
      confidence: topScore,
    };
  }

  // Decent results
  if (topScore > 0.65 && results.length >= 2) {
    return {
      sufficient: true,
      reason: 'Adequate results found',
      action: 'return',
      confidence: topScore,
    };
  }

  // Weak results - search deeper
  if (topScore < 0.5 || results.length < 2) {
    return {
      sufficient: false,
      reason: 'Weak or insufficient results',
      action: 'search_warm',
      confidence: avgScore,
    };
  }

  // Borderline - return what we have
  return {
    sufficient: true,
    reason: 'Borderline results, returning available',
    action: 'return',
    confidence: avgScore,
  };
}

// ============================================================================
// LLM Evaluation
// ============================================================================

async function evaluateWithLLM(
  query: string,
  results: MemoryResult[],
): Promise<RetrievalEvaluation> {
  try {
    const prompt = buildEvaluationPrompt(query, results);

    const evaluation = await callLLMJSON<RetrievalEvaluation>('orchestrator', [
      { role: 'system', content: 'You evaluate memory search results. Respond only with valid JSON.' },
      { role: 'user', content: prompt },
    ], {
      temperature: 0.1,
      maxTokens: 256,
    });

    // Validate response
    if (typeof evaluation.sufficient !== 'boolean') {
      evaluation.sufficient = true;
    }
    if (!['return', 'search_warm', 'search_cold', 'search_facts', 'search_all'].includes(evaluation.action)) {
      evaluation.action = 'return';
    }
    evaluation.confidence = evaluation.confidence ?? 0.5;

    return evaluation;
  } catch (error) {
    console.warn('[intelligent-memory] LLM evaluation failed, using heuristics:', error);
    return {
      sufficient: true,
      reason: 'LLM evaluation failed, returning available results',
      action: 'return',
      confidence: 0.5,
    };
  }
}

// ============================================================================
// Tier Search Functions
// ============================================================================

// ============================================================================
// Time-based Tier Boundaries
// ============================================================================

const TIER_BOUNDARIES = {
  hot: 14 * 24 * 60 * 60 * 1000,      // 14 days in ms
  warm: 90 * 24 * 60 * 60 * 1000,     // 90 days (3 months) in ms
  // Anything older than warm is cold
};

function classifyByTier(timestamp: string | number | undefined): 'hot' | 'warm' | 'cold' {
  if (!timestamp) return 'cold'; // Unknown = assume old

  const itemTime = typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp;
  const now = Date.now();
  const age = now - itemTime;

  if (age <= TIER_BOUNDARIES.hot) return 'hot';
  if (age <= TIER_BOUNDARIES.warm) return 'warm';
  return 'cold';
}

// ============================================================================
// Tier Search Functions - REAL IMPLEMENTATION
// ============================================================================

/**
 * Search hot tier (last 14 days)
 * Fast L1 cache - most likely to have recent relevant memories
 */
async function searchHotTier(
  query: string,
  topK: number,
): Promise<MemoryResult[]> {
  // Search full index, filter to hot tier
  const allResults = await queryIndex(query, { topK: topK * 3 }); // Oversample to ensure enough hot results

  const hotResults = allResults
    .filter(r => classifyByTier(r.item.timestamp) === 'hot')
    .slice(0, topK)
    .map(r => ({ ...r, tier: 'hot' as const }));

  console.log(`[intelligent-memory] Hot tier: ${hotResults.length} results from last 14 days`);
  return hotResults;
}

/**
 * Search warm tier (14 days - 3 months)
 * L2 cache - medium-term memories
 */
async function searchWarmTier(
  query: string,
  topK: number,
): Promise<MemoryResult[]> {
  const allResults = await queryIndex(query, { topK: topK * 4 });

  const warmResults = allResults
    .filter(r => classifyByTier(r.item.timestamp) === 'warm')
    .slice(0, topK)
    .map(r => ({ ...r, tier: 'warm' as const }));

  console.log(`[intelligent-memory] Warm tier: ${warmResults.length} results from 2 weeks - 3 months`);
  return warmResults;
}

/**
 * Search cold tier (older than 3 months)
 * Deep archive - historical memories, patterns over time
 */
async function searchColdTier(
  query: string,
  topK: number,
): Promise<MemoryResult[]> {
  const allResults = await queryIndex(query, { topK: topK * 5 }); // Oversample more for cold

  const coldResults = allResults
    .filter(r => classifyByTier(r.item.timestamp) === 'cold')
    .slice(0, topK)
    .map(r => ({ ...r, tier: 'cold' as const }));

  console.log(`[intelligent-memory] Cold tier: ${coldResults.length} results older than 3 months`);
  return coldResults;
}

/**
 * Search facts database - identity, relationships, possessions
 * This searches ALL time but focuses on identity-related content
 */
async function searchFactsDatabase(
  query: string,
  topK: number,
): Promise<MemoryResult[]> {
  // For facts, we search broadly but look for high-confidence matches
  // Facts are timeless - a car you drive, your dog's name, etc.
  const allResults = await queryIndex(query, { topK: topK * 3 });

  // Facts tier returns all results regardless of time, prioritized by score
  // The assumption is that identity/fact queries will have high similarity to relevant memories
  const factsResults = allResults
    .slice(0, topK)
    .map(r => ({ ...r, tier: 'facts' as const }));

  console.log(`[intelligent-memory] Facts tier: ${factsResults.length} results (all time, identity-focused)`);
  return factsResults;
}

// ============================================================================
// Result Merging
// ============================================================================

function mergeResults(
  primary: MemoryResult[],
  secondary: MemoryResult[],
  topK: number,
): MemoryResult[] {
  // Combine and deduplicate by item ID
  const seen = new Set<string>();
  const merged: MemoryResult[] = [];

  for (const result of [...primary, ...secondary]) {
    if (!seen.has(result.item.id)) {
      seen.add(result.item.id);
      merged.push(result);
    }
  }

  // Sort by score and return top K
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, topK);
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Intelligent memory search that reasons about whether results are sufficient
 * and automatically searches deeper tiers when needed.
 */
export async function intelligentMemorySearch(
  query: string,
  options: IntelligentRetrievalOptions = {},
): Promise<{
  results: MemoryResult[];
  evaluation: RetrievalEvaluation;
  tiersSearched: string[];
}> {
  const initialTopK = options.initialTopK ?? 10;
  const finalTopK = options.finalTopK ?? 10;
  const threshold = options.threshold ?? 0.5;
  const onProgress = options.onProgress;

  const tiersSearched: string[] = ['hot'];

  // Step 1: Always start with hot tier
  onProgress?.('Searching recent memories...');
  let hotResults = await searchHotTier(query, initialTopK);
  hotResults = hotResults.filter(r => r.score >= threshold);

  // Step 2: Quick check - if forced search all, skip evaluation
  if (options.searchAll) {
    onProgress?.('Searching all memory tiers...');
    const warmResults = await searchWarmTier(query, initialTopK);
    const coldResults = await searchColdTier(query, initialTopK);
    const factsResults = await searchFactsDatabase(query, initialTopK);

    tiersSearched.push('warm', 'cold', 'facts');

    const merged = mergeResults(
      hotResults,
      [...warmResults, ...coldResults, ...factsResults],
      finalTopK,
    );

    return {
      results: merged,
      evaluation: {
        sufficient: true,
        reason: 'Searched all tiers as requested',
        action: 'search_all',
        confidence: merged[0]?.score ?? 0,
      },
      tiersSearched,
    };
  }

  // Step 3: Check if high confidence - return immediately
  const highConfidenceThreshold = options.highConfidenceThreshold ?? 0.85;
  if (hotResults[0]?.score > highConfidenceThreshold && hotResults.length >= 3) {
    return {
      results: hotResults.slice(0, finalTopK),
      evaluation: {
        sufficient: true,
        reason: 'High confidence results found in recent memories',
        action: 'return',
        confidence: hotResults[0].score,
      },
      tiersSearched,
    };
  }

  // Step 4: Evaluate results (LLM or heuristics)
  onProgress?.('Evaluating results...');
  const evaluation = options.heuristicsOnly
    ? evaluateWithHeuristics(query, hotResults, options)
    : await evaluateWithLLM(query, hotResults);

  // Step 5: If sufficient, return
  if (evaluation.sufficient && evaluation.action === 'return') {
    return {
      results: hotResults.slice(0, finalTopK),
      evaluation,
      tiersSearched,
    };
  }

  // Step 6: Search additional tiers based on LLM recommendation
  const searchQuery = evaluation.refinedQuery || query;
  let additionalResults: MemoryResult[] = [];

  switch (evaluation.action) {
    case 'search_warm':
      onProgress?.('Searching recent months...');
      additionalResults = await searchWarmTier(searchQuery, initialTopK);
      tiersSearched.push('warm');
      break;

    case 'search_cold':
      onProgress?.('Searching long-term archive...');
      additionalResults = await searchColdTier(searchQuery, initialTopK);
      tiersSearched.push('cold');
      break;

    case 'search_facts':
      onProgress?.('Searching facts database...');
      additionalResults = await searchFactsDatabase(searchQuery, initialTopK);
      tiersSearched.push('facts');
      break;

    case 'search_all':
      onProgress?.('Searching all memory tiers...');
      const warmResults = await searchWarmTier(searchQuery, initialTopK);
      const coldResults = await searchColdTier(searchQuery, initialTopK);
      const factsResults = await searchFactsDatabase(searchQuery, initialTopK);
      additionalResults = [...warmResults, ...coldResults, ...factsResults];
      tiersSearched.push('warm', 'cold', 'facts');
      break;
  }

  // Step 7: Merge and return
  const merged = mergeResults(hotResults, additionalResults, finalTopK);

  return {
    results: merged,
    evaluation,
    tiersSearched,
  };
}

/**
 * Simple wrapper for backward compatibility with existing queryIndex API
 */
export async function intelligentQuery(
  query: string,
  options?: { topK?: number; threshold?: number },
): Promise<Array<{ item: VectorIndexItem; score: number }>> {
  const { results } = await intelligentMemorySearch(query, {
    finalTopK: options?.topK ?? 10,
    threshold: options?.threshold ?? 0.5,
    heuristicsOnly: true, // Fast path - no LLM for simple queries
  });

  return results.map(r => ({ item: r.item, score: r.score }));
}
