/**
 * Profiles Management API Handlers
 *
 * Unified handlers for profile management operations.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { getUserByUsername, createUser, deleteUser, listVisibleProfiles } from '../../users.js';
import { profileExists, copyPersonaToGuest, deleteProfileComplete, initializeProfile, createMutantSuperIntelligence } from '../../profile.js';
import { audit } from '../../audit.js';
import { getSession, updateSession } from '../../sessions.js';
import { ROOT } from '../../paths.js';
import path from 'node:path';
import fs from 'fs-extra';

/**
 * POST /api/profiles/select - Set active profile for guest session
 * Body: { username: string }
 */
export async function handleSelectProfile(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body, sessionId } = req;

  try {
    // Only guests/anonymous can select profiles
    if (user.role === 'owner') {
      return { status: 403, error: 'Owners cannot select guest profiles' };
    }

    const { username } = body || {};

    if (!username) {
      return { status: 400, error: 'Username required' };
    }

    // Easter egg: Handle "mutant-super-intelligence" profile
    if (username === 'mutant-super-intelligence') {
      const publicProfiles = listVisibleProfiles();

      if (publicProfiles.length < 2) {
        return { status: 400, error: 'Insufficient public profiles for merger' };
      }

      // Create a special merged persona for mutant-super-intelligence
      await createMutantSuperIntelligence(publicProfiles.map(p => p.username));

      // Store all public profile usernames in session for memory merging
      if (sessionId) {
        const session = getSession(sessionId);
        if (session) {
          session.metadata = session.metadata || {};
          session.metadata.activeProfile = 'guest';
          session.metadata.sourceProfile = 'mutant-super-intelligence';
          session.metadata.mergedProfiles = publicProfiles.map(p => p.username);
          updateSession(session);
        }
      }

      audit({
        level: 'info',
        category: 'security',
        event: 'mutant_super_intelligence_activated',
        actor: user.username || 'anonymous',
        details: { mergedProfiles: publicProfiles.map(p => p.username) },
      });

      return successResponse({
        success: true,
        profile: 'guest',
        sourceProfile: 'mutant-super-intelligence',
        merged: true,
        profiles: publicProfiles.map(p => p.username),
      });
    }

    // Verify profile exists
    if (!profileExists(username)) {
      return { status: 404, error: 'Profile not found' };
    }

    // Verify profile is public
    const targetUser = getUserByUsername(username);
    const visibility = targetUser?.metadata?.profileVisibility || 'private';

    if (visibility !== 'public') {
      return { status: 403, error: 'Profile is not public' };
    }

    // Copy persona data from selected profile to guest profile
    await copyPersonaToGuest(username);

    // Update session with guest profile
    if (sessionId) {
      const session = getSession(sessionId);
      if (session) {
        session.metadata = session.metadata || {};
        session.metadata.activeProfile = 'guest';
        session.metadata.sourceProfile = username;
        updateSession(session);
      }
    }

    audit({
      level: 'info',
      category: 'security',
      event: 'guest_profile_selected',
      actor: user.username || 'anonymous',
      details: {
        selectedProfile: username,
        activeProfile: 'guest',
        personaCopied: true,
      },
    });

    return successResponse({
      success: true,
      profile: 'guest',
      sourceProfile: username,
    });
  } catch (error) {
    console.error('[profiles/select] Error:', error);
    return { status: 500, error: (error as Error).message || 'Failed to select profile' };
  }
}

/**
 * POST /api/profiles/delete - Delete a user profile
 * Body: { username: string, confirmUsername: string }
 */
export async function handleDeleteProfile(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  try {
    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    const { username, confirmUsername } = body || {};

    const isSelfDelete = user.role === 'standard' && user.username === username;

    if (user.role !== 'owner' && !isSelfDelete) {
      return { status: 403, error: 'Owner permission required to delete other profiles' };
    }

    // Validate request parameters
    if (!username || typeof username !== 'string') {
      return { status: 400, error: 'Invalid request: username is required' };
    }

    if (confirmUsername !== username) {
      return { status: 400, error: 'Confirmation username does not match' };
    }

    // Perform deletion with full cascading cleanup
    const actor = user.role === 'owner'
      ? `${user.id || user.username} (owner)`
      : `${user.id || user.username} (self-delete)`;
    const result = await deleteProfileComplete(username, user.id || user.username, actor);

    if (result.success) {
      return successResponse({
        success: true,
        message: `Profile '${username}' deleted successfully`,
        details: {
          username: result.username,
          sessionsDeleted: result.sessionsDeleted,
          userDeleted: result.userDeleted,
          profileDeleted: result.profileDeleted,
        },
      });
    } else {
      return {
        status: 400,
        error: result.error || 'Profile deletion failed',
      };
    }
  } catch (error) {
    console.error('[profiles/delete] Error:', error);
    return { status: 500, error: (error as Error).message || 'Failed to delete profile' };
  }
}

/**
 * POST /api/profiles/create - Create a new user profile (owner-only)
 * Body: { username, password, displayName?, email?, role? }
 */
export async function handleCreateProfile(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  try {
    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    if (user.role !== 'owner') {
      return { status: 403, error: 'Owner permission required to create profiles' };
    }

    const { username, password, displayName, email, role = 'standard' } = body || {};

    // Validate username
    if (!username || typeof username !== 'string') {
      return { status: 400, error: 'Username is required' };
    }

    if (username.length < 3 || username.length > 50) {
      return { status: 400, error: 'Username must be 3-50 characters' };
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return { status: 400, error: 'Username can only contain letters, numbers, underscore, and hyphen' };
    }

    // Validate password
    if (!password || typeof password !== 'string') {
      return { status: 400, error: 'Password is required' };
    }

    if (password.length < 6) {
      return { status: 400, error: 'Password must be at least 6 characters' };
    }

    // Validate role
    if (role !== 'owner' && role !== 'standard' && role !== 'guest') {
      return { status: 400, error: 'Role must be either "owner", "standard", or "guest"' };
    }

    // Validate email (if provided)
    if (email && typeof email === 'string' && email.length > 0) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return { status: 400, error: 'Invalid email format' };
      }
    }

    // Check if username already exists
    const existingUser = getUserByUsername(username);
    if (existingUser) {
      return { status: 400, error: `Username '${username}' already exists` };
    }

    const actor = `${user.id || user.username} (owner)`;

    let newUserId: string | null = null;
    try {
      // Create user record with hashed password
      const metadata: { displayName?: string; email?: string } = {};
      if (displayName) metadata.displayName = displayName;
      if (email) metadata.email = email;

      const newUser = createUser(username, password, role, metadata);
      newUserId = newUser.id;

      // Initialize profile directory structure
      await initializeProfile(username);

      // Audit successful creation
      audit({
        level: 'info',
        category: 'security',
        event: 'profile_created_via_ui',
        details: {
          username,
          userId: newUser.id,
          role,
          hasDisplayName: !!displayName,
          hasEmail: !!email,
        },
        actor,
      });

      return {
        status: 201,
        data: {
          success: true,
          message: `Profile '${username}' created successfully`,
          user: {
            id: newUser.id,
            username: newUser.username,
            role: newUser.role,
            displayName: displayName || username,
          },
        },
      };
    } catch (createError) {
      const errorMessage = (createError as Error).message;

      // Attempt rollback if user was created
      if (newUserId) {
        try {
          deleteUser(newUserId);
        } catch (rollbackError) {
          console.error('[profiles/create] Failed to rollback user:', rollbackError);
        }

        // Remove any partially initialized profile directory
        try {
          const profileRoot = path.join(ROOT, 'profiles', username);
          await fs.remove(profileRoot);
        } catch (cleanupError) {
          console.error('[profiles/create] Failed to clean profile directory:', cleanupError);
        }
      }

      audit({
        level: 'error',
        category: 'security',
        event: 'profile_creation_failed',
        details: {
          username,
          role,
          error: errorMessage,
        },
        actor,
      });

      return { status: 500, error: `Failed to create profile: ${errorMessage}` };
    }
  } catch (error) {
    console.error('[profiles/create] Error:', error);
    return { status: 500, error: (error as Error).message || 'Failed to create profile' };
  }
}
