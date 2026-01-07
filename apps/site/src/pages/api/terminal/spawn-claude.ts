import type { APIRoute } from 'astro';
import { getAuthenticatedUser } from '@metahuman/core/auth';
import { audit, bigBrotherTerminal } from '@metahuman/core';

const BIG_BROTHER_PORT = 3099;

/**
 * POST: Start the Big Brother terminal (using the singleton manager)
 *
 * This endpoint uses the bigBrotherTerminal singleton to ensure there's
 * only ONE Big Brother terminal instance. All escalations go to this terminal.
 */
export const POST: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    // Only owners can spawn Big Brother terminal
    if (user.role !== 'owner') {
      return new Response(JSON.stringify({
        error: 'Only owners can spawn Big Brother terminal'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get current state
    const currentState = bigBrotherTerminal.getState();

    // Check if already running
    if (currentState.isRunning) {
      audit({
        level: 'info',
        category: 'action',
        event: 'big_brother_terminal_already_running',
        details: { port: currentState.port, pid: currentState.pid },
        actor: user.username
      });

      return new Response(JSON.stringify({
        port: currentState.port,
        pid: currentState.pid,
        url: `http://localhost:${currentState.port}`,
        alreadyRunning: true
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_terminal_spawning',
      details: { port: BIG_BROTHER_PORT },
      actor: user.username
    });

    // Start the terminal using the singleton
    const started = await bigBrotherTerminal.start();

    if (!started) {
      throw new Error('Failed to start Big Brother terminal');
    }

    const newState = bigBrotherTerminal.getState();

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_terminal_spawned',
      details: { port: newState.port, pid: newState.pid },
      actor: user.username
    });

    return new Response(JSON.stringify({
      port: newState.port,
      pid: newState.pid,
      url: `http://localhost:${newState.port}`,
      alreadyRunning: false
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'big_brother_terminal_spawn_failed',
      details: { error: error instanceof Error ? error.message : 'Unknown error' },
      actor: 'system'
    });

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Failed to spawn Big Brother terminal'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

/**
 * DELETE: Stop the Big Brother terminal (using the singleton manager)
 */
export const DELETE: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    const currentState = bigBrotherTerminal.getState();

    if (!currentState.isRunning) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No Big Brother terminal running'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_terminal_stopping',
      details: { port: currentState.port, pid: currentState.pid },
      actor: user.username
    });

    // Stop using the singleton
    await bigBrotherTerminal.stop();

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_terminal_killed',
      details: { port: currentState.port, pid: currentState.pid },
      actor: user.username
    });

    return new Response(JSON.stringify({
      success: true,
      message: 'Big Brother terminal stopped'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'big_brother_terminal_kill_failed',
      details: { error: error instanceof Error ? error.message : 'Unknown error' },
      actor: 'system'
    });

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Failed to stop terminal'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
