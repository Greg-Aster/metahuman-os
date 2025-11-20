import type { APIRoute } from 'astro';
import { requestCancellation } from './persona_chat';

/**
 * Cancel Chat API
 * Allows users to interrupt long-running chat requests
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { sessionId, reason } = body;

    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'sessionId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Request cancellation for this session
    requestCancellation(sessionId, reason || 'User requested stop');

    return new Response(JSON.stringify({
      success: true,
      message: `Cancellation requested for session ${sessionId}`
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[cancel-chat] Error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to cancel request: ' + (error as Error).message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
