/**
 * Graph loading and cancellation helpers.
 *
 * Chat and graph API streaming now live with their owning handlers. This module
 * only owns shared graph lookup/cache and request cancellation state.
 */

import type { SvelteFlowGraph } from './cognitive-graph-schema.js';
import { ROOT } from './path-builder.js';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface LoadedGraph {
  graph: SvelteFlowGraph;
  source: string;
}

// ============================================================================
// Cancellation Management
// ============================================================================

const activeCancellations = new Map<string, { cancelled: boolean; reason?: string }>();

/**
 * Request cancellation of a streaming operation
 */
export function requestCancellation(requestId: string, reason: string = 'User requested stop'): void {
  activeCancellations.set(requestId, { cancelled: true, reason });
  console.log(`[graph-streaming] Request ${requestId} marked for cancellation: ${reason}`);
}

/**
 * Check if a request has been cancelled
 */
export function checkCancellation(requestId: string): { cancelled: boolean; reason?: string } {
  return activeCancellations.get(requestId) || { cancelled: false };
}

/**
 * Clear cancellation status for a request
 */
export function clearCancellation(requestId: string): void {
  activeCancellations.delete(requestId);
}

// ============================================================================
// Graph Loading & Caching
// ============================================================================

export type CachedGraphEntry = {
  source: string;
  mtimeMs: number;
  ctimeMs: number;
  size: number;
} & ({ graph: SvelteFlowGraph } | { error: GraphConfigurationError });

const graphCache: Record<string, CachedGraphEntry | null> = {};
const graphSources = new WeakMap<SvelteFlowGraph, string>();

export function loadedGraphSource(graph: SvelteFlowGraph): string | undefined {
  return graphSources.get(graph);
}

/**
 * Read and validate a Svelte Flow graph from a file
 */
export class GraphConfigurationError extends Error {
  constructor(readonly source: string, cause: Error, logPrefix = '[graph-streaming]') {
    super(`${logPrefix} Invalid workflow ${source}: ${cause.message}`, { cause });
    this.name = 'GraphConfigurationError';
  }
}

/** Shared file-loading owner for named workflows and explicitly configured graph files. */
export async function loadGraphFile(
  filePath: string,
  options: { cache?: Record<string, CachedGraphEntry | null>; cacheKey?: string; logPrefix?: string } = {},
): Promise<LoadedGraph | null> {
  const { cache, cacheKey = filePath, logPrefix } = options;
  if (!existsSync(filePath)) return null;
  const stats = await stat(filePath);
  const cached = cache?.[cacheKey];
  if (cached && cached.source === filePath && cached.mtimeMs === stats.mtimeMs
    && cached.ctimeMs === stats.ctimeMs && cached.size === stats.size) {
    if ('error' in cached) throw cached.error;
    return { graph: cached.graph, source: filePath };
  }
  const raw = await readFile(filePath, 'utf8');
  // Validation needs the node registry; importing a loader/error contract does
  // not. Keep Coordinator and individual node imports independent of registry
  // initialization order.
  const { validateSvelteFlowGraph, GraphValidationError } = await import('./cognitive-graph-schema.js');
  let graph: SvelteFlowGraph;
  try {
    graph = validateSvelteFlowGraph(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof GraphValidationError) {
      const failure = new GraphConfigurationError(filePath, error, logPrefix);
      if (cache) cache[cacheKey] = { source: filePath, mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs, size: stats.size, error: failure };
      throw failure;
    }
    throw error;
  }
  graphSources.set(graph, filePath);
  if (cache) cache[cacheKey] = { source: filePath, mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs, size: stats.size, graph };
  return { graph, source: filePath };
}

/**
 * Load a cognitive graph by mode name with caching
 * @param graphKey - The cognitive mode key (e.g., 'dual', 'agent', 'emulation')
 * @param _username - Deprecated: Big Brother routing now handled at LLM call level
 */
export async function loadGraphForMode(graphKey: string, _username?: string): Promise<LoadedGraph> {
  if (!graphKey) {
    throw new GraphConfigurationError('cognitive-graphs', new Error('A workflow name is required'));
  }

  const normalizedKey = graphKey.toLowerCase();

  // NOTE: Big Brother routing is now handled at the LLM call level (via useBigBrother option in response-synthesizer)
  // Separate -bigbrother graph variants are no longer used. All modes use the standard graph.
  const baseName = `${normalizedKey}-mode`;
  const pathsToCheck = [
    path.join(ROOT, 'etc', 'cognitive-graphs', 'custom', `${baseName}.json`),
    path.join(ROOT, 'etc', 'cognitive-graphs', `${baseName}.json`),
  ];

  for (const filePath of pathsToCheck) {
    const loaded = await loadGraphFile(filePath, { cache: graphCache, cacheKey: normalizedKey });
    if (loaded) return loaded;
  }

  throw new GraphConfigurationError(pathsToCheck.join(' or '), new Error(`Workflow not found: ${graphKey}`));
}

/**
 * Clear the graph cache (useful for hot-reloading)
 */
export function clearGraphCache(): void {
  Object.keys(graphCache).forEach(key => delete graphCache[key]);
}
