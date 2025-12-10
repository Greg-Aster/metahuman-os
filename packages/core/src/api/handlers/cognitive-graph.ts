/**
 * Cognitive Graph API Handlers
 *
 * GET/POST/DELETE single cognitive graph operations.
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
const NAME_REGEX = /^[a-z0-9_\-]+$/i;

async function ensureCustomDir(): Promise<void> {
  await fs.mkdir(CUSTOM_DIR, { recursive: true });
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
  name: string
): Promise<{ filePath: string; scope: 'builtin' | 'custom' } | null> {
  const fileName = `${name}.json`;
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
 */
export async function handleGetCognitiveGraph(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const rawName = sanitizeName(req.query?.name);
    if (!rawName) {
      return { status: 400, error: 'Missing or invalid graph name' };
    }

    const resolved = await resolveGraphPath(rawName);
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
 */
export async function handleCreateCognitiveGraph(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { body } = req;
    const rawName = sanitizeName(body?.name);
    const graph = body?.graph;
    const overwrite = Boolean(body?.overwrite);

    if (!rawName || typeof graph !== 'object' || Array.isArray(graph)) {
      return { status: 400, error: 'Invalid payload' };
    }

    await ensureCustomDir();
    const targetPath = path.join(CUSTOM_DIR, `${rawName}.json`);

    if (!overwrite && existsSync(targetPath)) {
      return {
        status: 409,
        error: 'Graph already exists. Use overwrite to replace it.',
      };
    }

    const builtinPath = path.join(GRAPHS_DIR, `${rawName}.json`);
    if (!overwrite && existsSync(builtinPath)) {
      return {
        status: 409,
        error: 'Cannot overwrite built-in graph without overwrite flag.',
      };
    }

    const now = new Date().toISOString();
    const graphPayload = {
      version: graph.version || '1.0',
      name: graph.name || rawName,
      description: graph.description || '',
      cognitiveMode: graph.cognitiveMode || null,
      last_modified: now,
      ...graph,
    };

    await fs.writeFile(targetPath, JSON.stringify(graphPayload, null, 2), 'utf-8');

    return successResponse({ status: 'ok', name: rawName, scope: 'custom', updatedAt: now });
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
