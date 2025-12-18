/**
 * Open Interpreter Status API Handler
 *
 * GET /api/interpreter-status - Get interpreter server status
 * POST /api/interpreter-status - Start/stop/restart/configure server
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse } from '../types.js';
import { audit } from '../../audit.js';
import {
  getInterpreterStatus,
  startInterpreterServer,
  stopInterpreterServer,
  configureInterpreter,
  resetInterpreter,
  getInterpreterConfig,
  isInterpreterAvailable,
} from '../../open-interpreter.js';
import { loadToolExecutorConfig } from '../../tool-executor-config.js';

/**
 * GET /api/interpreter-status
 *
 * Returns the status of the Open Interpreter server.
 */
export async function handleGetInterpreterStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    // Get interpreter config
    const config = getInterpreterConfig(user.username);
    const toolConfig = loadToolExecutorConfig(user.username);

    // Get server status
    const status = await getInterpreterStatus(config.endpoint);

    // Check if available (running or can be started)
    const available = await isInterpreterAvailable(user.username);

    return successResponse({
      ...status,
      available,
      enabled: toolConfig.backends['open-interpreter']?.enabled ?? false,
      config: {
        endpoint: config.endpoint,
        safeMode: config.safeMode,
        autoRun: config.autoRun,
        maxIterations: config.maxIterations,
        timeout: config.timeout,
        allowedLanguages: config.allowedLanguages,
        sandboxMode: config.sandboxMode,
      },
    });
  } catch (error) {
    console.error('[interpreter-status] Get failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/interpreter-status
 *
 * Control the Open Interpreter server.
 *
 * Request body:
 * {
 *   action: 'start' | 'stop' | 'restart' | 'configure' | 'reset',
 *   config?: {...}  // For configure action
 * }
 */
export async function handleInterpreterControl(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user, body } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    if (user.role !== 'owner') {
      return { status: 403, error: 'Only owner can control interpreter server' };
    }

    const { action, config: newConfig } = body || {};

    if (!action) {
      return { status: 400, error: 'action is required' };
    }

    const validActions = ['start', 'stop', 'restart', 'configure', 'reset'];
    if (!validActions.includes(action)) {
      return { status: 400, error: `Invalid action. Must be one of: ${validActions.join(', ')}` };
    }

    const interpreterConfig = getInterpreterConfig(user.username);

    audit({
      level: 'info',
      category: 'action',
      event: `interpreter_${action}_requested`,
      details: {
        action,
        endpoint: interpreterConfig.endpoint,
        hasConfig: !!newConfig,
      },
      actor: user.username,
    });

    switch (action) {
      case 'start': {
        const result = await startInterpreterServer(interpreterConfig, user.username);
        if (!result.success) {
          return { status: 500, error: result.error };
        }

        // Get updated status
        const status = await getInterpreterStatus(interpreterConfig.endpoint);
        return successResponse({
          success: true,
          action: 'start',
          ...status,
        });
      }

      case 'stop': {
        const result = await stopInterpreterServer(interpreterConfig.endpoint, user.username);
        if (!result.success) {
          return { status: 500, error: result.error };
        }

        return successResponse({
          success: true,
          action: 'stop',
          running: false,
        });
      }

      case 'restart': {
        // Stop first
        await stopInterpreterServer(interpreterConfig.endpoint, user.username);

        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Start
        const result = await startInterpreterServer(interpreterConfig, user.username);
        if (!result.success) {
          return { status: 500, error: result.error };
        }

        const status = await getInterpreterStatus(interpreterConfig.endpoint);
        return successResponse({
          success: true,
          action: 'restart',
          ...status,
        });
      }

      case 'configure': {
        if (!newConfig) {
          return { status: 400, error: 'config is required for configure action' };
        }

        // Get LLM proxy config for API base
        const toolConfig = loadToolExecutorConfig(user.username);
        const llmApiBase = `http://localhost:4321${toolConfig.llmProxy.endpoint}`;

        const result = await configureInterpreter(
          {
            llmApiBase,
            llmModel: 'metahuman-proxy',
            safeMode: newConfig.safeMode,
            autoRun: newConfig.autoRun,
            maxIterations: newConfig.maxIterations,
            timeout: newConfig.timeout,
            allowedLanguages: newConfig.allowedLanguages,
            blockedCommands: newConfig.blockedCommands,
            sandboxMode: newConfig.sandboxMode,
          },
          interpreterConfig.endpoint
        );

        if (!result.success) {
          return { status: 500, error: result.error };
        }

        return successResponse({
          success: true,
          action: 'configure',
        });
      }

      case 'reset': {
        const result = await resetInterpreter(interpreterConfig.endpoint);
        if (!result.success) {
          return { status: 500, error: result.error };
        }

        return successResponse({
          success: true,
          action: 'reset',
        });
      }

      default:
        return { status: 400, error: `Unknown action: ${action}` };
    }
  } catch (error) {
    console.error('[interpreter-status] Control failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
