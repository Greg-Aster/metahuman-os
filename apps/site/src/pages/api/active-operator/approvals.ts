/**
 * Approval Queue API
 *
 * Endpoints for managing the critic's approval queue.
 * GET - List pending approvals
 * POST - Approve or reject a request
 */

import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  AuthRequiredError,
  criticGetPendingApprovals,
  resolveApproval,
} from '@metahuman/core';

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const approvals = criticGetPendingApprovals(user.username);

    return new Response(
      JSON.stringify({
        approvals,
        count: approvals.length,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    // Return empty list for unauthenticated users
    if (error instanceof AuthRequiredError) {
      return new Response(JSON.stringify({ approvals: [], count: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        error: 'Failed to load approvals',
        message: (error as Error).message,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const body = await request.json();
    const { requestId, approved } = body;

    if (!requestId) {
      return new Response(
        JSON.stringify({ error: 'Missing requestId' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (typeof approved !== 'boolean') {
      return new Response(
        JSON.stringify({ error: 'approved must be a boolean' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const result = resolveApproval(user.username, requestId, approved, user.username);

    if (!result) {
      return new Response(
        JSON.stringify({ error: 'Approval request not found' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        request: result,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        error: 'Failed to resolve approval',
        message: (error as Error).message,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
