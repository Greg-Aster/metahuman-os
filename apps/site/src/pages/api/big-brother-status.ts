import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import {
  getBigBrotherState,
  ensureBigBrotherTerminal,
  stopBigBrother,
  isBigBrotherReady,
} from '@metahuman/core';

const LOG_PREFIX = '[API:big-brother-status]';

/**
 * GET /api/big-brother-status
 * Get the current status of the Big Brother terminal
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    const state = getBigBrotherState();

    return new Response(JSON.stringify({
      running: state.isRunning,
      healthy: isBigBrotherReady(),
      port: state.port,
      pid: state.pid,
      claudeReady: state.claudeReady,
      endpoint: `http://localhost:${state.port}`,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(`${LOG_PREFIX} Error getting status:`, error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * POST /api/big-brother-status
 * Control the Big Brother terminal (start/stop/restart)
 *
 * Body: { action: 'start' | 'stop' | 'restart' }
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Require owner role for control actions
    const policy = getSecurityPolicy({ cookies });
    try {
      policy.requireOwner();
    } catch (error) {
      return new Response(
        JSON.stringify({ error: 'Owner role required to control Big Brother' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { action } = body;

    if (!['start', 'stop', 'restart'].includes(action)) {
      return new Response(
        JSON.stringify({ error: 'Invalid action. Use: start, stop, or restart' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} ${action} requested by ${user.username}`);

    let success = false;
    let message = '';

    const beforeState = getBigBrotherState();

    switch (action) {
      case 'start':
        if (beforeState.isRunning) {
          message = 'Big Brother is already running';
          success = true;
        } else {
          success = await ensureBigBrotherTerminal();
          message = success ? 'Big Brother started' : 'Failed to start Big Brother';
        }
        break;

      case 'stop':
        if (!beforeState.isRunning) {
          message = 'Big Brother is not running';
          success = true;
        } else {
          await stopBigBrother();
          success = true;
          message = 'Big Brother stopped';
        }
        break;

      case 'restart':
        console.log(`${LOG_PREFIX} Stopping for restart...`);
        await stopBigBrother();
        // Wait for cleanup
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log(`${LOG_PREFIX} Starting after restart...`);
        success = await ensureBigBrotherTerminal();
        message = success ? 'Big Brother restarted' : 'Failed to restart Big Brother';
        break;
    }

    const afterState = getBigBrotherState();

    audit({
      level: 'info',
      category: 'action',
      event: `big_brother_${action}`,
      actor: user.username,
      details: {
        action,
        success,
        beforePid: beforeState.pid,
        afterPid: afterState.pid,
        beforeRunning: beforeState.isRunning,
        afterRunning: afterState.isRunning,
      },
    });

    return new Response(JSON.stringify({
      success,
      message,
      state: {
        running: afterState.isRunning,
        healthy: isBigBrotherReady(),
        port: afterState.port,
        pid: afterState.pid,
      },
    }), {
      status: success ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`${LOG_PREFIX} Error:`, error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
