/**
 * System Coder API - Ignore Error
 * POST /api/system-coder/errors/{id}/ignore
 *
 * Mark an error as ignored.
 */

import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  updateErrorStatus,
  audit,
} from '@metahuman/core';

export const POST: APIRoute = async ({ cookies, params }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const errorId = params.id;

    if (!errorId) {
      return new Response(
        JSON.stringify({ error: 'Error ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const success = updateErrorStatus(user.username, errorId, 'ignored');

    if (!success) {
      return new Response(
        JSON.stringify({ error: 'Error not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'system_coder_error_ignored',
      details: { errorId },
      actor: user.username,
    });

    return new Response(
      JSON.stringify({ success: true, errorId, status: 'ignored' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    if ((error as Error).message?.includes('Authentication required')) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
