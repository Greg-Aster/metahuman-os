import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '@metahuman/core';

function resolvePath(relPath: string): string {
  const absolute = path.resolve(paths.root, relPath);
  if (!absolute.startsWith(paths.root)) {
    throw new Error('Invalid path');
  }
  return absolute;
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const relPath = url.searchParams.get('relPath');
    if (!relPath) {
      return new Response(JSON.stringify({ success: false, error: 'relPath is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const absolute = resolvePath(relPath);
    if (!fs.existsSync(absolute)) {
      return new Response(JSON.stringify({ success: false, error: 'File not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const raw = fs.readFileSync(absolute, 'utf8');
    let content = raw;
    let format: 'json' | 'text' = 'text';

    if (absolute.endsWith('.json')) {
      try {
        const parsed = JSON.parse(raw);
        content = JSON.stringify(parsed, null, 2);
        format = 'json';
      } catch {
        // Leave as raw text if JSON.parse fails
      }
    }

    return new Response(JSON.stringify({ success: true, content, format }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
