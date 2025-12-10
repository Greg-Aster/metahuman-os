/**
 * Lifeline Trigger API Handler
 *
 * POST to trigger lifeline panic protocol (simulation).
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { audit } from '../../audit.js';

/**
 * POST /api/lifeline/trigger - Trigger lifeline panic protocol
 */
export async function handleLifelineTrigger(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { body } = req;
    const source = body?.source || 'unknown';

    // Audit the panic trigger
    await audit({
      level: 'info',
      category: 'security',
      event: 'lifeline_panic',
      details: {
        source,
        timestamp: new Date().toISOString(),
        note: 'Theatrical trigger only - no actual emergency systems engaged',
      },
      actor: 'human',
    });

    return successResponse({
      success: true,
      message: 'Lifeline protocol triggered (simulation only)',
    });
  } catch (error) {
    console.error('[lifeline-trigger] POST failed:', error);
    return { status: 500, error: (error as Error).message || 'Failed to trigger protocol' };
  }
}
