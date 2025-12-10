/**
 * Security Policy API Handlers
 *
 * Unified handlers for security policy retrieval.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { loadCognitiveMode } from '../../cognitive-mode.js';

/**
 * GET /api/security/policy - Get current security policy for the UI
 * Returns all permission flags so UI can reactively show/hide features
 * Safe for anonymous users - returns restricted permissions
 */
export async function handleGetSecurityPolicy(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    // Get cognitive mode for write permission check  
    let cognitiveMode: 'dual' | 'agent' | 'emulation' = 'dual';
    try {
      const mode = await loadCognitiveMode();
      cognitiveMode = mode.mode as 'dual' | 'agent' | 'emulation';
    } catch {
      // Use default
    }

    // Determine permissions based on user role and cognitive mode
    const isAuthenticated = user.isAuthenticated;
    const role = user.role || 'anonymous';
    const isOwner = role === 'owner';
    const isGuest = role === 'guest';
    const isAnonymous = !isAuthenticated;

    // Write permissions based on auth status and cognitive mode
    const canWriteMemory = isAuthenticated && cognitiveMode !== 'emulation';
    const canUseOperator = isAuthenticated && cognitiveMode !== 'emulation' && isOwner;
    const canModifyPersona = isAuthenticated && isOwner;
    const canAccessSettings = isAuthenticated;
    const canManageUsers = isAuthenticated && isOwner;
    const canViewAudit = isAuthenticated && isOwner;
    const canManageAgents = isAuthenticated && isOwner;
    const canTrain = isAuthenticated && isOwner;
    const canApprove = isAuthenticated && isOwner;

    return successResponse({
      success: true,
      policy: {
        // Permission flags
        canWriteMemory,
        canUseOperator,
        canModifyPersona,
        canAccessSettings,
        canManageUsers,
        canViewAudit,
        canManageAgents,
        canTrain,
        canApprove,

        // Missing permissions expected by frontend
        canChangeMode: isOwner,
        canChangeTrust: isOwner,
        canAccessTraining: canTrain,
        canFactoryReset: isOwner,

        // Context
        role,
        mode: cognitiveMode,
        sessionId: user.sessionId,

        // Computed helpers for UI
        isReadOnly: !canWriteMemory,
        isOwner,
        isGuest,
        isAnonymous,
      },
    });
  } catch (error) {
    console.error('[security/policy] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}
