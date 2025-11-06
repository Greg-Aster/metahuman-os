import type { APIRoute } from 'astro';
import { updateProfileVisibility, getUser } from '@metahuman/core/users';

/**
 * GET /api/profiles/visibility
 *
 * Get current user's profile visibility setting
 */
export const GET: APIRoute = async (context) => {
  try {
    const userContext = context.locals.userContext;

    if (!userContext || userContext.role === 'anonymous') {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const user = getUser(userContext.userId);
    const visibility = user?.metadata?.profileVisibility || 'private';

    return new Response(
      JSON.stringify({ success: true, visibility }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[profiles/visibility] GET error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Failed to get visibility' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * POST /api/profiles/visibility
 *
 * Update current user's profile visibility
 * Body: { "visibility": "public" | "private" }
 */
export const POST: APIRoute = async (context) => {
  try {
    const userContext = context.locals.userContext;

    if (!userContext || userContext.role === 'anonymous') {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await context.request.json();
    const { visibility } = body;

    if (!['private', 'public'].includes(visibility)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid visibility value (private|public)',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const updated = updateProfileVisibility(userContext.userId, visibility);

    if (!updated) {
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to update visibility' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, visibility }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[profiles/visibility] POST error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Failed to update visibility',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
