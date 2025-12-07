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
import os from 'node:os';
import { getUserOrAnonymous, getProfilePaths } from '@metahuman/core';

export const GET: APIRoute = ({ request, cookies }) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode');

  if (mode !== 'conversation' && mode !== 'inner') {
    return new Response(JSON.stringify({ error: 'mode query param required (conversation|inner)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const user = getUserOrAnonymous(cookies);
  const isGuestWithProfile = user.role === 'anonymous' && user.id === 'guest';

  // Pure anonymous (no selected profile) get empty buffer
  if (user.role === 'anonymous' && !isGuestWithProfile) {
    return new Response(JSON.stringify({ messages: [], mode, lastUpdated: null }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Determine buffer path based on user type
  let bufferPath: string;
  if (isGuestWithProfile) {
    // Guest users get session-specific temp directory
    const sessionCookie = cookies.get('mh_session');
    const sessionId = sessionCookie?.value?.substring(0, 16) || 'default';
    const guestTempDir = path.join(os.tmpdir(), 'metahuman-guest', sessionId);
    bufferPath = path.join(guestTempDir, `conversation-buffer-${mode}.json`);
  } else {
    // Authenticated users use their profile storage
    const profilePaths = getProfilePaths(user.username);
    bufferPath = path.join(profilePaths.state, `conversation-buffer-${mode}.json`);
  }

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
