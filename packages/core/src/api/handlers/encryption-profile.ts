/**
 * Encryption Profile Handler
 *
 * Handles encrypted profile locking/unlocking
 * NOTE: Full encryption features are desktop-only
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { audit } from '../../audit.js';

// Stub functions for mobile compatibility
async function lockProfile(userId: string): Promise<{ success: boolean; error?: string }> {
  // On mobile, encryption is not supported
  if (process.env.METAHUMAN_MOBILE) {
    return { success: false, error: 'Encryption not supported on mobile' };
  }
  // Try to load real implementation
  try {
    const enc = await import('../../encryption.js');
    return enc.lockProfile?.(userId) || { success: false, error: 'Lock function not available' };
  } catch {
    return { success: false, error: 'Encryption module not available' };
  }
}

async function unlockProfile(userId: string, password: string): Promise<{ success: boolean; error?: string }> {
  // On mobile, encryption is not supported
  if (process.env.METAHUMAN_MOBILE) {
    return { success: false, error: 'Encryption not supported on mobile' };
  }
  // Try to load real implementation
  try {
    const enc = await import('../../encryption.js');
    return enc.unlockProfile?.(userId, password) || { success: false, error: 'Unlock function not available' };
  } catch {
    return { success: false, error: 'Encryption module not available' };
  }
}

/**
 * POST /api/encryption/lock
 *
 * Lock an encrypted profile
 * Requires authentication
 */
export async function handleLockProfile(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required',
    };
  }

  try {
    const result = await lockProfile(req.user.userId);

    if (result.success) {
      audit({
        level: 'info',
        category: 'security',
        event: 'profile_lock_api',
        details: { userId: req.user.userId, username: req.user.username },
        actor: req.user.userId,
      });
    }

    return {
      status: result.success ? 200 : 400,
      data: result,
    };
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}

/**
 * POST /api/encryption/unlock
 *
 * Unlock an encrypted profile with password
 * Requires authentication
 */
export async function handleUnlockProfile(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required',
    };
  }

  const { password } = req.body as { password?: string };

  if (!password) {
    return {
      status: 400,
      data: {
        success: false,
        error: 'Password required',
      },
    };
  }

  try {
    const result = await unlockProfile(req.user.userId, password);

    if (result.success) {
      audit({
        level: 'info',
        category: 'security',
        event: 'profile_unlock_api',
        details: { userId: req.user.userId, username: req.user.username },
        actor: req.user.userId,
      });
    }

    return {
      status: result.success ? 200 : 401,
      data: result,
    };
  } catch (error) {
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}