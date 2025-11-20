/**
 * Memory Content API - Read and edit memory files
 * MIGRATED: 2025-11-20 - Explicit authentication pattern
 */

import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { getAuthenticatedUser, getUserOrAnonymous, paths, audit } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';

function resolvePath(relPath: string): string {
  const absolute = path.resolve(paths.root, relPath);
  if (!absolute.startsWith(paths.root)) {
    throw new Error('Invalid path');
  }
  return absolute;
}

const getHandler: APIRoute = async (context) => {
  // Explicit auth - security policy will enforce access rules
  const user = getUserOrAnonymous(context.cookies);

  try {
    const relPath = context.url.searchParams.get('relPath');
    if (!relPath) {
      return new Response(JSON.stringify({ success: false, error: 'relPath is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const absolute = resolvePath(relPath);

    // Check file access permissions
    const policy = getSecurityPolicy(context);
    try {
      policy.requireFileAccess(absolute);
    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: (error as Error).message,
          details: (error as any).details
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

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

const putHandler: APIRoute = async (context) => {
  // Explicit auth - require authentication for writes
  const user = getAuthenticatedUser(context.cookies);

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

    // Check file access permissions (admin for system files, owner for own profile)
    try {
      policy.requireFileAccess(absolute);
    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: (error as Error).message,
          details: (error as any).details
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!fs.existsSync(absolute)) {
      return new Response(
        JSON.stringify({ success: false, error: 'File not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Write the file
    fs.writeFileSync(absolute, content, 'utf8');

    // Audit the change with username
    audit({
      level: 'info',
      category: 'data',
      event: 'memory_file_edited',
      details: {
        relPath,
        size: content.length,
        username: policy.username,
        isAdmin: policy.isAdmin
      },
      actor: policy.username || policy.role,
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

// Export handlers - no withUserContext wrapper needed
// Security policy enforces access control in handlers
export const GET = getHandler;
export const PUT = putHandler;
