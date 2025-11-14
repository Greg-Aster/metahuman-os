import type { APIRoute } from 'astro';
import { createUser, hasOwner, deleteUser } from '@metahuman/core/users';
import { initializeProfile } from '@metahuman/core/profile';
import { createSession } from '@metahuman/core/sessions';
import { audit } from '@metahuman/core/audit';
import { generateRecoveryCodes, saveRecoveryCodes } from '@metahuman/core/recovery-codes';

/**
 * POST /api/auth/register
 *
 * Create new user account and initialize profile
 */
export const POST: APIRoute = async (context) => {
  try {
    // Parse request body
    const body = await context.request.json();
    const { username, password, displayName, email } = body;

    if (!username || !password) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Username and password are required',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Validate username format
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

    // Validate password strength
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

    // Determine role: first user is owner, rest are standard users
    // Note: Guests are read-only users and should only be created explicitly via admin
    const role = hasOwner() ? 'standard' : 'owner';

    // Create user account
    const user = createUser(username, password, role, {
      displayName: displayName || username,
      email: email || undefined,
    });

    // Initialize user profile directory structure
    // CRITICAL: If this fails, rollback the user account to prevent orphaned records
    try {
      await initializeProfile(username);
    } catch (profileError) {
      // Rollback: Delete the user account we just created
      console.error('[auth/register] Profile initialization failed, rolling back user:', profileError);

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
        // Log rollback failure but still throw original error
        console.error('[auth/register] Rollback failed:', rollbackError);
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

      // Re-throw the original profile error
      throw new Error(`Failed to initialize profile: ${(profileError as Error).message}`);
    }

    // Generate recovery codes for password reset
    const recoveryCodes = generateRecoveryCodes();
    saveRecoveryCodes(username, recoveryCodes);

    // Create session and log them in automatically
    const session = createSession(user.id, user.role, {
      userAgent: context.request.headers.get('user-agent') || undefined,
      ip: context.clientAddress || undefined,
    });

    // Set session cookie
    context.cookies.set('mh_session', session.id, {
      httpOnly: true,
      sameSite: 'strict',
      secure: context.url.protocol === 'https:',
      path: '/',
      maxAge: 60 * 60 * 24, // 24 hours
    });

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

    return new Response(
      JSON.stringify({
        success: true,
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
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[auth/register] Error:', error);

    const errorMessage = (error as Error).message || 'Registration failed';

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        status: errorMessage.includes('already exists') ? 409 : 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
