/**
 * Cognitive Mode Handlers
 *
 * Unified handlers for cognitive mode management.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, badRequestResponse, forbiddenResponse, unauthorizedResponse } from '../types.js';
import { withUserContext } from '../../context.js';
import {
  loadCognitiveMode,
  saveCognitiveMode,
  listCognitiveModes,
  applyModeDefaults,
  type CognitiveModeId,
} from '../../cognitive-mode.js';
import { loadTrustCoupling, getMappedTrustLevel } from '../../trust-coupling.js';
import { setTrustLevel } from '../../identity.js';
import { audit } from '../../audit.js';

/**
 * GET /api/cognitive-mode - Get current cognitive mode
 */
export async function handleGetCognitiveMode(req: UnifiedRequest): Promise<UnifiedResponse> {
  // Guest with profile can view (read-only)
  const isGuestWithProfile = !req.user.isAuthenticated && req.user.userId === 'guest';

  // Block anonymous users without guest profile
  if (!req.user.isAuthenticated && !isGuestWithProfile) {
    return unauthorizedResponse('Authentication required to view cognitive mode');
  }

  const result = await withUserContext(
    { userId: req.user.userId, username: req.user.username, role: req.user.role },
    () => {
      const config = loadCognitiveMode();
      const modes = listCognitiveModes();

      return {
        mode: config.currentMode,
        savedMode: config.currentMode,
        lastChanged: config.lastChanged,
        locked: config.locked ?? false,
        history: config.history ?? [],
        modes,
      };
    }
  );

  return successResponse(result);
}

/**
 * POST /api/cognitive-mode - Set cognitive mode
 */
export async function handleSetCognitiveMode(req: UnifiedRequest): Promise<UnifiedResponse> {
  // Require authentication
  if (!req.user.isAuthenticated) {
    return unauthorizedResponse('Authentication required to modify cognitive mode');
  }

  // Guests cannot change mode
  if (req.user.role === 'guest') {
    return forbiddenResponse('Guests cannot change cognitive mode (emulation only)');
  }

  const { mode: rawMode, actor: bodyActor } = req.body || {};
  const mode = String(rawMode ?? '').toLowerCase() as CognitiveModeId;

  if (!mode || !listCognitiveModes().some(def => def.id === mode)) {
    return badRequestResponse('Invalid cognitive mode');
  }

  const actor = typeof bodyActor === 'string' ? bodyActor : req.user.username;

  const result = await withUserContext(
    { userId: req.user.userId, username: req.user.username, role: req.user.role },
    () => {
      const currentConfig = loadCognitiveMode();

      // Audit the mode change
      audit({
        level: 'warn',
        category: 'security',
        event: 'cognitive_mode_change',
        details: {
          from: currentConfig.currentMode,
          to: mode,
          actor,
        },
        actor,
      });

      const updated = saveCognitiveMode(mode, actor);
      applyModeDefaults(mode);

      // Check if trust level should be automatically adjusted based on coupling
      const coupling = loadTrustCoupling();
      if (coupling.coupled) {
        const mappedTrustLevel = getMappedTrustLevel(mode);
        setTrustLevel(mappedTrustLevel);

        audit({
          level: 'info',
          category: 'security',
          event: 'trust_level_auto_adjusted',
          details: {
            trigger: 'cognitive_mode_change',
            mode,
            newTrustLevel: mappedTrustLevel,
            reason: 'Trust coupling enabled',
          },
          actor,
        });
      }

      return {
        success: true,
        mode: updated.currentMode,
        lastChanged: updated.lastChanged,
        history: updated.history ?? [],
      };
    }
  );

  return successResponse(result);
}
