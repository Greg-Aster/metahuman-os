/**
 * Persona Handlers
 *
 * Unified handlers for persona data access.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, notFoundResponse } from '../types.js';
import { withUserContext } from '../../context.js';
import { loadPersonaCore, getIdentitySummary } from '../../identity.js';

/**
 * GET /api/persona - Get full persona data
 */
export async function handleGetPersona(req: UnifiedRequest): Promise<UnifiedResponse> {
  const persona = await withUserContext(
    { userId: req.user.userId, username: req.user.username, role: req.user.role },
    () => {
      try {
        return loadPersonaCore();
      } catch {
        return null;
      }
    }
  );

  if (!persona) {
    return notFoundResponse('Persona not found');
  }

  return successResponse({
    success: true,
    persona,
  });
}

/**
 * GET /api/persona/summary - Get persona summary (public)
 */
export async function handleGetPersonaSummary(req: UnifiedRequest): Promise<UnifiedResponse> {
  // For unauthenticated users, return a default summary
  if (!req.user.isAuthenticated) {
    return successResponse({
      success: true,
      summary: {
        name: 'MetaHuman',
        description: 'An autonomous digital personality extension',
      },
    });
  }

  const summary = await withUserContext(
    { userId: req.user.userId, username: req.user.username, role: req.user.role },
    () => {
      try {
        return getIdentitySummary();
      } catch {
        return null;
      }
    }
  );

  return successResponse({
    success: true,
    summary: summary || {
      name: req.user.username,
      description: 'No persona configured',
    },
  });
}
