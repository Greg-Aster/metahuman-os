import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { paths, audit } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';

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

export const PUT: APIRoute = async (context) => {
  try {
    // Check write permissions
    const policy = getSecurityPolicy(context);
    if (!policy.canWriteMemory) {
      return new Response(
        JSON.stringify({ success: false, error: 'Write access denied. Please log in.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await context.request.json();
    const relPath = body.relPath;
    const content = body.content;

    if (!relPath || content === undefined) {
      return new Response(
        JSON.stringify({ success: false, error: 'relPath and content are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const absolute = resolvePath(relPath);
    if (!fs.existsSync(absolute)) {
      return new Response(
        JSON.stringify({ success: false, error: 'File not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Write the file
    fs.writeFileSync(absolute, content, 'utf8');

    // Audit the change
    audit({
      level: 'info',
      category: 'data',
      event: 'memory_file_edited',
      details: { relPath, size: content.length },
      actor: policy.role,
    });

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
