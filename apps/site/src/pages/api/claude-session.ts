import type { APIRoute } from 'astro';
import {
  startClaudeSession,
  stopClaudeSession,
  getSessionStatus,
  restartClaudeSession,
  isClaudeSessionReady,
} from '@metahuman/core/claude-session';
import { getAuthenticatedUser } from '@metahuman/core/auth';
import { audit } from '@metahuman/core';

/**
 * GET: Get Claude CLI session status
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const status = getSessionStatus();

    return new Response(JSON.stringify({
      success: true,
      status
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get Claude session status'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

/**
 * POST: Start/stop/restart Claude CLI session
 */
export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    // Only owners can manage Claude session
    if (user.role !== 'owner') {
      return new Response(JSON.stringify({
        success: false,
        error: 'Only owners can manage Claude CLI session'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const { action } = body; // 'start' | 'stop' | 'restart'

    audit({
      level: 'info',
      category: 'action',
      event: 'claude_session_action',
      details: { action, user: user.username },
      actor: user.username,
    });

    let success = false;
    let message = '';

    switch (action) {
      case 'start':
        if (isClaudeSessionReady()) {
          message = 'Claude session already running';
          success = true;
        } else {
          success = await startClaudeSession();
          message = success
            ? 'Claude session started successfully'
            : 'Failed to start Claude session. Ensure Claude CLI is installed.';
        }
        break;

      case 'stop':
        stopClaudeSession();
        success = true;
        message = 'Claude session stopped';
        break;

      case 'restart':
        success = await restartClaudeSession();
        message = success
          ? 'Claude session restarted successfully'
          : 'Failed to restart Claude session';
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

    const status = getSessionStatus();

    return new Response(JSON.stringify({
      success,
      message,
      status
    }), {
      status: success ? 200 : 500,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to manage Claude session'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
