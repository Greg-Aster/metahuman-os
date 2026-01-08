/**
 * Pause State API - GET/POST /api/pause-state
 *
 * Manages the Active Operator pause state from the client side:
 * - TTS speaking state (client reports when speech starts/stops)
 * - Curiosity response state (client reports when user responds/skips)
 *
 * GET: Returns current pause state for the authenticated user
 * POST: Updates pause state (action: 'setTTS' | 'clearCuriosity')
 */
import type { APIRoute } from 'astro';
import { getAuthenticatedUser, AuthRequiredError } from '@metahuman/core/auth';
import {
  getPauseState,
  updateTTSState,
  clearCuriosityAwaiting,
  type PauseCheckResult,
} from '@metahuman/core/active-operator';

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const pauseState = getPauseState(user.username);

    return new Response(JSON.stringify({
      success: true,
      username: user.username,
      state: pauseState,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (error instanceof AuthRequiredError) {
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
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const body = await request.json();

    const { action, speaking, reason } = body;

    switch (action) {
      case 'setTTS':
        // Client reports TTS speaking state change
        if (typeof speaking !== 'boolean') {
          return new Response(JSON.stringify({
            success: false,
            error: 'speaking must be a boolean',
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        updateTTSState(user.username, speaking);

        return new Response(JSON.stringify({
          success: true,
          message: `TTS state updated: speaking=${speaking}`,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      case 'clearCuriosity':
        // Client reports curiosity response (responded or skipped)
        const validReasons = ['responded', 'skipped', 'timeout'];
        if (!validReasons.includes(reason)) {
          return new Response(JSON.stringify({
            success: false,
            error: `reason must be one of: ${validReasons.join(', ')}`,
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        clearCuriosityAwaiting(user.username, reason);

        return new Response(JSON.stringify({
          success: true,
          message: `Curiosity state cleared: reason=${reason}`,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });

      default:
        return new Response(JSON.stringify({
          success: false,
          error: `Unknown action: ${action}. Valid actions: setTTS, clearCuriosity`,
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
    }
  } catch (error) {
    if (error instanceof AuthRequiredError) {
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
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
