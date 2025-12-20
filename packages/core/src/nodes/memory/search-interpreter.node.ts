/**
 * Search Interpreter Node
 *
 * Evaluates whether memory search results actually answer the user's question.
 * This is critical for preventing hallucinations when no relevant memories exist.
 *
 * Purpose:
 * - Analyze each search result for relevance to the actual query
 * - Detect "meta memories" (memories OF asking the same question vs. answers)
 * - Signal "I don't know" when no relevant factual memories exist
 * - Pass through only genuinely relevant memories to context builder
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { callLLM } from '../../model-router.js';

interface SearchResult {
  content: string;
  timestamp: string;
  type: string;
  score: number;
  id: string;
}

interface InterpretedMemory {
  content: string;
  timestamp: string;
  type: string;
  score: number;
  id: string;
  relevanceScore: number;
  relevanceReason: string;
  relevanceLevel: 'high' | 'partial' | 'low' | 'none';
  uncertainty?: string;
}

interface InterpretationResult {
  relevantMemories: InterpretedMemory[];
  hasRelevantResults: boolean;
  hasPartialResults: boolean;
  unknownSignal: boolean;
  interpretation: string;
  summary: string; // Natural language summary of what is known/uncertain
  rejectedCount: number;
  confidence: number;
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  // Extract inputs
  const searchResults = inputs.searchResults ?? inputs[0] ?? { memories: [] };
  const userQuery = inputs.userQuery ?? inputs[1] ?? context.userMessage ?? '';
  const orchestratorIntent = inputs.orchestratorIntent ?? inputs[2] ?? {};

  // Extract properties
  const relevanceThreshold = properties?.relevanceThreshold ?? 0.6;
  const maxResults = properties?.maxResults ?? 5;

  const memories: SearchResult[] = searchResults.memories ?? searchResults ?? [];

  console.log(`[search_interpreter] Evaluating ${memories.length} search results for query: "${userQuery.substring(0, 60)}..."`);

  // Early return if no results
  if (memories.length === 0) {
    console.log('[search_interpreter] No search results to interpret');
    return {
      relevantMemories: [],
      hasRelevantResults: false,
      unknownSignal: true,
      interpretation: 'No memories found for this query.',
      rejectedCount: 0,
      confidence: 1.0,
      searchPerformed: searchResults.searchPerformed ?? false,
    };
  }

  // Build memory summaries for LLM evaluation
  const memorySummaries = memories.slice(0, 10).map((m, i) => {
    const preview = m.content.substring(0, 200);
    return `[${i + 1}] (score: ${m.score.toFixed(3)}, type: ${m.type}) ${preview}...`;
  }).join('\n\n');

  try {
    const systemPrompt = `You are a memory interpreter. Review these search results and determine what information they contain that relates to the user's question.

User's question: "${userQuery}"

Assess each memory's relevance: "high", "partial", "low", or "none".
Write a summary expressing what you found, including any uncertainty about how it relates to the question.
Set unknownSignal to true only if none of the memories contain any relevant information.

Output JSON:
{
  "evaluations": [
    {
      "index": number,
      "relevance": "high" | "partial" | "low" | "none",
      "relevanceScore": 0.0-1.0,
      "reason": "brief explanation",
      "uncertainty": "what is unknown or unclear (optional)"
    }
  ],
  "summary": "what you found and any uncertainty",
  "unknownSignal": boolean,
  "confidence": 0.0-1.0
}`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: `Evaluate these search results:\n\n${memorySummaries}` },
    ];

    const response = await callLLM({
      role: 'orchestrator',
      messages,
      cognitiveMode: context.cognitiveMode,
      options: {
        maxTokens: 1024,
        temperature: 0.1,
      },
      onProgress: context.emitProgress,
    });

    // Parse the LLM response
    let evaluation;
    try {
      evaluation = JSON.parse(response.content);
    } catch {
      // Fallback parsing for malformed JSON
      console.warn('[search_interpreter] Failed to parse LLM response, using fallback');
      const unknownMatch = response.content.match(/unknownSignal[":]\s*(true|false)/i);
      evaluation = {
        evaluations: [],
        unknownSignal: unknownMatch?.[1]?.toLowerCase() === 'true' ?? true,
        summary: 'Failed to parse evaluation',
        confidence: 0.5,
      };
    }

    // Filter memories based on LLM evaluation - include high AND partial relevance
    const evaluations = evaluation.evaluations || [];
    const relevantMemories: InterpretedMemory[] = [];
    let rejectedCount = 0;
    let partialCount = 0;

    memories.forEach((memory, index) => {
      const memEval = evaluations.find((e: any) => e.index === index + 1);
      const relevance = memEval?.relevance || 'none';

      // Include high and partial relevance (pass through related information)
      if (relevance === 'high' || relevance === 'partial') {
        relevantMemories.push({
          ...memory,
          relevanceScore: memEval?.relevanceScore ?? (relevance === 'high' ? 0.9 : 0.6),
          relevanceReason: memEval?.reason || '',
          relevanceLevel: relevance,
          uncertainty: memEval?.uncertainty,
        });
        if (relevance === 'partial') partialCount++;
        console.log(`[search_interpreter] Included memory ${index + 1} (${relevance}): ${memEval?.reason || 'related'}`);
      } else if (relevance === 'low' && memEval?.relevanceScore >= relevanceThreshold) {
        // Include low relevance only if score is high enough
        relevantMemories.push({
          ...memory,
          relevanceScore: memEval.relevanceScore,
          relevanceReason: memEval.reason || '',
          relevanceLevel: 'low',
          uncertainty: memEval?.uncertainty,
        });
        console.log(`[search_interpreter] Included memory ${index + 1} (low but above threshold): ${memEval?.reason || ''}`);
      } else {
        rejectedCount++;
        console.log(`[search_interpreter] Excluded memory ${index + 1}: ${memEval?.reason || 'not relevant'}`);
      }
    });

    // Sort by relevance score and limit results
    relevantMemories.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const topMemories = relevantMemories.slice(0, maxResults);

    const hasHighRelevance = topMemories.some(m => m.relevanceLevel === 'high');
    const hasPartialResults = topMemories.some(m => m.relevanceLevel === 'partial');
    const hasRelevantResults = topMemories.length > 0;

    // Only signal unknown if we have NO relevant results at all (not even partial)
    const unknownSignal = evaluation.unknownSignal ?? !hasRelevantResults;

    console.log(`[search_interpreter] Result: ${topMemories.length} included (${partialCount} partial), ${rejectedCount} excluded, unknownSignal=${unknownSignal}`);

    // Use summary from LLM - this contains the natural language interpretation with uncertainty
    const summary = evaluation.summary || (hasRelevantResults
      ? `Found ${topMemories.length} related memories`
      : 'No relevant memories found');

    const result: InterpretationResult = {
      relevantMemories: topMemories,
      hasRelevantResults,
      hasPartialResults,
      unknownSignal,
      interpretation: summary, // Use summary as interpretation for backwards compat
      summary,
      rejectedCount,
      confidence: evaluation.confidence ?? (hasHighRelevance ? 0.9 : hasPartialResults ? 0.6 : 0.3),
    };

    return {
      ...result,
      fullResult: result, // Complete result object for Context Builder
      searchPerformed: searchResults.searchPerformed ?? true,
      originalResultCount: memories.length,
    };

  } catch (error) {
    console.error('[search_interpreter] Error:', error);

    // On error, pass through with a warning but mark as uncertain
    const errorResult: InterpretationResult = {
      relevantMemories: memories.slice(0, maxResults).map(m => ({
        ...m,
        relevanceScore: m.score,
        relevanceReason: 'evaluation failed, using original score',
        relevanceLevel: 'partial' as const,
        uncertainty: 'Could not evaluate relevance',
      })),
      hasRelevantResults: memories.length > 0,
      hasPartialResults: true,
      unknownSignal: false,
      interpretation: 'Evaluation failed, passing through unfiltered results',
      summary: 'Evaluation failed, passing through unfiltered results',
      rejectedCount: 0,
      confidence: 0.3,
    };
    return {
      ...errorResult,
      fullResult: errorResult,
      error: (error as Error).message,
      searchPerformed: searchResults.searchPerformed ?? true,
      originalResultCount: memories.length,
    };
  }
};

export const SearchInterpreterNode: NodeDefinition = defineNode({
  id: 'search_interpreter',
  name: 'Search Interpreter',
  category: 'memory',
  inputs: [
    { name: 'searchResults', type: 'object', description: 'Memory search results from memory_router' },
    { name: 'userQuery', type: 'string', description: 'Original user query' },
    { name: 'orchestratorIntent', type: 'object', optional: true, description: 'Intent hints from orchestrator' },
  ],
  outputs: [
    { name: 'relevantMemories', type: 'array', description: 'Memories with relevance scores and levels (high/partial/low)' },
    { name: 'hasRelevantResults', type: 'boolean', description: 'Whether any relevant results were found' },
    { name: 'hasPartialResults', type: 'boolean', description: 'Whether partial-confidence results were found' },
    { name: 'unknownSignal', type: 'boolean', description: 'True if no relevant information was found' },
    { name: 'summary', type: 'string', description: 'Natural language summary with uncertainty expressed' },
    { name: 'interpretation', type: 'string', description: 'Alias for summary (backwards compat)' },
    { name: 'confidence', type: 'number', description: 'Confidence in the interpretation (0-1)' },
    { name: 'rejectedCount', type: 'number', description: 'Number of memories excluded' },
    { name: 'fullResult', type: 'object', description: 'Complete result object for downstream nodes' },
  ],
  properties: {
    relevanceThreshold: 0.6,
    maxResults: 5,
  },
  propertySchemas: {
    relevanceThreshold: {
      type: 'slider',
      default: 0.6,
      label: 'Relevance Threshold',
      min: 0.3,
      max: 0.9,
      step: 0.05,
    },
    maxResults: {
      type: 'slider',
      default: 5,
      label: 'Max Results',
      min: 1,
      max: 10,
      step: 1,
    },
  },
  description: 'Evaluates search results for relevance and signals "I don\'t know" when appropriate',
  execute,
});
