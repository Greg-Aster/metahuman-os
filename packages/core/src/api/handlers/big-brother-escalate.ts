/**
 * Big Brother Escalate API Handlers
 *
 * POST to escalate stuck states to Big Brother for guidance.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { audit } from '../../audit.js';

// Dynamic import for optional big-brother module
let escalateToBigBrother: ((request: any, config: any) => Promise<any>) | null = null;
let loadOperatorConfig: (() => any) | null = null;

async function ensureBigBrotherFunctions(): Promise<boolean> {
  try {
    const bbModule = await import('../../big-brother.js');
    const configModule = await import('../../config.js');
    escalateToBigBrother = bbModule.escalateToBigBrother;
    loadOperatorConfig = configModule.loadOperatorConfig;
    return true;
  } catch {
    return false;
  }
}

interface EscalationRequest {
  goal: string;
  stuckReason: string;
  errorType: string | null;
  scratchpad: any[];
  context: Record<string, any>;
  suggestions: string[];
}

/**
 * POST /api/big-brother-escalate - Escalate to Big Brother for guidance
 */
export async function handleBigBrotherEscalate(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  // Guests cannot use Big Brother escalation
  if (!user.isAuthenticated) {
    return {
      status: 403,
      error: 'Big Brother escalation is not available in guest mode',
      data: {
        guestMode: true,
        suggestions: ['Log in with an authenticated account to use this feature'],
      },
    };
  }

  try {
    const available = await ensureBigBrotherFunctions();
    if (!available || !escalateToBigBrother || !loadOperatorConfig) {
      return {
        status: 501,
        error: 'Big Brother escalation not available',
      };
    }

    const { goal, scratchpad, errorType, context } = body || {};

    // Validate required inputs
    if (!goal) {
      return {
        status: 400,
        error: 'Missing required field: goal',
      };
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
      suggestions: context?.suggestions || [],
    };

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_node_escalation',
      details: {
        goal,
        errorType,
        scratchpadLength: escalationRequest.scratchpad.length,
        triggeredBy: 'node_editor',
      },
      actor: user.username,
    });

    // Escalate to Big Brother
    const response = await escalateToBigBrother(escalationRequest, config);

    return {
      status: response.success ? 200 : 500,
      data: {
        success: response.success,
        suggestions: response.suggestions,
        reasoning: response.reasoning,
        alternativeApproach: response.alternativeApproach,
        error: response.error,
      },
    };
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'big_brother_escalation_error',
      details: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      actor: 'system',
    });

    return {
      status: 500,
      error: error instanceof Error ? error.message : 'Failed to escalate to Big Brother',
    };
  }
}
