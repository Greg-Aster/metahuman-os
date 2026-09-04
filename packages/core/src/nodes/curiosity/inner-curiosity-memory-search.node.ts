import { queryIndexWithReconciliation, type VectorIndexItem } from '../../vector-index.js';
import { defineNode, type NodeDefinition, type NodeExecutionContext } from '../types.js';

export interface InnerCuriositySearchDependencies {
  query: typeof queryIndexWithReconciliation;
}

const DEFAULT_DEPENDENCIES: InnerCuriositySearchDependencies = { query: queryIndexWithReconciliation };
const DEFAULT_STOP_WORDS = new Set([
  'about', 'could', 'should', 'their', 'there', 'these', 'think', 'through',
  'what', 'when', 'where', 'which', 'would',
]);

function throwIfAborted(context: NodeExecutionContext): void {
  const signal = (context.abortSignal ?? context.signal) as AbortSignal | undefined;
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException('Inner Curiosity memory search cancelled', 'AbortError');
}

function positiveInteger(value: unknown, fallback: number, label: string, maximum: number): number {
  const selected = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(selected) || Number(selected) < 1 || Number(selected) > maximum) {
    throw new Error(`${label} must be an integer from 1 to ${maximum}`);
  }
  return Number(selected);
}

function searchTerms(question: string, maximum: number): string[] {
  return [...new Set(question.toLowerCase().match(/[a-z][a-z0-9'-]{4,}/g) || [])]
    .filter(word => !DEFAULT_STOP_WORDS.has(word))
    .slice(0, maximum);
}

export async function executeInnerCuriosityMemorySearch(
  inputs: Record<string, unknown>,
  context: NodeExecutionContext,
  properties: Record<string, unknown> = {},
  dependencies: InnerCuriositySearchDependencies = DEFAULT_DEPENDENCIES,
): Promise<Record<string, unknown>> {
  throwIfAborted(context);
  const question = typeof inputs.question === 'string' ? inputs.question.trim() : '';
  if (!question) throw new Error('Inner Curiosity memory search requires a question');
  const username = typeof context.username === 'string'
    ? context.username.trim()
    : typeof context.userId === 'string'
      ? context.userId.trim()
      : '';
  if (!username || username === 'anonymous') {
    throw new Error('Inner Curiosity memory search requires an authenticated username');
  }
  const maxTerms = positiveInteger(properties.maxTerms, 3, 'Inner Curiosity maxTerms', 12);
  const resultsPerTerm = positiveInteger(properties.resultsPerTerm, 3, 'Inner Curiosity resultsPerTerm', 20);
  const maxResults = positiveInteger(properties.maxResults, 9, 'Inner Curiosity maxResults', 50);
  const results: VectorIndexItem[] = [];
  const terms = searchTerms(question, maxTerms);
  for (const term of terms) {
    throwIfAborted(context);
    const matches = await dependencies.query(term, {
      topK: resultsPerTerm,
      username,
      reconciliationSource: 'inner-curiosity',
    });
    results.push(...matches.map(match => match.item));
  }
  throwIfAborted(context);
  const searchResults = [...new Map(results.map(result => [result.id, result])).values()].slice(0, maxResults);
  return { question, terms, searchResults, count: searchResults.length };
}

export const InnerCuriosityMemorySearchNode: NodeDefinition = defineNode({
  id: 'inner_curiosity_memory_search',
  name: 'Search Inner Curiosity Memories',
  category: 'curiosity',
  inputs: [{ name: 'question', type: 'string' }],
  outputs: [
    { name: 'question', type: 'string' },
    { name: 'terms', type: 'array' },
    { name: 'searchResults', type: 'array' },
    { name: 'count', type: 'number' },
  ],
  properties: { maxTerms: 3, resultsPerTerm: 3, maxResults: 9 },
  propertySchemas: {
    maxTerms: { type: 'number', default: 3, min: 1, max: 12, label: 'Maximum Search Terms' },
    resultsPerTerm: { type: 'number', default: 3, min: 1, max: 20, label: 'Results Per Term' },
    maxResults: { type: 'number', default: 9, min: 1, max: 50, label: 'Maximum Results' },
  },
  description: 'Queries the canonical reconciled profile index for memories related to the generated private question.',
  execute: executeInnerCuriosityMemorySearch,
});
