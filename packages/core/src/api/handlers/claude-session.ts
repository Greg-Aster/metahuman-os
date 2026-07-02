import type { UnifiedHandler } from '../types.js';
import { audit } from '../../audit.js';
import {
  BACKEND_IDS,
  getActiveBackend,
} from '../../escalation-backend.js';
import {
  handleSpawnClaudeTerminal,
  handleStopClaudeTerminal,
} from './terminal.js';

export const handleGetClaudeSession: UnifiedHandler = async (req) => {
  try {
    const backend = getActiveBackend(req.user.username);

    if (!backend) {
      return {
        status: 200,
        data: {
          success: true,
          status: {
            running: false,
            ready: false,
            installed: false,
            backendId: null,
            backendName: 'None configured',
          },
        },
      };
    }

    const available = await backend.isAvailable();
    const ready = backend.isReady();

    return {
      status: 200,
      data: {
        success: true,
        status: {
          running: ready,
          ready,
          installed: available,
          backendId: backend.id,
          backendName: backend.name,
        },
      },
    };
  } catch (error) {
    return {
      status: 500,
      data: {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get backend status',
      },
    };
  }
};

export const handlePostClaudeSession: UnifiedHandler = async (req) => {
  try {
    if (req.user.role !== 'owner') {
      return {
        status: 403,
        data: {
          success: false,
          error: 'Only owners can manage escalation backends',
        },
      };
    }

    const action = req.body?.action;
    const backend = getActiveBackend(req.user.username);

    if (!backend) {
      return {
        status: 400,
        data: {
          success: false,
          error: 'No escalation backend configured. Enable one in Settings.',
        },
      };
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'escalation_backend_action',
      details: { action, backendId: backend.id, user: req.user.username },
      actor: req.user.username,
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
            if (backend.id === BACKEND_IDS.CLAUDE_CODE) {
              try {
                const spawnResponse = await handleSpawnClaudeTerminal(req);
                const spawnData = spawnResponse.data || {};
                if (spawnResponse.status >= 200 && spawnResponse.status < 300) {
                  audit({
                    level: 'info',
                    category: 'action',
                    event: 'big_brother_terminal_spawned',
                    details: {
                      port: spawnData.port,
                      alreadyRunning: spawnData.alreadyRunning,
                    },
                    actor: req.user.username,
                  });
                  message = spawnData.alreadyRunning
                    ? `${backend.name} ready (terminal already running)`
                    : `${backend.name} started with terminal`;
                } else {
                  message = `${backend.name} started (terminal spawn failed)`;
                }
              } catch {
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
        if (backend.id === BACKEND_IDS.CLAUDE_CODE) {
          try {
            await handleStopClaudeTerminal(req);
          } catch {
            // Non-critical parity with the old route.
          }
        }
        success = true;
        message = `${backend.name} stopped`;
        break;

      case 'restart':
        backend.stop();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        success = await backend.start();
        message = success
          ? `${backend.name} restarted successfully`
          : `Failed to restart ${backend.name}`;
        break;

      default:
        return {
          status: 400,
          data: {
            success: false,
            error: 'Invalid action. Use "start", "stop", or "restart"',
          },
        };
    }

    const available = await backend.isAvailable();
    const ready = backend.isReady();

    return {
      status: success ? 200 : 500,
      data: {
        success,
        message,
        status: {
          running: ready,
          ready,
          installed: available,
          backendId: backend.id,
          backendName: backend.name,
        },
      },
    };
  } catch (error) {
    return {
      status: 500,
      data: {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to manage backend',
      },
    };
  }
};
