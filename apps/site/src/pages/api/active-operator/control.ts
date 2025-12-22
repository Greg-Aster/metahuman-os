/**
 * Active Operator Control API
 *
 * POST: Control the active operator (start, stop, toggle, emergency-stop)
 */

import type { APIRoute } from 'astro';
import {
  getModeController,
  updateActiveOperatorConfig,
  clearScratchpad,
  resetActiveOperatorMetrics,
  resetErrorCounter,
  getAuthenticatedUser,
  audit,
} from '@metahuman/core';

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

    const controller = getModeController();
    let result: { success: boolean; mode: string; message: string };

    switch (action) {
      case 'start':
        await controller.activateActiveMode();
        controller.start();
        updateActiveOperatorConfig({ enabled: true });
        result = {
          success: true,
          mode: 'active',
          message: 'Active Operator started',
        };
        break;

      case 'stop':
        controller.stop();
        await controller.activatePassiveMode();
        updateActiveOperatorConfig({ enabled: false });
        result = {
          success: true,
          mode: 'passive',
          message: 'Active Operator stopped',
        };
        break;

      case 'toggle':
        const newMode = await controller.toggleMode();
        updateActiveOperatorConfig({ enabled: newMode === 'active' });
        if (newMode === 'active') {
          controller.start();
        }
        result = {
          success: true,
          mode: newMode,
          message: `Active Operator switched to ${newMode} mode`,
        };
        break;

      case 'emergency-stop':
        controller.emergencyStop();
        updateActiveOperatorConfig({ enabled: false });
        result = {
          success: true,
          mode: 'passive',
          message: 'Active Operator emergency stopped',
        };
        break;

      case 'reset':
        controller.stop();
        await controller.activatePassiveMode();
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

      default:
        result = {
          success: false,
          mode: controller.mode,
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
