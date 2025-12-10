/**
 * Cognitive Graphs List API Handlers
 *
 * GET list of all cognitive graphs.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../../paths.js';

const GRAPHS_DIR = path.join(systemPaths.etc, 'cognitive-graphs');
const CUSTOM_DIR = path.join(GRAPHS_DIR, 'custom');

interface GraphSummary {
  name: string;
  title: string;
  description: string;
  cognitiveMode: string | null;
  scope: 'builtin' | 'custom';
  updatedAt: string;
}

async function listGraphsInDir(
  dirPath: string,
  scope: 'builtin' | 'custom'
): Promise<GraphSummary[]> {
  if (!existsSync(dirPath)) {
    return [];
  }

  const entries = await fs.readdir(dirPath);
  const summaries: GraphSummary[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const filePath = path.join(dirPath, entry);

    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const graph = JSON.parse(raw);
      const stats = await fs.stat(filePath);
      const name = path.basename(entry, '.json');
      summaries.push({
        name,
        title: graph.name || name,
        description: graph.description || '',
        cognitiveMode: graph.cognitiveMode || null,
        scope,
        updatedAt: graph.last_modified || stats.mtime.toISOString(),
      });
    } catch (error) {
      console.warn(`[cognitive-graphs] Skipping invalid graph ${entry}:`, error);
    }
  }

  return summaries;
}

/**
 * GET /api/cognitive-graphs - List all cognitive graphs
 */
export async function handleListCognitiveGraphs(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const builtin = await listGraphsInDir(GRAPHS_DIR, 'builtin');
    const custom = await listGraphsInDir(CUSTOM_DIR, 'custom');

    return successResponse({
      graphs: [...builtin, ...custom],
    });
  } catch (error) {
    console.error('[cognitive-graphs] GET failed:', error);
    return { status: 500, error: 'Failed to list graphs' };
  }
}
