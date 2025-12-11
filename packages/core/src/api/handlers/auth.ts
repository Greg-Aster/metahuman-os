/**
 * Auth Handlers
 *
 * Unified handlers for authentication.
 * Works for both web (via Astro adapter) and mobile (via nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { getUser, getUserByUsername, authenticateUser, listUsers, createUser, hasOwner, updateUserMetadata, getProfileStorageConfig, deleteUser, updatePassword, verifyUserPassword, updateUsername } from '../../users.js';
import type { ProfileStorageConfig } from '../../users.js';
import { createSession, deleteSession } from '../../sessions.js';
import { initializeProfile } from '../../profile.js';
import { unlockProfile, lockProfile } from '../../encryption-manager.js';
import { audit } from '../../audit.js';
import { getSession } from '../../sessions.js';
import { generateRecoveryCodes, saveRecoveryCodes, verifyRecoveryCode } from '../../recovery-codes.js';

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

  // Auto-unlock encrypted storage if using login password
  let encryptionUnlocked = false;
  let encryptionError: string | undefined;

  try {
    const storageConfig = getProfileStorageConfig(user.username);
    const encType = storageConfig?.encryption?.type;
    const useLoginPassword = storageConfig?.encryption?.useLoginPassword;

    // Auto-unlock for LUKS or AES-256 when using login password
    if ((encType === 'luks' || encType === 'aes256') && useLoginPassword) {
      const unlockResult = await unlockProfile(user.id, password);
      encryptionUnlocked = unlockResult.success;
      if (!unlockResult.success) {
        encryptionError = unlockResult.error;
        console.warn('[auth-handler] Failed to auto-unlock encrypted storage:', unlockResult.error);
      } else {
        audit({
          level: 'info',
          category: 'security',
          event: 'encryption_auto_unlocked',
          details: {
            userId: user.id,
            username: user.username,
            encryptionType: encType,
          },
          actor: user.id,
        });
      }
    }
  } catch (unlockError) {
    console.error('[auth-handler] Error during auto-unlock:', unlockError);
    encryptionError = (unlockError as Error).message;
  }

  // Audit the login
  audit({
    level: 'info',
    category: 'security',
    event: 'user_logged_in',
    details: {
      userId: user.id,
      username: user.username,
      role: user.role,
      sessionId: session.id,
      encryptionUnlocked,
      encryptionError,
    },
    actor: user.id,
  });

  // Return session with cookie - SAME FOR WEB AND MOBILE
  return {
    status: 200,
    data: {
      success: true,
      sessionId: session.id,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        metadata: user.metadata,
      },
      encryptionUnlocked,
      encryptionError,
    },
    // Set session cookie - adapters (web/mobile HTTP) will apply this
    cookies: [{
      action: 'set' as const,
      name: 'mh_session',
      value: session.id,
      options: {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        maxAge: 60 * 60 * 24, // 24 hours
      },
    }],
  };
}

/**
 * POST /api/auth/logout - Destroy session
 */
export async function handleLogout(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body, metadata } = req;

  // Get session ID from body (mobile), params, or metadata (from cookie via adapter)
  const sessionId = (body as any)?.sessionId || req.params?.sessionId || metadata?.sessionToken;

  let userId: string | undefined;
  let username: string | undefined;

  if (sessionId) {
    // Get session info before deleting
    const session = getSession(sessionId);
    if (session) {
      userId = session.userId;
      const user = getUser(userId);
      username = user?.username;

      // Auto-lock encrypted storage if using login password
      if (username) {
        try {
          const storageConfig = getProfileStorageConfig(username);
          const encType = storageConfig?.encryption?.type;
          const useLoginPassword = storageConfig?.encryption?.useLoginPassword;

          if ((encType === 'luks' || encType === 'aes256') && useLoginPassword) {
            const lockResult = await lockProfile(userId);
            if (lockResult.success) {
              audit({
                level: 'info',
                category: 'security',
                event: 'encryption_auto_locked',
                details: { userId, username, encryptionType: encType },
                actor: userId,
              });
            } else {
              console.warn('[auth-handler] Failed to auto-lock encrypted storage:', lockResult.error);
            }
          }
        } catch (lockError) {
          console.error('[auth-handler] Error during auto-lock:', lockError);
        }
      }
    }

    // Delete session
    const deleted = deleteSession(sessionId);
    if (deleted) {
      console.log(`[auth-handler] Session destroyed: ${sessionId.slice(0, 8)}...`);
      audit({
        level: 'info',
        category: 'security',
        event: 'user_logged_out',
        details: { sessionId, userId, username },
        actor: userId || 'user',
      });
    }
  }

  // Return with cookie deletion instruction
  return {
    status: 200,
    data: { success: true, message: 'Logged out' },
    cookies: [{
      action: 'delete' as const,
      name: 'mh_session',
      options: { path: '/' },
    }],
  };
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

  // Get user data
  const fullUser = getUser(user.userId);

  if (!fullUser) {
    return {
      status: 404,
      error: 'User not found',
    };
  }

  console.log(`[auth-handler] Syncing user data for ${fullUser.username}`);

  return successResponse({
    success: true,
    user: {
      id: fullUser.id,
      username: fullUser.username,
      role: fullUser.role,
      lastLogin: fullUser.lastLogin,
      metadata: fullUser.metadata,
    },
    syncedAt: new Date().toISOString(),
  });
}

/**
 * POST /api/auth/register - Create new user account
 *
 * IDENTICAL for web and mobile - same code path.
 * Includes rollback on failure, recovery codes, and audit logging.
 */
export async function handleRegister(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body } = req;

  const { username, password, displayName, email } = (body || {}) as {
    username?: string;
    password?: string;
    displayName?: string;
    email?: string;
  };

  if (!username || !password) {
    return {
      status: 400,
      error: 'Username and password are required',
    };
  }

  // Validate username format
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return {
      status: 400,
      error: 'Username can only contain letters, numbers, underscore, and hyphen',
    };
  }

  if (username.length < 3 || username.length > 50) {
    return {
      status: 400,
      error: 'Username must be 3-50 characters',
    };
  }

  if (password.length < 6) {
    return {
      status: 400,
      error: 'Password must be at least 6 characters',
    };
  }

  // Check if user already exists
  const existing = getUser(username);
  if (existing) {
    return {
      status: 409,
      error: 'Username already exists',
    };
  }

  // First user is owner, rest are standard
  const role = hasOwner() ? 'standard' : 'owner';

  // Create user account
  const user = createUser(username, password, role, {
    displayName: displayName || username,
    email: email || undefined,
  });

  // Initialize profile directory - rollback user if this fails
  try {
    await initializeProfile(username);
  } catch (profileError) {
    console.error('[auth-handler] Profile init failed, rolling back user:', profileError);
    try {
      deleteUser(user.id);
      audit({
        level: 'error',
        category: 'security',
        event: 'registration_rollback',
        details: {
          userId: user.id,
          username: user.username,
          reason: 'profile_initialization_failed',
          error: (profileError as Error).message,
        },
        actor: 'system',
      });
    } catch (rollbackError) {
      console.error('[auth-handler] Rollback failed:', rollbackError);
      audit({
        level: 'error',
        category: 'system',
        event: 'registration_rollback_failed',
        details: {
          userId: user.id,
          username: user.username,
          profileError: (profileError as Error).message,
          rollbackError: (rollbackError as Error).message,
        },
        actor: 'system',
      });
    }
    return {
      status: 500,
      error: `Failed to initialize profile: ${(profileError as Error).message}`,
    };
  }

  // Generate recovery codes for password reset
  const recoveryCodes = generateRecoveryCodes();
  saveRecoveryCodes(username, recoveryCodes);

  // Create session
  const session = createSession(user.id, user.role);

  console.log(`[auth-handler] User ${username} registered, session: ${session.id.slice(0, 8)}...`);

  // Audit registration
  audit({
    level: 'info',
    category: 'security',
    event: 'user_registered',
    details: {
      userId: user.id,
      username: user.username,
      role: user.role,
      sessionId: session.id,
    },
    actor: user.id,
  });

  return {
    status: 201,
    data: {
      success: true,
      sessionId: session.id,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        metadata: user.metadata,
      },
      recoveryCodes, // Include recovery codes for user to save
      message: role === 'owner'
        ? 'Account created successfully! You are now the system owner.'
        : 'Account created successfully!',
    },
    cookies: [{
      action: 'set' as const,
      name: 'mh_session',
      value: session.id,
      options: {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        maxAge: 60 * 60 * 24, // 24 hours
      },
    }],
  };
}

/**
 * POST /api/auth/sync-user - Create local user from server sync
 *
 * Creates a user account locally after syncing credentials from server.
 * IDENTICAL for web and mobile - ONE implementation used by both.
 *
 * Accepts optional profileStorage config to specify custom profile location.
 */
export async function handleCreateSyncUser(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body } = req;

  const { username, password, displayName, role: requestedRole, profileStorage } = (body || {}) as {
    username?: string;
    password?: string;
    displayName?: string;
    role?: string;
    profileStorage?: ProfileStorageConfig;
  };

  if (!username || !password) {
    return {
      status: 400,
      error: 'Username and password are required',
    };
  }

  // Check if user already exists (by username, not ID)
  let user = getUserByUsername(username);

  if (user) {
    // User exists - verify credentials
    const verified = authenticateUser(username, password);
    if (!verified) {
      return {
        status: 409,
        error: 'User exists with different credentials',
      };
    }

    // Update profileStorage if provided (allows changing profile location)
    if (profileStorage) {
      updateUserMetadata(user.id, { profileStorage });
    }
  } else {
    // Create new user
    // Security: Synced users only get 'owner' if no owner exists locally
    // This prevents a remote profile from claiming ownership of the local device
    const effectiveRole = hasOwner() ? 'standard' : ((requestedRole as any) || 'owner');

    user = createUser(username, password, effectiveRole, {
      displayName: displayName || username,
    });

    if (requestedRole === 'owner' && effectiveRole === 'standard') {
      console.log(`[auth-handler] Synced user ${username} downgraded from owner to standard (local owner exists)`);
    }

    // Set profileStorage if provided (must be done after creation)
    if (profileStorage) {
      updateUserMetadata(user.id, { profileStorage });
    }

    // Initialize profile
    try {
      await initializeProfile(username);
    } catch (e) {
      console.warn('[auth-handler] Profile init during sync failed:', e);
    }
  }

  // Create session
  const session = createSession(user.id, user.role);

  console.log(`[auth-handler] User ${username} synced, session: ${session.id.slice(0, 8)}...`);

  // Return response WITH cookie set (important for browser-based mobile apps)
  return {
    status: 200,
    data: {
      success: true,
      sessionId: session.id,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    },
    cookies: [{
      action: 'set' as const,
      name: 'mh_session',
      value: session.id,
      options: {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // 7 days
      },
    }],
  };
}

/**
 * POST /api/auth/guest - Create anonymous guest session
 *
 * Creates a temporary session for guest browsing.
 * IDENTICAL for web and mobile.
 */
export async function handleGuest(_req: UnifiedRequest): Promise<UnifiedResponse> {
  // Create anonymous session (30 min expiry via session system)
  const session = createSession('anonymous', 'anonymous');

  audit({
    level: 'info',
    category: 'security',
    event: 'guest_session_created',
    actor: 'anonymous',
    details: { sessionId: session.id },
  });

  return {
    status: 200,
    data: {
      success: true,
      session: {
        id: session.id,
        role: 'anonymous',
        expiresAt: session.expiresAt,
      },
    },
    cookies: [{
      action: 'set' as const,
      name: 'mh_session',
      value: session.id,
      options: {
        httpOnly: true,
        sameSite: 'lax' as const,
        path: '/',
        maxAge: 30 * 60, // 30 minutes
      },
    }],
  };
}

/**
 * POST /api/auth/change-password - Change user password
 *
 * Requires authentication and current password verification.
 * IDENTICAL for web and mobile.
 */
export async function handleChangePassword(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required',
    };
  }

  const { currentPassword, newPassword } = (body || {}) as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    return {
      status: 400,
      error: 'Current password and new password are required',
    };
  }

  if (newPassword.length < 6) {
    return {
      status: 400,
      error: 'New password must be at least 6 characters',
    };
  }

  // Get user details
  const fullUser = getUser(user.userId);
  if (!fullUser) {
    return {
      status: 404,
      error: 'User not found',
    };
  }

  // Verify current password
  const verified = verifyUserPassword(fullUser.username, currentPassword);
  if (!verified) {
    audit({
      level: 'warn',
      category: 'security',
      event: 'password_change_failed',
      actor: user.userId,
      details: {
        userId: user.userId,
        username: fullUser.username,
        reason: 'incorrect_current_password',
      },
    });
    return {
      status: 401,
      error: 'Current password is incorrect',
    };
  }

  // Update password
  updatePassword(user.userId, newPassword);

  audit({
    level: 'info',
    category: 'security',
    event: 'password_changed',
    actor: user.userId,
    details: {
      userId: user.userId,
      username: fullUser.username,
    },
  });

  console.log(`[auth-handler] Password changed for user ${fullUser.username}`);

  return successResponse({
    success: true,
    message: 'Password changed successfully',
  });
}

/**
 * POST /api/auth/reset-password - Reset password using recovery code
 *
 * Allows password reset without current password using a recovery code.
 * IDENTICAL for web and mobile.
 */
export async function handleResetPassword(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body } = req;

  const { username, recoveryCode, newPassword } = (body || {}) as {
    username?: string;
    recoveryCode?: string;
    newPassword?: string;
  };

  if (!username || !recoveryCode || !newPassword) {
    return {
      status: 400,
      error: 'Username, recovery code, and new password are required',
    };
  }

  if (newPassword.length < 6) {
    return {
      status: 400,
      error: 'New password must be at least 6 characters',
    };
  }

  // Get user by username
  const targetUser = getUserByUsername(username);
  if (!targetUser) {
    // Don't reveal whether username exists
    audit({
      level: 'warn',
      category: 'security',
      event: 'password_reset_failed',
      actor: 'anonymous',
      details: {
        username,
        reason: 'user_not_found',
      },
    });
    return {
      status: 400,
      error: 'Invalid username or recovery code',
    };
  }

  // Verify recovery code
  const codeValid = verifyRecoveryCode(username, recoveryCode);
  if (!codeValid) {
    audit({
      level: 'warn',
      category: 'security',
      event: 'password_reset_failed',
      actor: 'anonymous',
      details: {
        userId: targetUser.id,
        username,
        reason: 'invalid_recovery_code',
      },
    });
    return {
      status: 400,
      error: 'Invalid username or recovery code',
    };
  }

  // Update password
  updatePassword(targetUser.id, newPassword);

  // Generate new recovery codes (old ones are now invalid)
  const newRecoveryCodes = generateRecoveryCodes();
  saveRecoveryCodes(username, newRecoveryCodes);

  audit({
    level: 'info',
    category: 'security',
    event: 'password_reset',
    actor: targetUser.id,
    details: {
      userId: targetUser.id,
      username,
      method: 'recovery_code',
    },
  });

  console.log(`[auth-handler] Password reset for user ${username} via recovery code`);

  return successResponse({
    success: true,
    message: 'Password reset successfully',
    recoveryCodes: newRecoveryCodes, // New recovery codes for user to save
  });
}

/**
 * POST /api/auth/change-username - Change username
 *
 * Requires authentication and password verification.
 * IDENTICAL for web and mobile.
 */
export async function handleChangeUsername(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required',
    };
  }

  const { newUsername, password } = (body || {}) as {
    newUsername?: string;
    password?: string;
  };

  if (!newUsername || !password) {
    return {
      status: 400,
      error: 'New username and password are required',
    };
  }

  // Validate username format
  if (!/^[a-zA-Z0-9_-]+$/.test(newUsername)) {
    return {
      status: 400,
      error: 'Username can only contain letters, numbers, underscore, and hyphen',
    };
  }

  if (newUsername.length < 3 || newUsername.length > 50) {
    return {
      status: 400,
      error: 'Username must be 3-50 characters',
    };
  }

  // Get user details
  const fullUser = getUser(user.userId);
  if (!fullUser) {
    return {
      status: 404,
      error: 'User not found',
    };
  }

  // Verify password
  const verified = verifyUserPassword(fullUser.username, password);
  if (!verified) {
    audit({
      level: 'warn',
      category: 'security',
      event: 'username_change_failed',
      actor: user.userId,
      details: {
        userId: user.userId,
        oldUsername: fullUser.username,
        newUsername,
        reason: 'incorrect_password',
      },
    });
    return {
      status: 401,
      error: 'Password is incorrect',
    };
  }

  // Check if new username is taken
  const existing = getUserByUsername(newUsername);
  if (existing && existing.id !== user.userId) {
    return {
      status: 409,
      error: 'Username already exists',
    };
  }

  const oldUsername = fullUser.username;

  // Update username
  updateUsername(user.userId, newUsername);

  audit({
    level: 'info',
    category: 'security',
    event: 'username_changed',
    actor: user.userId,
    details: {
      userId: user.userId,
      oldUsername,
      newUsername,
    },
  });

  console.log(`[auth-handler] Username changed from ${oldUsername} to ${newUsername}`);

  return successResponse({
    success: true,
    message: 'Username changed successfully',
    username: newUsername,
  });
}

/**
 * PUT /api/auth/update-profile - Update user profile metadata
 *
 * Requires authentication.
 * IDENTICAL for web and mobile.
 */
export async function handleUpdateProfile(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required',
    };
  }

  const { displayName, email } = (body || {}) as {
    displayName?: string;
    email?: string;
  };

  // Get user details
  const fullUser = getUser(user.userId);
  if (!fullUser) {
    return {
      status: 404,
      error: 'User not found',
    };
  }

  // Build metadata update
  const updates: Record<string, any> = {};
  if (displayName !== undefined) {
    updates.displayName = displayName;
  }
  if (email !== undefined) {
    updates.email = email;
  }

  if (Object.keys(updates).length === 0) {
    return {
      status: 400,
      error: 'No fields to update',
    };
  }

  // Update metadata
  updateUserMetadata(user.userId, updates);

  audit({
    level: 'info',
    category: 'data_change',
    event: 'profile_updated',
    actor: user.userId,
    details: {
      userId: user.userId,
      username: fullUser.username,
      updatedFields: Object.keys(updates),
    },
  });

  console.log(`[auth-handler] Profile updated for user ${fullUser.username}`);

  // Get updated user
  const updatedUser = getUser(user.userId);

  return successResponse({
    success: true,
    message: 'Profile updated successfully',
    user: {
      id: updatedUser!.id,
      username: updatedUser!.username,
      role: updatedUser!.role,
      metadata: updatedUser!.metadata,
    },
  });
}
