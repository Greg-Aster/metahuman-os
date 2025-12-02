/**
 * Encryption Status API
 *
 * GET /api/encryption - Get encryption status and available capabilities
 */

import type { APIRoute } from 'astro';
import {
  getEncryptionCapabilities,
  getEncryptionStatus,
  getAuthenticatedUser,
  getUserOrAnonymous,
} from '@metahuman/core';

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getUserOrAnonymous(cookies);

    // Get available encryption capabilities
    const capabilities = getEncryptionCapabilities();

    // If anonymous, just return capabilities
    if (user.role === 'anonymous') {
      return new Response(JSON.stringify({
        capabilities,
        status: null,
        message: 'Login required to view encryption status',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Get current encryption status for the user
    const status = await getEncryptionStatus(user.id);

    return new Response(JSON.stringify({
      capabilities,
      status,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: (error as Error).message,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
