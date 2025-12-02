/**
 * Unlock Encrypted Profile API
 *
 * POST /api/encryption/unlock - Unlock an encrypted profile with password
 */

import type { APIRoute } from 'astro';
import {
  unlockProfile,
  getAuthenticatedUser,
  audit,
} from '@metahuman/core';

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    const body = await request.json();
    const { password } = body;

    if (!password) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Password required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await unlockProfile(user.id, password);

    if (result.success) {
      audit({
        level: 'info',
        category: 'security',
        event: 'profile_unlock_api',
        details: { userId: user.id, username: user.username },
        actor: user.id,
      });
    }

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 401,
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
