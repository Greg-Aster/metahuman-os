/**
 * Unified Queue Control API
 *
 * POST: Control the queue (start/stop/pause/resume)
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { getQueueSystem } from '@metahuman/core';

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const body = await request.json();

    if (!body.action) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing action' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const queueSystem = getQueueSystem();
    let result = false;

    switch (body.action) {
      case 'start':
        result = await queueSystem.start();
        break;
      case 'stop':
        result = await queueSystem.stop();
        break;
      case 'pause':
        queueSystem.pause();
        result = true;
        break;
      case 'resume':
        queueSystem.resume();
        result = true;
        break;
      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unknown action: ${body.action}` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }

    audit({
      level: 'info',
      category: 'action',
      event: `queue_${body.action}`,
      actor: user.username,
      details: { result },
    });

    return new Response(
      JSON.stringify({
        success: result,
        action: body.action,
        state: queueSystem.getState(),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[unified-queue/control] POST error:', error);
    const status = (error as Error).message.includes('401') ? 401 : 500;
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
