import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import {
  clearCuriosityAwaiting,
  getPauseState,
  updateTTSState,
} from '../../active-operator/index.js';

function authRequired(): UnifiedResponse {
  return {
    status: 401,
    data: {
      success: false,
      error: 'Authentication required',
    },
  };
}

export async function handleGetPauseState(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    if (!req.user.isAuthenticated) {
      return authRequired();
    }

    return {
      status: 200,
      data: {
        success: true,
        username: req.user.username,
        state: getPauseState(req.user.username),
      },
    };
  } catch (error) {
    return {
      status: 500,
      data: {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

export async function handleUpdatePauseState(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    if (!req.user.isAuthenticated) {
      return authRequired();
    }

    const body = req.body || {};
    const { action, speaking, reason } = body;

    switch (action) {
      case 'setTTS':
        if (typeof speaking !== 'boolean') {
          return {
            status: 400,
            data: {
              success: false,
              error: 'speaking must be a boolean',
            },
          };
        }

        updateTTSState(req.user.username, speaking);
        return {
          status: 200,
          data: {
            success: true,
            message: `TTS state updated: speaking=${speaking}`,
          },
        };

      case 'clearCuriosity': {
        const validReasons = ['responded', 'skipped', 'timeout'];
        if (!validReasons.includes(reason)) {
          return {
            status: 400,
            data: {
              success: false,
              error: `reason must be one of: ${validReasons.join(', ')}`,
            },
          };
        }

        clearCuriosityAwaiting(req.user.username, reason);
        return {
          status: 200,
          data: {
            success: true,
            message: `Curiosity state cleared: reason=${reason}`,
          },
        };
      }

      default:
        return {
          status: 400,
          data: {
            success: false,
            error: `Unknown action: ${action}. Valid actions: setTTS, clearCuriosity`,
          },
        };
    }
  } catch (error) {
    return {
      status: 500,
      data: {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}
