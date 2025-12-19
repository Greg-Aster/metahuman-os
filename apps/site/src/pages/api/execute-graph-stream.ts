/**
 * Execute Graph Streaming API - POST /api/execute-graph-stream
 *
 * SSE endpoint for real-time node execution status.
 * Lightweight streaming - events fire as nodes execute.
 */

import type { APIRoute } from 'astro';
import { handleExecuteGraphStream } from '@metahuman/core/api/handlers/execute-graph-stream';
import { getAuthenticatedUser } from '@metahuman/core';

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    // Get authenticated user - required for memory access
    const user = getAuthenticatedUser(cookies);

    const body = await request.json();
    const { graph, sessionId, userMessage } = body || {};

    // Create a ReadableStream for SSE
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        // Event callback - send each event to the stream
        const onEvent = (chunk: string) => {
          controller.enqueue(encoder.encode(chunk));
        };

        try {
          // Execute graph with streaming events - pass username for memory access
          await handleExecuteGraphStream(graph, sessionId, userMessage, user.username, onEvent);
        } catch (error: any) {
          // Send error event if something goes wrong
          const errorEvent = `event: error\ndata: ${JSON.stringify({ error: error?.message || 'Unknown error' })}\n\n`;
          controller.enqueue(encoder.encode(errorEvent));
        } finally {
          // Close the stream
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      },
    });
  } catch (error: any) {
    console.error('[execute-graph-stream] Request error:', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Invalid request' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
