import type { APIRoute } from 'astro';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '@metahuman/core';

const GRAPHS_DIR = path.join(ROOT, 'etc', 'cognitive-graphs');
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

function sanitizeName(name: string | null): string | null {
  if (!name) return null;
  if (!NAME_REGEX.test(name)) return null;
  return name;
}

async function resolveGraphPath(name: string): Promise<{ filePath: string; scope: 'builtin' | 'custom' } | null> {
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

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const rawName = sanitizeName(url.searchParams.get('name'));
    if (!rawName) {
      return new Response(JSON.stringify({ error: 'Missing or invalid graph name' }), { status: 400 });
    }

    const resolved = await resolveGraphPath(rawName);
    if (!resolved) {
      return new Response(JSON.stringify({ error: 'Graph not found' }), { status: 404 });
    }

    const raw = await fs.readFile(resolved.filePath, 'utf-8');
    const graph = JSON.parse(raw);
    return new Response(JSON.stringify({ name: rawName, scope: resolved.scope, graph }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[cognitive-graph] GET failed:', error);
    return new Response(JSON.stringify({ error: 'Failed to load graph' }), { status: 500 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const rawName = sanitizeName(body?.name);
    const graph = body?.graph;
    const overwrite = Boolean(body?.overwrite);
    if (!rawName || typeof graph !== 'object' || Array.isArray(graph)) {
      return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 });
    }

    await ensureCustomDir();
    const targetPath = path.join(CUSTOM_DIR, `${rawName}.json`);

    if (!overwrite && existsSync(targetPath)) {
      return new Response(JSON.stringify({ error: 'Graph already exists. Use overwrite to replace it.' }), {
        status: 409,
      });
    }

    const builtinPath = path.join(GRAPHS_DIR, `${rawName}.json`);
    if (!overwrite && existsSync(builtinPath)) {
      return new Response(JSON.stringify({ error: 'Cannot overwrite built-in graph without overwrite flag.' }), {
        status: 409,
      });
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

    return new Response(JSON.stringify({ status: 'ok', name: rawName, scope: 'custom', updatedAt: now }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[cognitive-graph] POST failed:', error);
    return new Response(JSON.stringify({ error: 'Failed to save graph' }), { status: 500 });
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const rawName = sanitizeName(url.searchParams.get('name'));
    if (!rawName) {
      return new Response(JSON.stringify({ error: 'Missing or invalid graph name' }), { status: 400 });
    }

    const targetPath = path.join(CUSTOM_DIR, `${rawName}.json`);
    if (!(await fileExists(targetPath))) {
      return new Response(JSON.stringify({ error: 'Graph not found or not deletable' }), { status: 404 });
    }

    await fs.unlink(targetPath);
    return new Response(JSON.stringify({ status: 'deleted', name: rawName }), { status: 200 });
  } catch (error) {
    console.error('[cognitive-graph] DELETE failed:', error);
    return new Response(JSON.stringify({ error: 'Failed to delete graph' }), { status: 500 });
  }
};
