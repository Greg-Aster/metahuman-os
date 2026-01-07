/**
 * SSE endpoint for real-time proposal updates
 *
 * Eliminates polling by pushing proposal events to connected clients.
 * Events: proposal-created, proposal-resolved
 */
import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  AuthRequiredError,
  proposalEvents,
  getOperatorPendingProposals,
  getPendingPostFeedback,
} from '@metahuman/core';

export const GET: APIRoute = ({ request, cookies }) => {
  let username: string | null = null;

  try {
    const user = getAuthenticatedUser(cookies);
    username = user.username;
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    throw error;
  }

  const currentUsername = username;

  const stream = new ReadableStream({
    start(controller) {
      let isClosed = false;

      const sendEvent = (eventType: string, data: object) => {
        if (isClosed) return;
        try {
          controller.enqueue(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
        } catch {
          isClosed = true;
        }
      };

      const sendCurrentState = () => {
        if (isClosed || !currentUsername) return;
        try {
          const proposals = getOperatorPendingProposals(currentUsername);
          const postFeedbackRequests = getPendingPostFeedback(currentUsername);

          sendEvent('state', {
            proposals,
            postFeedbackRequests,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          console.error('[proposals-stream] Error fetching state:', error);
        }
      };

      // Handler for proposal-created events
      const onProposalCreated = (event: { username: string; proposalId: string; taskType: string; proposal: unknown }) => {
        if (event.username !== currentUsername) return;
        sendEvent('proposal-created', {
          proposalId: event.proposalId,
          taskType: event.taskType,
          proposal: event.proposal,
          timestamp: new Date().toISOString(),
        });
      };

      // Handler for proposal-resolved events
      const onProposalResolved = (event: { username: string; proposalId: string; response: string; taskType: string }) => {
        if (event.username !== currentUsername) return;
        sendEvent('proposal-resolved', {
          proposalId: event.proposalId,
          taskType: event.taskType,
          response: event.response,
          timestamp: new Date().toISOString(),
        });
        // Send full state after resolution so UI updates correctly
        sendCurrentState();
      };

      // Subscribe to events
      proposalEvents.on('proposal-created', onProposalCreated);
      proposalEvents.on('proposal-resolved', onProposalResolved);

      // Send initial state
      sendEvent('connected', { timestamp: new Date().toISOString() });
      sendCurrentState();

      // Cleanup on disconnect
      request.signal.addEventListener('abort', () => {
        isClosed = true;
        proposalEvents.off('proposal-created', onProposalCreated);
        proposalEvents.off('proposal-resolved', onProposalResolved);
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
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
