import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { readPersonaInsights } from '../../persona-insights.js';

export async function handleGetPersonaInsights(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) return { status: 401, error: 'Authentication required' };
  try {
    return {
      status: 200,
      data: await readPersonaInsights(req.user.username),
    };
  } catch (error) {
    console.error('[persona-insights] Failed to load insights:', error);
    return {
      status: 500,
      error: error instanceof Error ? error.message : 'Failed to load insights',
    };
  }
}
