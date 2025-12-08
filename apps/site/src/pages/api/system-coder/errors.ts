/**
 * System Coder API - List Errors
 * GET /api/system-coder/errors
 *
 * List captured errors with optional filtering.
 */

import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  listErrors,
  getErrorStats,
  audit,
} from '@metahuman/core';

export const GET: APIRoute = async ({ cookies, url }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    // Parse query parameters
    const status = url.searchParams.get('status')?.split(',') as any[] | undefined;
    const source = url.searchParams.get('source')?.split(',') as any[] | undefined;
    const severity = url.searchParams.get('severity')?.split(',') as any[] | undefined;
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const includeStats = url.searchParams.get('includeStats') === 'true';

    // Get errors
    const { errors, total } = listErrors(user.username, {
      status,
      source,
      severity,
      limit,
      offset,
    });

    const response: any = {
      errors,
      pagination: {
        total,
        offset,
        limit,
        hasMore: offset + errors.length < total,
      },
    };

    // Include stats if requested
    if (includeStats) {
      response.stats = getErrorStats(user.username);
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if ((error as Error).message?.includes('Authentication required')) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    audit({
      level: 'error',
      category: 'system',
      event: 'system_coder_list_errors_failed',
      details: { error: (error as Error).message },
      actor: 'system-coder',
    });

    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
