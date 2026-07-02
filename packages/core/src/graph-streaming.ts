/**
 * Graph loading and cancellation helpers.
 *
 * Chat and graph API streaming now live with their owning handlers. This module
 * only owns shared graph lookup/cache and request cancellation state.
 */

import type { SvelteFlowGraph } from './cognitive-graph-schema.js';
import { validateSvelteFlowGraph } from './cognitive-graph-schema.js';
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

interface GraphCacheEntry {
  source: string;
  mtimeMs: number;
  graph: SvelteFlowGraph;
}

const graphCache: Record<string, GraphCacheEntry | null> = {};

/**
 * Read and validate a Svelte Flow graph from a file
 */
async function readGraphFromFile(filePath: string): Promise<SvelteFlowGraph | null> {
  try {
    console.log(`[graph-streaming] Reading graph: ${filePath}`);
    const raw = await readFile(filePath, 'utf-8');
    console.log(`[graph-streaming] File size: ${raw.length} bytes`);
    const parsed = JSON.parse(raw);
    console.log(`[graph-streaming] Parsed: ${parsed.nodes?.length || 0} nodes, ${parsed.edges?.length || 0} edges`);
    const validated = validateSvelteFlowGraph(parsed);
    console.log(`[graph-streaming] Validation PASSED`);
    return validated;
  } catch (error) {
    console.error('[graph-streaming] Read error:', error);
    return null;
  }
}

/**
 * Load a cognitive graph by mode name with caching
 * @param graphKey - The cognitive mode key (e.g., 'dual', 'agent', 'emulation')
 * @param _username - Deprecated: Big Brother routing now handled at LLM call level
 */
export async function loadGraphForMode(graphKey: string, _username?: string): Promise<LoadedGraph | null> {
  const loadStart = Date.now();

  if (!graphKey) {
    console.log('[graph-streaming] No graphKey provided');
    return null;
  }

  const normalizedKey = graphKey.toLowerCase();

  // NOTE: Big Brother routing is now handled at the LLM call level (via useBigBrother option in response-synthesizer)
  // Separate -bigbrother graph variants are no longer used. All modes use the standard graph.
  const baseName = `${normalizedKey}-mode`;
  const pathsToCheck = [
    path.join(ROOT, 'etc', 'cognitive-graphs', 'custom', `${baseName}.json`),
    path.join(ROOT, 'etc', 'cognitive-graphs', `${baseName}.json`),
  ];

  console.log(`[graph-streaming] Loading graph: "${graphKey}"`);

  for (const filePath of pathsToCheck) {
    try {
      if (!existsSync(filePath)) continue;

      const stats = await stat(filePath);
      const cached = graphCache[normalizedKey];

      // Use cache if valid
      if (cached && cached.source === filePath && cached.mtimeMs === stats.mtimeMs) {
        console.log(`[graph-streaming] ⏱️ Using cached graph (total: ${Date.now() - loadStart}ms)`);
        return { graph: cached.graph, source: filePath };
      }

      // Load fresh
      const graph = await readGraphFromFile(filePath);
      if (graph) {
        graphCache[normalizedKey] = { source: filePath, mtimeMs: stats.mtimeMs, graph };
        console.log(`[graph-streaming] ⏱️ Graph loaded fresh (total: ${Date.now() - loadStart}ms)`);
        return { graph, source: filePath };
      }
    } catch (error) {
      console.error(`[graph-streaming] Failed to load ${filePath}:`, error);
    }
  }

  console.warn(`[graph-streaming] No valid graph found for "${graphKey}"`);
  return null;
}

/**
 * Clear the graph cache (useful for hot-reloading)
 */
export function clearGraphCache(): void {
  Object.keys(graphCache).forEach(key => delete graphCache[key]);
}
