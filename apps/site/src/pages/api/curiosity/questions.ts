/**
 * API endpoint to fetch pending curiosity questions for the current user
 * DEPRECATED: Questions now flow through conversation stream via SSE
 * Returns empty array for backward compatibility
 *
 * GET /api/curiosity/questions - Returns empty array
 */
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
  try {
    const userContext = locals.userContext;

    if (!userContext || userContext.role === 'anonymous') {
      return new Response(
        JSON.stringify({ success: false, message: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Questions no longer stored in pending directory
    // They flow through conversation stream via SSE and are saved to episodic memory when answered
    return new Response(
      JSON.stringify({ success: true, questions: [] }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('[curiosity-api] Error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
