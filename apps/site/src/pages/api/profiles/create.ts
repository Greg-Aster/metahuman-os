/**
 * POST /api/profiles/create
 *
 * Create a new user profile (owner-only operation)
 *
 * Creates:
 * 1. User record in persona/users.json with hashed password
 * 2. Complete profile directory structure (profiles/<username>/)
 * 3. Default persona and configuration files
 *
 * Security:
 * - Owner-only (role check)
 * - Username validation (3-50 chars, alphanumeric + - _)
 * - Password strength check (minimum 6 chars)
 * - Email validation (optional)
 * - Uniqueness check (username must not exist)
 *
 * Request body:
 * {
 *   "username": "john-doe",
 *   "password": "securepassword",
 *   "displayName": "John Doe",      // optional
 *   "email": "john@example.com",     // optional
 *   "role": "owner" | "standard" | "guest"  // defaults to "standard"
 * }
 */

import type { APIRoute } from 'astro';
import { validateSession } from '@metahuman/core/sessions';
import { createUser, deleteUser, getUserByUsername } from '@metahuman/core/users';
import { initializeProfile } from '@metahuman/core/profile';
import { audit } from '@metahuman/core';
import path from 'node:path';
import fs from 'fs-extra';
import { paths } from '@metahuman/core/paths';

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    // Step 1: Validate authentication
    const sessionCookie = cookies?.get('mh_session');
    if (!sessionCookie) {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const session = validateSession(sessionCookie.value);
    if (!session) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid or expired session' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Step 2: Owner-only operation
    if (session.role !== 'owner') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Owner permission required to create profiles',
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Step 3: Parse and validate request body
    const body = await request.json();
    const { username, password, displayName, email, role = 'standard' } = body;

    // Validate username
    if (!username || typeof username !== 'string') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Username is required',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (username.length < 3 || username.length > 50) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Username must be 3-50 characters',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Username can only contain letters, numbers, underscore, and hyphen',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate password
    if (!password || typeof password !== 'string') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Password is required',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Password must be at least 6 characters',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate role
    if (role !== 'owner' && role !== 'standard' && role !== 'guest') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Role must be either "owner", "standard", or "guest"',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate email (if provided)
    if (email && typeof email === 'string' && email.length > 0) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Invalid email format',
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Step 4: Check if username already exists
    const existingUser = getUserByUsername(username);
    if (existingUser) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Username '${username}' already exists`,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Step 5: Create user and profile
    const actor = `${session.userId} (owner)`;

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

      return new Response(
        JSON.stringify({
          success: true,
          message: `Profile '${username}' created successfully`,
          user: {
            id: newUser.id,
            username: newUser.username,
            role: newUser.role,
            displayName: displayName || username,
          },
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }
      );
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
          const profileRoot = path.join(paths.root, 'profiles', username);
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

      return new Response(
        JSON.stringify({
          success: false,
          error: `Failed to create profile: ${errorMessage}`,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  } catch (error) {
    console.error('[profiles/create] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: (error as Error).message || 'Failed to create profile',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
