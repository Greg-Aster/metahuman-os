/**
 * Auth Handlers
 *
 * Unified handlers for authentication.
 * Works for both web (via Astro adapter) and mobile (via nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { getUser, authenticateUser, listUsers, getUserForSync } from '../../users.js';
import { createSession, deleteSession } from '../../sessions.js';

/**
 * POST /api/auth/login - Authenticate user
 *
 * This is the unified login handler for both web and mobile.
 * Returns session info that the client should store.
 */
export async function handleLogin(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body } = req;

  const { username, password } = (body || {}) as {
    username?: string;
    password?: string;
  };

  if (!username || !password) {
    return {
      status: 400,
      error: 'Username and password are required',
    };
  }

  // Authenticate against users database
  const user = authenticateUser(username, password);

  if (!user) {
    return {
      status: 401,
      error: 'Invalid username or password',
    };
  }

  // Create session
  const session = createSession(user.id, user.role);

  console.log(`[auth-handler] User ${username} logged in, session: ${session.id.slice(0, 8)}...`);

  return successResponse({
    success: true,
    sessionId: session.id,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      metadata: user.metadata,
    },
  });
}

/**
 * POST /api/auth/logout - Destroy session
 */
export async function handleLogout(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  // Get session ID from body or user context
  const sessionId = (body as any)?.sessionId || req.params?.sessionId;

  if (sessionId) {
    deleteSession(sessionId);
    console.log(`[auth-handler] Session destroyed: ${sessionId.slice(0, 8)}...`);
  }

  return successResponse({
    success: true,
    message: 'Logged out',
  });
}

/**
 * GET /api/auth/users - List available users (for login screen)
 *
 * Returns list of usernames only (no passwords or sensitive data).
 * Useful for mobile login screen to show available accounts.
 */
export async function handleListUsers(_req: UnifiedRequest): Promise<UnifiedResponse> {
  const users = listUsers();

  return successResponse({
    success: true,
    users: users.map(u => ({
      id: u.id,
      username: u.username,
      role: u.role,
      displayName: u.metadata?.displayName,
    })),
  });
}

/**
 * GET /api/auth/me - Get current user
 */
export async function handleGetMe(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return successResponse({
      success: true,
      user: null,
      role: 'anonymous',
    });
  }

  // Get full user details
  const fullUser = getUser(user.userId);

  if (!fullUser) {
    return successResponse({
      success: true,
      user: null,
      role: 'anonymous',
    });
  }

  return successResponse({
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

/**
 * GET /api/profile-sync/user - Get current user data for offline sync
 *
 * Returns full user object including password hash so mobile can
 * authenticate offline. ONLY returns data for the authenticated user.
 *
 * SECURITY: This endpoint requires authentication. The password hash
 * is bcrypt-hashed, so even if intercepted it cannot be reversed.
 * The mobile app stores this locally and uses bcryptjs to verify passwords.
 */
export async function handleSyncUser(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required',
    };
  }

  // Get full user data including password hash
  const fullUser = getUserForSync(user.userId);

  if (!fullUser) {
    return {
      status: 404,
      error: 'User not found',
    };
  }

  console.log(`[auth-handler] Syncing user data for ${fullUser.username} (offline auth)`);

  return successResponse({
    success: true,
    user: {
      id: fullUser.id,
      username: fullUser.username,
      passwordHash: fullUser.passwordHash,
      role: fullUser.role,
      createdAt: fullUser.createdAt,
      lastLogin: fullUser.lastLogin,
      metadata: fullUser.metadata,
    },
    syncedAt: new Date().toISOString(),
  });
}
