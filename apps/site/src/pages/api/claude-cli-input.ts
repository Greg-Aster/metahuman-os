/**
 * Claude CLI Input Endpoint
 *
 * Sends user input to a running Claude CLI session for bidirectional communication.
 * Used when Claude asks a question and the user needs to respond.
 */
import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { sendStdinInput, getSessionStatus } from '@metahuman/core/backends/claude-code-backend';

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    // Require authentication - only owners can interact with Claude CLI
    const user = getAuthenticatedUser(cookies);

    if (user.role !== 'owner') {
      return new Response(
        JSON.stringify({ success: false, error: 'Owner role required' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { input } = body;

    if (!input || typeof input !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'input is required and must be a string' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check session status
    const status = getSessionStatus();
    if (!status.ready) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No active Claude CLI session',
          status,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Send input to Claude CLI stdin
    const success = sendStdinInput(input);

    audit({
      level: 'info',
      category: 'action',
      event: 'claude_cli_user_input',
      details: {
        inputLength: input.length,
        inputPreview: input.substring(0, 50),
        success,
      },
      actor: user.username,
    });

    return new Response(
      JSON.stringify({
        success,
        message: success ? 'Input sent to Claude CLI' : 'Failed to send input',
      }),
      { status: success ? 200 : 500, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const errorMsg = (error as Error).message;

    // Handle auth errors gracefully
    if (errorMsg.includes('Authentication required')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: errorMsg }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * GET endpoint to check Claude CLI session status
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    const status = getSessionStatus();

    return new Response(JSON.stringify(status), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    // Return status even for unauthenticated users (read-only)
    const status = getSessionStatus();
    return new Response(JSON.stringify({ ...status, authenticated: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
