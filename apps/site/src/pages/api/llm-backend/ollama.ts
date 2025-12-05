/**
 * Ollama Backend Control API
 *
 * POST: Control Ollama (unload models, stop/start service)
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, ollama, stopOllamaService, startOllamaService } from '@metahuman/core';
import { requireOwner } from '../../../middleware/cognitiveModeGuard';

interface OllamaAction {
  action: 'unload' | 'stop' | 'start';
}

const handler: APIRoute = async ({ cookies, request }) => {
  try {
    getAuthenticatedUser(cookies);
    const body = await request.json() as OllamaAction;

    switch (body.action) {
      case 'unload': {
        const result = await ollama.unloadAllModels();

        return new Response(JSON.stringify({
          success: true,
          unloaded: result.unloaded,
          errors: result.errors,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      case 'stop': {
        const result = await stopOllamaService();

        return new Response(JSON.stringify({
          success: result.success,
          error: result.error,
        }), {
          status: result.success ? 200 : 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      case 'start': {
        const result = await startOllamaService();

        return new Response(JSON.stringify({
          success: result.success,
          error: result.error,
        }), {
          status: result.success ? 200 : 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({
          error: 'Invalid action. Must be "unload", "stop", or "start"',
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
    }
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
