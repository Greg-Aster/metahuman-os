import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  getUserOrAnonymous,
  audit,
} from '@metahuman/core';
import {
  listScratchpadEntries,
  loadScratchpadEntry,
  loadScratchpadEntriesPaginated,
  loadDesire,
  type DesireScratchpadEntry,
} from '@metahuman/core';

/**
 * GET /api/agency/scratchpad
 * Returns scratchpad entries for a desire
 * Query params:
 *   - desireId: string (required)
 *   - offset: number (optional, default 0)
 *   - limit: number (optional, default 20)
 *   - filename: string (optional, for single entry)
 */
export const GET: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getUserOrAnonymous(cookies);
    if (user.role === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required to view scratchpad.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const url = new URL(request.url);
    const desireId = url.searchParams.get('desireId');
    const filename = url.searchParams.get('filename');
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    if (!desireId) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameter: desireId' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify desire exists
    const desire = await loadDesire(desireId, user.username);
    if (!desire) {
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // If filename is specified, return single entry
    if (filename) {
      const entry = await loadScratchpadEntry(desireId, filename, user.username);
      if (!entry) {
        return new Response(
          JSON.stringify({ error: 'Scratchpad entry not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ entry }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Otherwise return paginated list
    const result = await loadScratchpadEntriesPaginated(desireId, offset, limit, user.username);

    // Also get the list of filenames for navigation
    const files = await listScratchpadEntries(desireId, user.username);

    return new Response(
      JSON.stringify({
        entries: result.entries,
        total: result.total,
        files,
        offset,
        limit,
        desireId,
        desireTitle: desire.title,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[API] Scratchpad error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
