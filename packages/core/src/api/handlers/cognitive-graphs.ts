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
const BACKUPS_DIR = path.join(GRAPHS_DIR, 'backups');

interface GraphSummary {
  name: string;
  title: string;
  description: string;
  cognitiveMode: string | null;
  scope: 'builtin' | 'custom' | 'backup';
  updatedAt: string;
  originalName?: string; // For backups: the original graph name
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
    // Skip directories
    const filePath = path.join(dirPath, entry);
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) continue;

    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const graph = JSON.parse(raw);
      const name = path.basename(entry, '.json');
      summaries.push({
        name,
        title: graph.name || name,
        description: graph.description || '',
        cognitiveMode: graph.cognitiveMode || null,
        scope,
        updatedAt: graph.last_modified || stat.mtime.toISOString(),
      });
    } catch (error) {
      console.warn(`[cognitive-graphs] Skipping invalid graph ${entry}:`, error);
    }
  }

  return summaries;
}

async function listBackups(): Promise<GraphSummary[]> {
  if (!existsSync(BACKUPS_DIR)) {
    return [];
  }

  const entries = await fs.readdir(BACKUPS_DIR);
  const summaries: GraphSummary[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const filePath = path.join(BACKUPS_DIR, entry);

    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const graph = JSON.parse(raw);
      const stat = await fs.stat(filePath);
      const name = path.basename(entry, '.json');

      // Extract original name from backup filename (e.g., "dual-mode_2024-01-15T10-30-00-000Z")
      const match = name.match(/^(.+?)_(\d{4}-\d{2}-\d{2}T.+)$/);
      const originalName = match ? match[1] : name;
      const timestamp = match ? match[2].replace(/-/g, ':').replace('T', ' ').slice(0, 19) : '';

      summaries.push({
        name,
        title: `${graph.name || originalName} (backup ${timestamp})`,
        description: graph.description || '',
        cognitiveMode: graph.cognitiveMode || null,
        scope: 'backup',
        updatedAt: stat.mtime.toISOString(),
        originalName,
      });
    } catch (error) {
      console.warn(`[cognitive-graphs] Skipping invalid backup ${entry}:`, error);
    }
  }

  // Sort backups by date (newest first)
  summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return summaries;
}

/**
 * GET /api/cognitive-graphs - List all cognitive graphs
 * Query params:
 *   - includeBackups: boolean (default false) - Include backup files in response
 */
export async function handleListCognitiveGraphs(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const includeBackups = req.query?.includeBackups === 'true';

    const builtin = await listGraphsInDir(GRAPHS_DIR, 'builtin');
    const custom = await listGraphsInDir(CUSTOM_DIR, 'custom');
    const backups = includeBackups ? await listBackups() : [];

    return successResponse({
      graphs: [...builtin, ...custom],
      backups,
    });
  } catch (error) {
    console.error('[cognitive-graphs] GET failed:', error);
    return { status: 500, error: 'Failed to list graphs' };
  }
}
