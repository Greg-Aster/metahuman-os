/**
 * Mobile Auth Handlers
 *
 * Authentication without cookies - uses session tokens directly
 */

import { validateSession } from '../sessions.js';
import { getUser } from '../users.js';
import type { MobileRequest, MobileResponse, MobileUserContext } from './types.js';
import { successResponse, errorResponse } from './types.js';

/**
 * Resolve user context from session token
 */
export function resolveUserFromToken(sessionToken?: string): MobileUserContext {
  if (!sessionToken) {
    return {
      userId: 'anonymous',
      username: 'anonymous',
      role: 'anonymous',
      isAuthenticated: false,
    };
  }

  const session = validateSession(sessionToken);
  if (!session) {
    return {
      userId: 'anonymous',
      username: 'anonymous',
      role: 'anonymous',
      isAuthenticated: false,
    };
  }

  // Handle anonymous sessions with profiles
  if (session.role === 'anonymous') {
    const activeProfile = session.metadata?.activeProfile;
    if (activeProfile) {
      return {
        userId: session.userId,
        username: 'anonymous',
        role: 'anonymous',
        isAuthenticated: false,
      };
    }
    return {
      userId: 'anonymous',
      username: 'anonymous',
      role: 'anonymous',
      isAuthenticated: false,
    };
  }

  // Get authenticated user
  const user = getUser(session.userId);
  if (!user) {
    return {
      userId: 'anonymous',
      username: 'anonymous',
      role: 'anonymous',
      isAuthenticated: false,
    };
  }

  return {
    userId: user.id,
    username: user.username,
    role: user.role as 'owner' | 'guest' | 'anonymous',
    isAuthenticated: true,
  };
}

/**
 * GET /api/auth/me - Get current user
 */
export async function handleGetMe(
  request: MobileRequest,
  user: MobileUserContext
): Promise<MobileResponse> {
  if (!user.isAuthenticated) {
    return successResponse(request.id, {
      success: true,
      user: null,
      role: 'anonymous',
    });
  }

  const fullUser = getUser(user.userId);
  if (!fullUser) {
    return successResponse(request.id, {
      success: true,
      user: null,
      role: 'anonymous',
    });
  }

  return successResponse(request.id, {
    success: true,
    user: {
      id: fullUser.id,
      username: fullUser.username,
      role: fullUser.role,
      metadata: fullUser.metadata,
      lastLogin: fullUser.lastLogin,
    },
    role: fullUser.role,
  });
}
