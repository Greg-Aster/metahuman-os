import type { APIRoute } from 'astro';
import { escalateToBigBrother, type EscalationRequest } from '@metahuman/core/big-brother';
import { loadOperatorConfig } from '@metahuman/core/config';
import { getUserOrAnonymous } from '@metahuman/core/auth';
import { audit } from '@metahuman/core';

/**
 * POST: Escalate a stuck state to Big Brother for guidance
 * Used by the BigBrotherNode in the node editor
 * Guests get a friendly error instead of 401
 */
export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getUserOrAnonymous(cookies);

    // Guests cannot use Big Brother escalation
    if (user.role === 'anonymous') {
      return new Response(JSON.stringify({
        success: false,
        error: 'Big Brother escalation is not available in guest mode',
        guestMode: true,
        suggestions: ['Log in with an authenticated account to use this feature']
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const { goal, scratchpad, errorType, context } = body;

    // Validate required inputs
    if (!goal) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required field: goal'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Load operator config
    const config = loadOperatorConfig();

    // Build escalation request
    const escalationRequest: EscalationRequest = {
      goal,
      stuckReason: context?.stuckReason || 'User manually requested Big Brother escalation',
      errorType: errorType || null,
      scratchpad: scratchpad || [],
      context: context || {},
      suggestions: context?.suggestions || []
    };

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_node_escalation',
      details: {
        goal,
        errorType,
        scratchpadLength: escalationRequest.scratchpad.length,
        triggeredBy: 'node_editor'
      },
      actor: user.username
    });

    // Escalate to Big Brother
    const response = await escalateToBigBrother(escalationRequest, config);

    // Return the response
    return new Response(JSON.stringify({
      success: response.success,
      suggestions: response.suggestions,
      reasoning: response.reasoning,
      alternativeApproach: response.alternativeApproach,
      error: response.error
    }), {
      status: response.success ? 200 : 500,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'big_brother_escalation_error',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      actor: 'system'
    });

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to escalate to Big Brother'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
