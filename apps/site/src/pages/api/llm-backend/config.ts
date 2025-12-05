/**
 * LLM Backend Configuration API
 *
 * GET: Get current backend configuration
 * PUT: Update backend configuration
 */

import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  loadBackendConfig,
  saveBackendConfig,
  type BackendConfig,
} from '@metahuman/core';
import { requireOwner } from '../../../middleware/cognitiveModeGuard';

export const GET: APIRoute = async () => {
  try {
    const config = loadBackendConfig();

    return new Response(JSON.stringify(config), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

const putHandler: APIRoute = async ({ cookies, request }) => {
  try {
    getAuthenticatedUser(cookies); // Verify auth
    const updates = await request.json() as Partial<BackendConfig>;

    // Validate updates
    if (updates.activeBackend && !['ollama', 'vllm'].includes(updates.activeBackend)) {
      return new Response(JSON.stringify({
        error: 'Invalid activeBackend. Must be "ollama" or "vllm"',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (updates.vllm?.gpuMemoryUtilization !== undefined) {
      const util = updates.vllm.gpuMemoryUtilization;
      if (util < 0.1 || util > 0.99) {
        return new Response(JSON.stringify({
          error: 'gpuMemoryUtilization must be between 0.1 and 0.99',
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    saveBackendConfig(updates);
    const newConfig = loadBackendConfig(true);

    return new Response(JSON.stringify({
      success: true,
      config: newConfig,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message.includes('Not authenticated') ? 401 : 500;

    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const PUT = requireOwner(putHandler);
