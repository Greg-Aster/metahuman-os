/**
 * Curiosity Questions API Handlers
 *
 * DEPRECATED: Questions now flow through conversation stream via SSE
 * Returns empty array for backward compatibility.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';

/**
 * GET /api/curiosity/questions - Returns empty array (deprecated)
 */
export async function handleGetCuriosityQuestions(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required',
    };
  }

  // Questions no longer stored in pending directory
  // They flow through conversation stream via SSE and are saved to episodic memory when answered
  return successResponse({
    success: true,
    questions: [],
  });
}
