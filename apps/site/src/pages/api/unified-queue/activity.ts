/**
 * Unified Queue Activity API
 *
 * POST: Record user activity (pauses queue temporarily for user interaction)
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser } from '@metahuman/core';
import { getQueueSystem } from '@metahuman/core';

export const POST: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const queueSystem = getQueueSystem();
    queueSystem.recordActivity(user.username);

    return new Response(
      JSON.stringify({
        success: true,
        lastActivity: queueSystem.getState().lastActivity,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[unified-queue/activity] POST error:', error);
    const status = (error as Error).message.includes('401') ? 401 : 500;
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
