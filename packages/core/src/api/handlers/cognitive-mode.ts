/**
 * Cognitive Mode Handlers
 *
 * Unified handlers for cognitive mode management.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, badRequestResponse, forbiddenResponse } from '../types.js';
import { withUserContext } from '../../context.js';
import { loadCognitiveMode, saveCognitiveMode } from '../../cognitive-mode.js';

/**
 * GET /api/cognitive-mode - Get current cognitive mode
 */
export async function handleGetCognitiveMode(req: UnifiedRequest): Promise<UnifiedResponse> {
  // For unauthenticated users, return default
  if (!req.user.isAuthenticated) {
    return successResponse({
      success: true,
      mode: 'dual',
      description: 'Default mode',
    });
  }

  const config = await withUserContext(
    { userId: req.user.userId, username: req.user.username, role: req.user.role },
    () => {
      try {
        return loadCognitiveMode();
      } catch {
        return { currentMode: 'dual' as const, lastChanged: new Date().toISOString() };
      }
    }
  );

  // Extract changedBy from history if available
  const lastHistoryEntry = config.history?.[config.history.length - 1];

  return successResponse({
    success: true,
    mode: config.currentMode,
    lastChanged: config.lastChanged,
    changedBy: lastHistoryEntry?.actor,
  });
}

/**
 * POST /api/cognitive-mode - Set cognitive mode
 */
export async function handleSetCognitiveMode(req: UnifiedRequest): Promise<UnifiedResponse> {
  // Only owners can change mode
  if (req.user.role !== 'owner') {
    return forbiddenResponse('Only owners can change cognitive mode');
  }

  const { mode } = req.body || {};

  if (!mode || !['dual', 'agent', 'emulation'].includes(mode)) {
    return badRequestResponse('Invalid mode. Must be: dual, agent, or emulation');
  }

  await withUserContext(
    { userId: req.user.userId, username: req.user.username, role: req.user.role },
    () => saveCognitiveMode(mode, req.user.username)
  );

  return successResponse({
    success: true,
    mode,
  });
}
