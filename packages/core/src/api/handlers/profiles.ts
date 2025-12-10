/**
 * Profiles API Handlers
 *
 * Unified handlers for profile management endpoints.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { getUser, updateProfileVisibility, listVisibleProfiles, listUsers } from '../../users.js';

/**
 * GET /api/profiles/visibility - Get current user's profile visibility
 */
export async function handleGetProfileVisibility(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  try {
    const fullUser = getUser(user.userId);
    const visibility = fullUser?.metadata?.profileVisibility || 'private';

    return successResponse({ success: true, visibility });
  } catch (error) {
    console.error('[profiles/visibility] GET error:', error);
    return { status: 500, error: 'Failed to get visibility' };
  }
}

/**
 * POST /api/profiles/visibility - Update current user's profile visibility
 */
export async function handleSetProfileVisibility(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  const { visibility } = (body || {}) as { visibility?: string };

  if (!visibility || !['private', 'public'].includes(visibility)) {
    return { status: 400, error: 'Invalid visibility value (private|public)' };
  }

  try {
    const updated = updateProfileVisibility(user.userId, visibility as 'private' | 'public');

    if (!updated) {
      return { status: 500, error: 'Failed to update visibility' };
    }

    return successResponse({ success: true, visibility });
  } catch (error) {
    console.error('[profiles/visibility] POST error:', error);
    return { status: 500, error: (error as Error).message || 'Failed to update visibility' };
  }
}

/**
 * GET /api/profiles/list - List visible profiles
 */
export async function handleListProfiles(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    // Determine if user can see all profiles (owner/admin only)
    const canSeeAll = user.role === 'owner';

    // Get appropriate profile list
    let users = canSeeAll ? listUsers() : listVisibleProfiles();

    // Standard users can see their own profile in the list
    if (user.isAuthenticated && user.role !== 'owner') {
      const allUsers = listUsers();
      const ownProfile = allUsers.find(u => u.username === user.username);
      if (ownProfile && !users.find(u => u.username === ownProfile.username)) {
        users = [...users, ownProfile];
      }
    }

    // Format for API response
    const profiles = users.map((u) => ({
      username: u.username,
      displayName: u.metadata?.displayName || u.username,
      visibility: u.metadata?.profileVisibility || 'private',
      role: u.role,
    }));

    // Easter egg: Add "Mutant Super Intelligence" profile if there are multiple public profiles
    const publicProfiles = profiles.filter(p => p.visibility === 'public');
    if (publicProfiles.length >= 2 && !canSeeAll) {
      profiles.unshift({
        username: 'mutant-super-intelligence',
        displayName: 'Mutant Super Intelligence',
        visibility: 'public' as const,
        role: 'guest' as const,
      });
    }

    return successResponse({ success: true, profiles });
  } catch (error) {
    console.error('[profiles/list] Error:', error);
    return { status: 500, error: (error as Error).message || 'Failed to list profiles' };
  }
}
