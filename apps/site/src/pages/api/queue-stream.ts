/**
 * Queue Event Stream API
 *
 * SSE endpoint that forwards queue events to connected clients.
 * Events: task_enqueued, task_started, task_completed, task_failed, lane_blocked, lane_unblocked
 */
import type { APIRoute } from 'astro';
import { getAuthenticatedUser, AuthRequiredError, getQueueManager, type QueueEvent } from '@metahuman/core';

export const GET: APIRoute = ({ request, cookies }) => {
  // Authenticate user
  let user;
  try {
    user = getAuthenticatedUser(cookies);
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue(`data: ${JSON.stringify({ type: 'error', error: 'Not authenticated' })}\n\n`);
          controller.close();
        },
      });
      return new Response(errorStream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }
    throw error;
  }

  const stream = new ReadableStream({
    start(controller) {
      let isClosed = false;

      const sendEvent = (data: object) => {
        if (isClosed) return;
        try {
          controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
        } catch {
          isClosed = true;
        }
      };

      // Get queue manager singleton and register listener
      const queueManager = getQueueManager();

      const listener = (event: QueueEvent) => {
        if (isClosed) return;
        console.log(`[queue-stream] Forwarding event: ${event.type}`);
        sendEvent(event);
      };

      queueManager.addEventListener(listener);

      // Send initial connected event
      sendEvent({ type: 'connected', timestamp: new Date().toISOString() });

      // Cleanup on disconnect
      request.signal.addEventListener('abort', () => {
        console.log('[queue-stream] Client disconnected');
        isClosed = true;
        queueManager.removeEventListener(listener);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
