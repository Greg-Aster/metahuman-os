/**
 * Big Brother Terminal Events SSE Endpoint
 *
 * Streams events when the Big Brother terminal auto-opens,
 * allowing the UI to automatically switch to the terminal tab.
 */

import type { APIRoute } from 'astro';
import { bigBrotherTerminal } from '@metahuman/core';

export const GET: APIRoute = async ({ request }) => {
  // Set up SSE response
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let isClosed = false;

      const safeEnqueue = (data: string) => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          isClosed = true;
        }
      };

      // Send initial connection event
      safeEnqueue(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

      // Listen for terminal events
      const handleReady = (info: { port: number; url: string }) => {
        safeEnqueue(`data: ${JSON.stringify({
          type: 'terminal_ready',
          port: info.port,
          url: info.url,
        })}\n\n`);
      };

      const handleOpenTab = (info: { port: number; url: string }) => {
        safeEnqueue(`data: ${JSON.stringify({
          type: 'open_tab',
          port: info.port,
          url: info.url,
        })}\n\n`);
      };

      const handleOutput = (event: any) => {
        // Only send significant output events (not every character)
        if (event.type === 'prompt_sent' || event.type === 'ready') {
          safeEnqueue(`data: ${JSON.stringify({
            type: 'output',
            content: event.content?.substring(0, 200),
          })}\n\n`);
        }
      };

      bigBrotherTerminal.on('ready', handleReady);
      bigBrotherTerminal.on('open_tab', handleOpenTab);
      bigBrotherTerminal.on('output', handleOutput);

      // Send current state
      const state = bigBrotherTerminal.getState();
      if (state.isRunning) {
        safeEnqueue(`data: ${JSON.stringify({
          type: 'terminal_ready',
          port: state.port,
          url: `http://localhost:${state.port}`,
          alreadyRunning: true,
        })}\n\n`);
      }

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        isClosed = true;
        bigBrotherTerminal.off('ready', handleReady);
        bigBrotherTerminal.off('open_tab', handleOpenTab);
        bigBrotherTerminal.off('output', handleOutput);
        try {
          controller.close();
        } catch {
          // Controller already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
};
