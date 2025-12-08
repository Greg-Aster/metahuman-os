/**
 * System Coder API - Request Fix for Error
 * POST /api/system-coder/errors/{id}/fix
 *
 * Request a fix to be generated for an error.
 * This triggers the system coder agent via Big Brother.
 */

import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  getError,
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

    // Get the error
    const error = getError(user.username, errorId);
    if (!error) {
      return new Response(
        JSON.stringify({ error: 'Error not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update status to reviewing
    updateErrorStatus(user.username, errorId, 'reviewing');

    audit({
      level: 'info',
      category: 'action',
      event: 'system_coder_fix_requested',
      details: {
        errorId,
        errorSource: error.source,
        errorSeverity: error.severity,
        messagePreview: error.message.substring(0, 100),
      },
      actor: user.username,
    });

    // TODO: In Phase 2, this will trigger the system-coder agent
    // which will use Big Brother to analyze the error and generate a fix.
    // For now, we just acknowledge the request.

    return new Response(
      JSON.stringify({
        success: true,
        errorId,
        status: 'reviewing',
        message: 'Fix request queued. The system coder agent will process this error.',
      }),
      { status: 202, headers: { 'Content-Type': 'application/json' } }
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
