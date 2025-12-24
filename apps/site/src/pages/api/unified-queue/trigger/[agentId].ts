/**
 * Unified Queue Trigger Agent API
 *
 * POST: Manually trigger an agent
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { getQueueSystem } from '@metahuman/core';

export const POST: APIRoute = async ({ cookies, params }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const agentId = params.agentId;

    if (!agentId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing agentId' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const queueSystem = getQueueSystem();
    const taskId = queueSystem.triggerAgent(agentId, user.username);

    if (!taskId) {
      return new Response(
        JSON.stringify({ success: false, error: `Unknown agent: ${agentId}` }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'queue_agent_triggered',
      actor: user.username,
      details: { agentId, taskId },
    });

    return new Response(
      JSON.stringify({
        success: true,
        agentId,
        taskId,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[unified-queue/trigger] POST error:', error);
    const status = (error as Error).message.includes('401') ? 401 : 500;
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
