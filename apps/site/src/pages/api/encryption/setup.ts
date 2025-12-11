/**
 * Setup Profile Encryption API
 *
 * POST /api/encryption/setup - Enable encryption for a profile
 */

import type { APIRoute } from 'astro';
import {
  setupEncryption,
  getEncryptionCapabilities,
  getAuthenticatedUser,
  audit,
} from '@metahuman/core';
import { requireWriteMode } from '../../../middleware/cognitiveModeGuard';

const handler: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    const body = await request.json();
    const { type, password, volumePath, volumeSizeMB, useLoginPassword } = body;

    // Validate encryption type
    if (!type || !['aes256', 'luks', 'veracrypt'].includes(type)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid encryption type. Must be: aes256, luks, or veracrypt',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate password
    if (!password || password.length < 6) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Password must be at least 6 characters',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check capabilities
    const capabilities = getEncryptionCapabilities();

    if (type === 'luks' && !capabilities.luks.available) {
      return new Response(JSON.stringify({
        success: false,
        error: 'LUKS not available. Install cryptsetup: sudo apt install cryptsetup',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (type === 'veracrypt' && !capabilities.veracrypt.available) {
      return new Response(JSON.stringify({
        success: false,
        error: 'VeraCrypt not installed. Visit: https://veracrypt.fr',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Volume encryption requires additional parameters
    if ((type === 'luks' || type === 'veracrypt') && !volumePath) {
      return new Response(JSON.stringify({
        success: false,
        error: 'volumePath required for volume encryption',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Setup encryption
    const result = await setupEncryption(user.id, type, password, {
      volumePath,
      volumeSizeMB: volumeSizeMB || 2048, // Default 2GB
      useLoginPassword,
    });

    if (result.success) {
      audit({
        level: 'info',
        category: 'security',
        event: 'encryption_setup_api',
        details: {
          userId: user.id,
          username: user.username,
          type,
          volumePath: volumePath || null,
        },
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

export const POST = requireWriteMode(handler);
