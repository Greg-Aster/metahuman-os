/**
 * Lock Encrypted Profile API
 *
 * POST /api/encryption/lock - Lock an encrypted profile
 */

import type { APIRoute } from 'astro';
import {
  lockProfile,
  getAuthenticatedUser,
  audit,
} from '@metahuman/core';

export const POST: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    const result = await lockProfile(user.id);

    if (result.success) {
      audit({
        level: 'info',
        category: 'security',
        event: 'profile_lock_api',
        details: { userId: user.id, username: user.username },
        actor: user.id,
      });
    }

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 400,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if ((error as Error).message === 'Authentication required') {
      return new Response(JSON.stringify({
        success: false,
        error: 'Authentication required',
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: false,
      error: (error as Error).message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
