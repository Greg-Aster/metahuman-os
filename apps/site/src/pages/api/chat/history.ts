import type { APIRoute } from 'astro'
import fs from 'node:fs'
import path from 'node:path'
import { getProfilePaths, getUserOrAnonymous } from '@metahuman/core'

export const GET: APIRoute = async ({ request, cookies }) => {
  try {
    const user = getUserOrAnonymous(cookies);
    const url = new URL(request.url);
    const mode = (url.searchParams.get('mode') === 'inner') ? 'inner' : 'conversation';
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 80)));

    if (user.role === 'anonymous') {
      return new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const profilePaths = getProfilePaths(user.username);
    const bufferPath = path.join(profilePaths.state, `conversation-buffer-${mode}.json`);

    // BUFFER-ONLY: Load ONLY from buffer file, no slow episodic/audit scanning
    try {
      if (!fs.existsSync(bufferPath)) {
        console.log(`[chat/history] No buffer file found, returning empty`);
        return new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-Source': 'buffer-empty' }
        });
      }

      const bufferRaw = fs.readFileSync(bufferPath, 'utf-8');
      const buffer = JSON.parse(bufferRaw);

      if (!buffer || !buffer.messages || !Array.isArray(buffer.messages)) {
        console.log(`[chat/history] Invalid buffer structure, returning empty`);
        return new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'X-Source': 'buffer-invalid' }
        });
      }

      // Filter out system messages and summary markers to get actual conversation
      const bufferMessages = buffer.messages
        .filter((msg: any) => msg.role !== 'system' && !msg.meta?.summaryMarker)
        .map((msg: any) => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
          timestamp: msg.timestamp || Date.now(),
          meta: msg.meta
        }));

      console.log(`[chat/history] ✅ Loaded ${bufferMessages.length} messages from buffer (${mode})`);

      return new Response(JSON.stringify({ messages: bufferMessages.slice(-limit) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Source': 'buffer' }
      });
    } catch (error) {
      console.error('[chat/history] Buffer load failed:', error);
      return new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Source': 'buffer-error' }
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
