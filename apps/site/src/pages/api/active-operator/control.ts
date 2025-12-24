/**
 * Active Operator Control API
 *
 * POST: Control the active operator (start, stop, toggle, emergency-stop)
 *
 * This endpoint controls the actual decision loop service, not just
 * the mode controller state.
 */

import type { APIRoute } from 'astro';
import {
  getModeController,
  updateActiveOperatorConfig,
  clearScratchpad,
  resetActiveOperatorMetrics,
  resetErrorCounter,
  startActiveOperatorService,
  stopActiveOperatorService,
  toggleActiveOperatorService,
} from '@metahuman/core/active-operator';
import { getAuthenticatedUser, audit } from '@metahuman/core';

type ControlAction = 'start' | 'stop' | 'toggle' | 'emergency-stop' | 'reset';

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    // Require authentication
    const user = getAuthenticatedUser(cookies);

    // Only owner can control active operator
    if (user.role !== 'owner') {
      return new Response(
        JSON.stringify({ error: 'Only owner can control active operator' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const action = body.action as ControlAction;

    if (!action || !['start', 'stop', 'toggle', 'emergency-stop', 'reset'].includes(action)) {
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use: start, stop, toggle, emergency-stop, reset' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let result: { success: boolean; mode: string; message: string };

    switch (action) {
      case 'start': {
        const startResult = await startActiveOperatorService(user.username);
        updateActiveOperatorConfig({ enabled: startResult.success });
        result = {
          success: startResult.success,
          mode: startResult.success ? 'active' : 'passive',
          message: startResult.message,
        };
        break;
      }

      case 'stop': {
        const stopResult = await stopActiveOperatorService();
        updateActiveOperatorConfig({ enabled: false });
        result = {
          success: stopResult.success,
          mode: 'passive',
          message: stopResult.message,
        };
        break;
      }

      case 'toggle': {
        const toggleResult = await toggleActiveOperatorService(user.username);
        updateActiveOperatorConfig({ enabled: toggleResult.mode === 'active' });
        result = {
          success: toggleResult.success,
          mode: toggleResult.mode,
          message: toggleResult.message,
        };
        break;
      }

      case 'emergency-stop': {
        const controller = getModeController();
        controller.emergencyStop();
        await stopActiveOperatorService();
        updateActiveOperatorConfig({ enabled: false });
        result = {
          success: true,
          mode: 'passive',
          message: 'Active Operator emergency stopped',
        };
        break;
      }

      case 'reset': {
        await stopActiveOperatorService();
        clearScratchpad();
        resetActiveOperatorMetrics();
        resetErrorCounter();
        updateActiveOperatorConfig({ enabled: false });
        result = {
          success: true,
          mode: 'passive',
          message: 'Active Operator reset to initial state',
        };
        break;
      }

      default:
        result = {
          success: false,
          mode: 'passive',
          message: 'Unknown action',
        };
    }

    audit({
      category: 'system',
      level: 'info',
      event: 'active_operator_control',
      actor: user.username,
      details: {
        action,
        result: result.mode,
        message: result.message,
      },
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[active-operator/control] POST error:', error);

    if ((error as Error).message.includes('Not authenticated')) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
