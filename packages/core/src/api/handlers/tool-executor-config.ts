/**
 * Tool Executor Config API Handler
 *
 * GET /api/tool-executor-config - Get current config + installed backends
 * POST /api/tool-executor-config - Update config (owner only)
 * POST /api/tool-executor-config/switch - Switch active backend
 * POST /api/tool-executor-config/enable - Enable/disable a backend
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse } from '../types.js';
import { audit } from '../../audit.js';
import {
  loadToolExecutorConfig,
  saveToolExecutorConfig,
  validateToolExecutorConfig,
  detectInstalledBackends,
} from '../../tool-executor-config.js';
import {
  getAllBackendStatus,
  switchToolBackend,
  setBackendEnabled,
  getActiveBackend,
} from '../../tool-executor-backends.js';

/**
 * GET /api/tool-executor-config
 *
 * Returns the current tool executor configuration along with
 * installed backend detection.
 */
export async function handleGetToolExecutorConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    // Load config for this user
    const config = loadToolExecutorConfig(user.username);

    // Get backend status including installed detection
    const backendStatus = await getAllBackendStatus(user.username);

    // Validate config
    const validation = validateToolExecutorConfig(config);

    return successResponse({
      config,
      backendStatus,
      validation,
      activeBackend: config.activeBackend,
    });
  } catch (error) {
    console.error('[tool-executor-config] Get failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/tool-executor-config
 *
 * Update tool executor configuration.
 * Only owner can modify configuration.
 *
 * Request body: Partial<ToolExecutorConfig>
 */
export async function handleSetToolExecutorConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user, body } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    if (user.role !== 'owner') {
      return { status: 403, error: 'Only owner can modify tool executor configuration' };
    }

    const updates = body || {};

    // Load current config
    const config = loadToolExecutorConfig(user.username);

    // Apply updates selectively
    if (updates.activeBackend !== undefined) {
      // Validate backend exists and is enabled
      if (!config.backends[updates.activeBackend]) {
        return { status: 400, error: `Unknown backend: ${updates.activeBackend}` };
      }
      if (!config.backends[updates.activeBackend].enabled) {
        return { status: 400, error: `Backend ${updates.activeBackend} is disabled` };
      }
      config.activeBackend = updates.activeBackend;
    }

    // Update backends config
    if (updates.backends) {
      for (const [backendId, backendUpdates] of Object.entries(updates.backends)) {
        if (config.backends[backendId] && backendUpdates) {
          config.backends[backendId] = {
            ...config.backends[backendId],
            ...(backendUpdates as any),
          };
        }
      }
    }

    // Update routing
    if (updates.routing) {
      config.routing = {
        ...config.routing,
        ...updates.routing,
      };
    }

    // Update LLM proxy
    if (updates.llmProxy) {
      config.llmProxy = {
        ...config.llmProxy,
        ...updates.llmProxy,
      };
    }

    // Update terminal
    if (updates.terminal) {
      config.terminal = {
        ...config.terminal,
        ...updates.terminal,
      };
    }

    // Update audit
    if (updates.audit) {
      config.audit = {
        ...config.audit,
        ...updates.audit,
      };
    }

    // Validate the updated config
    const validation = validateToolExecutorConfig(config);
    if (!validation.valid) {
      return {
        status: 400,
        error: 'Invalid configuration',
        body: { errors: validation.errors, warnings: validation.warnings },
      };
    }

    // Save
    saveToolExecutorConfig(config, user.username);

    audit({
      level: 'info',
      category: 'system',
      event: 'tool_executor_config_updated',
      details: {
        activeBackend: config.activeBackend,
        updatedKeys: Object.keys(updates),
      },
      actor: user.username,
    });

    return successResponse({
      success: true,
      config,
      validation,
    });
  } catch (error) {
    console.error('[tool-executor-config] Set failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/tool-executor-config/switch
 *
 * Switch to a different active backend.
 *
 * Request body: { backend: string }
 */
export async function handleSwitchBackend(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user, body } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    if (user.role !== 'owner') {
      return { status: 403, error: 'Only owner can switch backends' };
    }

    const { backend } = body || {};

    if (!backend) {
      return { status: 400, error: 'backend is required' };
    }

    const result = await switchToolBackend(backend, user.username);

    if (!result.success) {
      return { status: 400, error: result.error };
    }

    return successResponse({
      success: true,
      activeBackend: backend,
    });
  } catch (error) {
    console.error('[tool-executor-config] Switch failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}

/**
 * POST /api/tool-executor-config/enable
 *
 * Enable or disable a backend.
 *
 * Request body: { backend: string, enabled: boolean }
 */
export async function handleEnableBackend(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { user, body } = req;

    if (!user.isAuthenticated) {
      return { status: 401, error: 'Authentication required' };
    }

    if (user.role !== 'owner') {
      return { status: 403, error: 'Only owner can enable/disable backends' };
    }

    const { backend, enabled } = body || {};

    if (!backend) {
      return { status: 400, error: 'backend is required' };
    }

    if (typeof enabled !== 'boolean') {
      return { status: 400, error: 'enabled must be a boolean' };
    }

    const result = setBackendEnabled(backend, enabled, user.username);

    if (!result.success) {
      return { status: 400, error: result.error };
    }

    return successResponse({
      success: true,
      backend,
      enabled,
    });
  } catch (error) {
    console.error('[tool-executor-config] Enable failed:', error);
    return { status: 500, error: (error as Error).message };
  }
}
