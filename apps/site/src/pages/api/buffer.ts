/**
 * Conversation Buffer API - Simple GET endpoint
 *
 * Returns the current buffer contents directly (no SSE).
 * Use this for initial page load and tab switching.
 *
 * Query params:
 *   - mode: 'conversation' | 'inner' (required)
 */
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { getAuthenticatedUser, getProfilePaths } from '@metahuman/core';

export const GET: APIRoute = ({ request, cookies }) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode');

  if (mode !== 'conversation' && mode !== 'inner') {
    return new Response(JSON.stringify({ error: 'mode query param required (conversation|inner)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let username: string;
  try {
    const user = getAuthenticatedUser(cookies);
    username = user.username;
  } catch {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const profilePaths = getProfilePaths(username);
  const bufferPath = path.join(profilePaths.state, `conversation-buffer-${mode}.json`);

  try {
    if (!fs.existsSync(bufferPath)) {
      return new Response(JSON.stringify({ messages: [], mode, lastUpdated: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const raw = fs.readFileSync(bufferPath, 'utf-8');
    const buffer = JSON.parse(raw);
    const messages = (buffer.messages || [])
      .filter((msg: any) => msg.role !== 'system' && !msg.meta?.summaryMarker)
      .map((msg: any) => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp || Date.now(),
        meta: msg.meta,
      }));

    return new Response(JSON.stringify({ messages, mode, lastUpdated: buffer.lastUpdated }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(`[buffer] Error reading ${mode} buffer:`, error);
    return new Response(JSON.stringify({ error: 'Failed to read buffer' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
