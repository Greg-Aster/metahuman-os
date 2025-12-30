import type { APIRoute } from 'astro';
import {
  getActiveBackend,
  getBackendStatuses,
  BACKEND_IDS,
} from '@metahuman/core/escalation-backend';
import { getAuthenticatedUser } from '@metahuman/core/auth';
import { audit } from '@metahuman/core';

/**
 * GET: Get escalation backend status
 * Backward compatible - returns status in same format as old claude-session endpoint
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const backend = getActiveBackend(user.username);

    if (!backend) {
      return new Response(JSON.stringify({
        success: true,
        status: {
          running: false,
          ready: false,
          installed: false,
          backendId: null,
          backendName: 'None configured',
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const available = await backend.isAvailable();
    const ready = backend.isReady();

    return new Response(JSON.stringify({
      success: true,
      status: {
        running: ready,
        ready: ready,
        installed: available,
        backendId: backend.id,
        backendName: backend.name,
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get backend status'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

/**
 * POST: Start/stop/restart escalation backend
 * Backward compatible - accepts same actions as old claude-session endpoint
 */
export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    // Only owners can manage backend sessions
    if (user.role !== 'owner') {
      return new Response(JSON.stringify({
        success: false,
        error: 'Only owners can manage escalation backends'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const { action } = body; // 'start' | 'stop' | 'restart'

    const backend = getActiveBackend(user.username);

    if (!backend) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No escalation backend configured. Enable one in Settings.'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'escalation_backend_action',
      details: { action, backendId: backend.id, user: user.username },
      actor: user.username,
    });

    let success = false;
    let message = '';

    switch (action) {
      case 'start':
        if (backend.isReady()) {
          message = `${backend.name} already running`;
          success = true;
        } else {
          success = await backend.start();

          if (success) {
            // For Claude Code backend, also spawn the terminal
            if (backend.id === BACKEND_IDS.CLAUDE_CODE) {
              try {
                const spawnResponse = await fetch('http://localhost:4321/api/terminal/spawn-claude', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Cookie': request.headers.get('cookie') || ''
                  }
                });

                if (spawnResponse.ok) {
                  const spawnData = await spawnResponse.json();
                  audit({
                    level: 'info',
                    category: 'action',
                    event: 'big_brother_terminal_spawned',
                    details: {
                      port: spawnData.port,
                      alreadyRunning: spawnData.alreadyRunning
                    },
                    actor: user.username,
                  });
                  message = spawnData.alreadyRunning
                    ? `${backend.name} ready (terminal already running)`
                    : `${backend.name} started with terminal`;
                } else {
                  message = `${backend.name} started (terminal spawn failed)`;
                }
              } catch (error) {
                message = `${backend.name} started (terminal spawn error)`;
              }
            } else {
              message = `${backend.name} started successfully`;
            }
          } else {
            message = `Failed to start ${backend.name}. Check installation.`;
          }
        }
        break;

      case 'stop':
        backend.stop();

        // For Claude Code backend, also kill the terminal
        if (backend.id === BACKEND_IDS.CLAUDE_CODE) {
          try {
            await fetch('http://localhost:4321/api/terminal/spawn-claude', {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json',
                'Cookie': request.headers.get('cookie') || ''
              }
            });
          } catch (error) {
            // Non-critical
          }
        }

        success = true;
        message = `${backend.name} stopped`;
        break;

      case 'restart':
        backend.stop();
        await new Promise(resolve => setTimeout(resolve, 1000));
        success = await backend.start();
        message = success
          ? `${backend.name} restarted successfully`
          : `Failed to restart ${backend.name}`;
        break;

      default:
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid action. Use "start", "stop", or "restart"'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
    }

    const available = await backend.isAvailable();
    const ready = backend.isReady();

    return new Response(JSON.stringify({
      success,
      message,
      status: {
        running: ready,
        ready: ready,
        installed: available,
        backendId: backend.id,
        backendName: backend.name,
      }
    }), {
      status: success ? 200 : 500,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to manage backend'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
