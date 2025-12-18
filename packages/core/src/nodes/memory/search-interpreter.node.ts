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
}

interface InterpretationResult {
  relevantMemories: InterpretedMemory[];
  hasRelevantResults: boolean;
  unknownSignal: boolean;
  interpretation: string;
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
  const strictMode = properties?.strictMode ?? true;

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
    const systemPrompt = `You are a Search Result Interpreter.

Your purpose: Determine which memory search results ACTUALLY ANSWER the user's question.

CRITICAL RULES:
1. Memories of ASKING the same question are NOT answers (reject these)
2. Previous hallucinated responses are NOT valid memories (reject these)
3. Only memories containing FACTUAL INFORMATION that answers the question are relevant
4. If no memories contain the actual answer, signal unknownSignal: true

The user asked: "${userQuery}"

For each memory, evaluate:
- Does this DIRECTLY answer what the user asked?
- Is this a memory OF asking the question (meta-memory)? REJECT if so.
- Is this factual information or a previous conversation where the answer was made up?

Output JSON:
{
  "evaluations": [
    {
      "index": number,
      "relevant": boolean,
      "relevanceScore": 0.0-1.0,
      "reason": "brief explanation"
    }
  ],
  "unknownSignal": boolean,
  "interpretation": "summary of what was found or not found",
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
        interpretation: 'Failed to parse evaluation, assuming no relevant results',
        confidence: 0.5,
      };
    }

    // Filter memories based on LLM evaluation
    const evaluations = evaluation.evaluations || [];
    const relevantMemories: InterpretedMemory[] = [];
    let rejectedCount = 0;

    memories.forEach((memory, index) => {
      const memEval = evaluations.find((e: any) => e.index === index + 1);

      if (memEval && memEval.relevant && memEval.relevanceScore >= relevanceThreshold) {
        relevantMemories.push({
          ...memory,
          relevanceScore: memEval.relevanceScore,
          relevanceReason: memEval.reason,
        });
      } else {
        rejectedCount++;
        console.log(`[search_interpreter] Rejected memory ${index + 1}: ${memEval?.reason || 'below threshold'}`);
      }
    });

    // Sort by relevance score and limit results
    relevantMemories.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const topMemories = relevantMemories.slice(0, maxResults);

    const hasRelevantResults = topMemories.length > 0;
    const unknownSignal = evaluation.unknownSignal ?? !hasRelevantResults;

    console.log(`[search_interpreter] Result: ${topMemories.length} relevant, ${rejectedCount} rejected, unknownSignal=${unknownSignal}`);

    // In strict mode, if LLM says unknown, trust it even if we found some results
    const finalUnknownSignal = strictMode ? unknownSignal : (unknownSignal && !hasRelevantResults);

    const result: InterpretationResult = {
      relevantMemories: topMemories,
      hasRelevantResults,
      unknownSignal: finalUnknownSignal,
      interpretation: evaluation.interpretation || `Found ${topMemories.length} relevant memories`,
      rejectedCount,
      confidence: evaluation.confidence ?? (hasRelevantResults ? 0.8 : 0.9),
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
    const errorResult = {
      relevantMemories: memories.slice(0, maxResults).map(m => ({
        ...m,
        relevanceScore: m.score,
        relevanceReason: 'evaluation failed, using original score',
      })),
      hasRelevantResults: memories.length > 0,
      unknownSignal: false,
      interpretation: 'Evaluation failed, using unfiltered results',
      rejectedCount: 0,
      confidence: 0.3,
    };
    return {
      ...errorResult,
      fullResult: errorResult, // Complete result object for Context Builder
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
    { name: 'relevantMemories', type: 'array', description: 'Filtered relevant memories with relevance scores' },
    { name: 'hasRelevantResults', type: 'boolean', description: 'Whether any relevant results were found' },
    { name: 'unknownSignal', type: 'boolean', description: 'True if the system should respond "I don\'t know"' },
    { name: 'interpretation', type: 'string', description: 'Summary of what was found or not found' },
    { name: 'confidence', type: 'number', description: 'Confidence in the interpretation (0-1)' },
    { name: 'rejectedCount', type: 'number', description: 'Number of memories rejected as irrelevant' },
    { name: 'fullResult', type: 'object', description: 'Complete result object for Context Builder (unknownSignal, interpretation, rejectedCount, relevantMemories)' },
  ],
  properties: {
    relevanceThreshold: 0.6,
    maxResults: 5,
    strictMode: true,
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
    strictMode: {
      type: 'toggle',
      default: true,
      label: 'Strict Mode',
    },
  },
  description: 'Evaluates search results for relevance and signals "I don\'t know" when appropriate',
  execute,
});
