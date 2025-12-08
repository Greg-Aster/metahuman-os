/**
 * System Coder API - Capture Error
 * POST /api/system-coder/capture-error
 *
 * Capture an error from terminal, web console, or build process.
 */

import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  captureError,
  audit,
} from '@metahuman/core';
import type { ErrorCaptureRequest } from '@metahuman/core';

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    const body = await request.json() as ErrorCaptureRequest;

    // Validate required fields
    if (!body.source || !body.message) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: source and message' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate source
    const validSources = ['terminal', 'web_console', 'build', 'test', 'runtime'];
    if (!validSources.includes(body.source)) {
      return new Response(
        JSON.stringify({ error: `Invalid source. Must be one of: ${validSources.join(', ')}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Capture the error
    const error = captureError(user.username, body);

    if (!error) {
      // Error was deduplicated or rate limited
      return new Response(
        JSON.stringify({
          success: true,
          captured: false,
          reason: 'Error was deduplicated or rate limited',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        captured: true,
        error: {
          id: error.id,
          timestamp: error.timestamp,
          source: error.source,
          severity: error.severity,
          status: error.status,
        },
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
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
      event: 'system_coder_capture_error_failed',
      details: { error: (error as Error).message },
      actor: 'system-coder',
    });

    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
