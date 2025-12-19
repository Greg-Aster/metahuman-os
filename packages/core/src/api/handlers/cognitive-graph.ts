/**
 * Cognitive Graph API Handlers
 *
 * GET/POST/DELETE single cognitive graph operations.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 *
 * Save behavior:
 * - Creates backup before overwriting existing graphs
 * - Saves to original location (built-in or custom)
 * - Backups stored in etc/cognitive-graphs/backups/
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
const NAME_REGEX = /^[a-z0-9_\-]+$/i;

async function ensureCustomDir(): Promise<void> {
  await fs.mkdir(CUSTOM_DIR, { recursive: true });
}

async function ensureBackupsDir(): Promise<void> {
  await fs.mkdir(BACKUPS_DIR, { recursive: true });
}

/**
 * Check if a backup already exists for this graph
 */
async function backupExists(graphName: string): Promise<boolean> {
  try {
    if (!existsSync(BACKUPS_DIR)) return false;
    const entries = await fs.readdir(BACKUPS_DIR);
    // Check if any backup starts with this graph name
    return entries.some(entry => entry.startsWith(`${graphName}_`) && entry.endsWith('.json'));
  } catch {
    return false;
  }
}

/**
 * Create a backup of an existing graph before overwriting
 * Only creates ONE backup per graph (the original) - subsequent saves don't create new backups
 */
async function createBackup(filePath: string, graphName: string): Promise<string | null> {
  try {
    if (!(await fileExists(filePath))) {
      return null;
    }

    // Only create backup if one doesn't already exist for this graph
    if (await backupExists(graphName)) {
      console.log(`[cognitive-graph] Backup already exists for ${graphName}, skipping`);
      return null;
    }

    await ensureBackupsDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${graphName}_${timestamp}.json`;
    const backupPath = path.join(BACKUPS_DIR, backupName);

    await fs.copyFile(filePath, backupPath);
    console.log(`[cognitive-graph] Created backup: ${backupName}`);
    return backupName;
  } catch (error) {
    console.error('[cognitive-graph] Backup failed:', error);
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeName(name: string | null | undefined): string | null {
  if (!name) return null;
  if (!NAME_REGEX.test(name)) return null;
  return name;
}

async function resolveGraphPath(
  name: string,
  scope?: string
): Promise<{ filePath: string; scope: 'builtin' | 'custom' | 'backup' } | null> {
  const fileName = `${name}.json`;

  // If scope is specified, only look in that location
  if (scope === 'backup') {
    const backupPath = path.join(BACKUPS_DIR, fileName);
    if (await fileExists(backupPath)) {
      return { filePath: backupPath, scope: 'backup' };
    }
    return null;
  }

  // Otherwise, check custom then builtin
  const customPath = path.join(CUSTOM_DIR, fileName);
  if (await fileExists(customPath)) {
    return { filePath: customPath, scope: 'custom' };
  }
  const builtinPath = path.join(GRAPHS_DIR, fileName);
  if (await fileExists(builtinPath)) {
    return { filePath: builtinPath, scope: 'builtin' };
  }
  return null;
}

/**
 * GET /api/cognitive-graph - Get a single cognitive graph by name
 * Query params:
 *   - name: string (required) - Graph name (filename without .json)
 *   - scope: string (optional) - 'backup' to load from backups directory
 */
export async function handleGetCognitiveGraph(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const rawName = sanitizeName(req.query?.name);
    const scope = req.query?.scope;

    if (!rawName) {
      return { status: 400, error: 'Missing or invalid graph name' };
    }

    const resolved = await resolveGraphPath(rawName, scope);
    if (!resolved) {
      return { status: 404, error: 'Graph not found' };
    }

    const raw = await fs.readFile(resolved.filePath, 'utf-8');
    const graph = JSON.parse(raw);
    return successResponse({ name: rawName, scope: resolved.scope, graph });
  } catch (error) {
    console.error('[cognitive-graph] GET failed:', error);
    return { status: 500, error: 'Failed to load graph' };
  }
}

/**
 * POST /api/cognitive-graph - Create/update a cognitive graph
 *
 * Behavior:
 * - If graph exists (built-in or custom), creates backup then overwrites
 * - If new graph, saves to built-in location (not custom)
 * - Always creates backup before overwriting existing files
 */
export async function handleCreateCognitiveGraph(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { body } = req;
    const rawName = sanitizeName(body?.name);
    const graph = body?.graph;

    if (!rawName || typeof graph !== 'object' || Array.isArray(graph)) {
      return { status: 400, error: 'Invalid payload' };
    }

    // Determine where to save: check if built-in exists first, then custom
    const builtinPath = path.join(GRAPHS_DIR, `${rawName}.json`);
    const customPath = path.join(CUSTOM_DIR, `${rawName}.json`);

    let targetPath: string;
    let scope: 'builtin' | 'custom';
    let backupCreated: string | null = null;

    if (existsSync(builtinPath)) {
      // Overwriting built-in graph - create backup first
      backupCreated = await createBackup(builtinPath, rawName);
      targetPath = builtinPath;
      scope = 'builtin';
    } else if (existsSync(customPath)) {
      // Overwriting custom graph - create backup first
      backupCreated = await createBackup(customPath, rawName);
      targetPath = customPath;
      scope = 'custom';
    } else {
      // New graph - save to built-in location
      targetPath = builtinPath;
      scope = 'builtin';
    }

    const now = new Date().toISOString();
    const graphPayload = {
      version: graph.version || '1.0',
      format: 'svelte-flow',
      name: graph.name || rawName,
      description: graph.description || '',
      cognitiveMode: graph.cognitiveMode || null,
      last_modified: now,
      ...graph,
    };

    await fs.writeFile(targetPath, JSON.stringify(graphPayload, null, 2), 'utf-8');

    console.log(`[cognitive-graph] Saved ${rawName} to ${scope} (backup: ${backupCreated || 'none'})`);

    return successResponse({
      status: 'ok',
      name: rawName,
      scope,
      updatedAt: now,
      backupCreated,
    });
  } catch (error) {
    console.error('[cognitive-graph] POST failed:', error);
    return { status: 500, error: 'Failed to save graph' };
  }
}

/**
 * DELETE /api/cognitive-graph - Delete a custom cognitive graph
 */
export async function handleDeleteCognitiveGraph(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const rawName = sanitizeName(req.query?.name);
    if (!rawName) {
      return { status: 400, error: 'Missing or invalid graph name' };
    }

    const targetPath = path.join(CUSTOM_DIR, `${rawName}.json`);
    if (!(await fileExists(targetPath))) {
      return { status: 404, error: 'Graph not found or not deletable' };
    }

    await fs.unlink(targetPath);
    return successResponse({ status: 'deleted', name: rawName });
  } catch (error) {
    console.error('[cognitive-graph] DELETE failed:', error);
    return { status: 500, error: 'Failed to delete graph' };
  }
}
