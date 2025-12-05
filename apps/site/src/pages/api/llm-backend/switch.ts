/**
 * LLM Backend Switch API
 *
 * POST: Switch between ollama and vllm backends
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, switchBackend, type BackendType } from '@metahuman/core';
import { requireOwner } from '../../../middleware/cognitiveModeGuard';

const handler: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const body = await request.json() as { backend: BackendType };

    if (!body.backend || !['ollama', 'vllm'].includes(body.backend)) {
      return new Response(JSON.stringify({
        error: 'Invalid backend. Must be "ollama" or "vllm"',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await switchBackend(body.backend, {
      actor: user.username,
    });

    if (!result.success) {
      return new Response(JSON.stringify({
        success: false,
        error: result.error,
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      backend: body.backend,
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

export const POST = requireOwner(handler);
