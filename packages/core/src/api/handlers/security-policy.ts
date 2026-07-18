/**
 * Security Policy API Handlers
 *
 * Unified handlers for security policy retrieval.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { loadCognitiveMode, type CognitiveModeId } from '../../cognitive-mode.js';
import { computeSecurityPolicy, type SessionInfo } from '../../security-policy.js';

/**
 * GET /api/security/policy - Get current security policy for the UI
 * Returns all permission flags so UI can reactively show/hide features
 * Unauthenticated requests receive the same restricted guest policy used by
 * every other core authorization path.
 */
export async function handleGetSecurityPolicy(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    // Get cognitive mode for write permission check  
    let cognitiveMode: CognitiveModeId = 'dual';
    try {
      const mode = await loadCognitiveMode();
      cognitiveMode = mode.currentMode;
    } catch {
      // Use default
    }

    const isAuthenticated = user.isAuthenticated;
    const session: SessionInfo | null = isAuthenticated
      ? {
          id: user.userId,
          username: user.username,
          role: user.role,
        }
      : null;
    const policy = computeSecurityPolicy(cognitiveMode, session);
    const isOwner = policy.role === 'owner';
    const isGuest = policy.role === 'guest';
    const isAnonymous = !isAuthenticated;

    // UI-specific names are projections of the core policy, not a second
    // permission calculation.
    const canModifyPersona = policy.canEditOwnProfile;
    const canAccessSettings = isAuthenticated;
    const canManageUsers = policy.canAccessAllProfiles;
    const canViewAudit = policy.canEditSystemCode;
    const canManageAgents = policy.canEditSystemCode;
    const canApprove = isOwner;

    return successResponse({
      success: true,
      policy: {
        // Permission flags
        canWriteMemory: policy.canWriteMemory,
        canUseOperator: policy.canUseOperator,
        canModifyPersona,
        canAccessSettings,
        canManageUsers,
        canViewAudit,
        canManageAgents,
        canTrain: policy.canAccessTraining,
        canApprove,

        canChangeMode: policy.canChangeMode,
        canChangeTrust: policy.canChangeTrust,
        canAccessTraining: policy.canAccessTraining,
        canFactoryReset: policy.canFactoryReset,

        // Context
        role: policy.role,
        mode: policy.mode,
        sessionId: user.sessionId,

        // Computed helpers for UI
        isReadOnly: !policy.canWriteMemory,
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
