/**
 * Active Operator API Handlers
 *
 * Unified handlers for the active operator status, configuration, control,
 * proposal, and critic approval endpoints.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { audit } from '../../audit.js';
import {
  getModeController,
  loadActiveOperatorConfig,
  loadActiveOperatorMetrics,
  loadScratchpad,
  loadQueueState,
  getCostSummary,
  getErrorStatus,
  getActiveOperatorServiceStatus,
  saveActiveOperatorConfig,
  updateActiveOperatorConfig,
  clearScratchpad,
  resetActiveOperatorMetrics,
  resetErrorCounter,
  startActiveOperatorService,
  stopActiveOperatorService,
  toggleActiveOperatorService,
  loadPendingProposals,
  updateProposalStatus,
  runSelfHealing,
  getPendingApprovals,
  resolveApproval,
} from '../../active-operator/index.js';

type ControlAction = 'start' | 'stop' | 'toggle' | 'emergency-stop' | 'reset';

function jsonError(error: unknown): UnifiedResponse {
  return {
    status: 500,
    error: (error as Error).message,
  };
}

function authRequired(): UnifiedResponse {
  return {
    status: 401,
    error: 'Authentication required',
  };
}

/**
 * GET /api/active-operator/status
 */
export async function handleGetActiveOperatorStatus(): Promise<UnifiedResponse> {
  try {
    const config = loadActiveOperatorConfig();
    const metrics = loadActiveOperatorMetrics();
    const scratchpad = loadScratchpad();
    const queueState = loadQueueState() || [];
    const costSummary = getCostSummary();
    const errorStatus = getErrorStatus();

    let modeStatus;
    try {
      const controller = getModeController();
      modeStatus = controller.getStatus();
    } catch {
      modeStatus = {
        mode: config.enabled ? 'active' : 'passive',
        isExecuting: false,
        queueLength: queueState.length,
        lastActivityAt: new Date().toISOString(),
        health: 'healthy',
      };
    }

    const serviceStatus = getActiveOperatorServiceStatus();

    return {
      status: 200,
      data: {
        enabled: config.enabled,
        isRunning: serviceStatus.isRunning,
        mode: modeStatus.mode,
        isExecuting: modeStatus.isExecuting,
        currentTask: serviceStatus.currentTask || modeStatus.currentTask || null,
        consecutiveTasks: serviceStatus.consecutiveTasks,
        username: serviceStatus.username,
        health: modeStatus.health,
        healthMessage: modeStatus.healthMessage,

        queue: {
          length: queueState.length,
          tasks: queueState.slice(0, 10),
          hasUserMessages: queueState.some((task) => task.type === 'user_message'),
        },

        metrics: {
          totalTasksExecuted: metrics.totalTasksExecuted,
          tasksByType: metrics.tasksByType,
          successRate: metrics.totalTasksExecuted > 0
            ? `${((metrics.successCount / metrics.totalTasksExecuted) * 100).toFixed(1)}%`
            : 'N/A',
          averageDurationMs: Math.round(metrics.averageDurationMs),
          startedAt: metrics.startedAt,
        },

        cost: costSummary,

        errors: errorStatus,

        scratchpad: {
          cycleNumber: scratchpad.cycleNumber,
          entriesCount: scratchpad.entries.length,
          recentEntries: scratchpad.entries.slice(-5),
          lastDecision: scratchpad.lastDecision,
          activitySummary: scratchpad.activitySummary,
        },

        config: {
          decisionModel: config.decisionModel,
          cooldownMs: config.cooldownMs,
          maxConsecutiveTasks: config.maxConsecutiveTasks,
          enabledTaskTypes: config.enabledTaskTypes,
          enableSelfHealing: config.enableSelfHealing,
          energyBudget: config.energyBudget,
        },
      },
    };
  } catch (error) {
    console.error('[active-operator/status] GET error:', error);
    return jsonError(error);
  }
}

/**
 * GET /api/active-operator/config
 */
export async function handleGetActiveOperatorConfig(): Promise<UnifiedResponse> {
  try {
    return {
      status: 200,
      data: loadActiveOperatorConfig(),
    };
  } catch (error) {
    console.error('[active-operator/config] GET error:', error);
    return jsonError(error);
  }
}

/**
 * POST /api/active-operator/config
 */
export async function handleUpdateActiveOperatorConfig(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    if (!req.user.isAuthenticated) {
      return authRequired();
    }

    if (req.user.role !== 'owner') {
      return {
        status: 403,
        error: 'Only owner can modify active operator config',
      };
    }

    const body = req.body || {};

    if (body.enabled !== undefined && body.enabledTaskTypes !== undefined) {
      saveActiveOperatorConfig(body);
    } else {
      updateActiveOperatorConfig(body);
    }

    return {
      status: 200,
      data: loadActiveOperatorConfig(),
    };
  } catch (error) {
    console.error('[active-operator/config] POST error:', error);
    return jsonError(error);
  }
}

/**
 * POST /api/active-operator/control
 */
export async function handleActiveOperatorControl(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    if (!req.user.isAuthenticated) {
      return authRequired();
    }

    if (req.user.role !== 'owner') {
      return {
        status: 403,
        error: 'Only owner can control active operator',
      };
    }

    const body = req.body || {};
    const action = body.action as ControlAction;

    if (!action || !['start', 'stop', 'toggle', 'emergency-stop', 'reset'].includes(action)) {
      return {
        status: 400,
        error: 'Invalid action. Use: start, stop, toggle, emergency-stop, reset',
      };
    }

    let result: { success: boolean; mode: string; message: string };

    switch (action) {
      case 'start': {
        const startResult = await startActiveOperatorService(req.user.username);
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
        const toggleResult = await toggleActiveOperatorService(req.user.username);
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
      actor: req.user.username,
      details: {
        action,
        result: result.mode,
        message: result.message,
      },
    });

    return {
      status: 200,
      data: result,
    };
  } catch (error) {
    console.error('[active-operator/control] POST error:', error);
    return jsonError(error);
  }
}

/**
 * GET /api/active-operator/proposals
 */
export async function handleGetActiveOperatorProposals(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    if (!req.user.isAuthenticated) {
      return {
        status: 200,
        data: {
          proposals: [],
          message: 'Login required to view proposals',
        },
      };
    }

    return {
      status: 200,
      data: {
        proposals: loadPendingProposals(req.user.username),
      },
    };
  } catch (error) {
    console.error('[active-operator/proposals] GET error:', error);
    return jsonError(error);
  }
}

/**
 * POST /api/active-operator/proposals
 */
export async function handleUpdateActiveOperatorProposal(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    if (!req.user.isAuthenticated) {
      return authRequired();
    }

    if (req.user.role !== 'owner') {
      return {
        status: 403,
        error: 'Only owner can manage code proposals',
      };
    }

    const body = req.body || {};
    const { action, proposalId } = body;

    if (!action || !['approve', 'reject', 'scan'].includes(action)) {
      return {
        status: 400,
        error: 'Invalid action. Use: approve, reject, scan',
      };
    }

    let result: { success: boolean; message: string; data?: unknown };

    switch (action) {
      case 'approve': {
        if (!proposalId) {
          return {
            status: 400,
            error: 'proposalId required for approve action',
          };
        }
        const approved = updateProposalStatus(proposalId, 'approved', req.user.username);
        result = {
          success: approved,
          message: approved ? `Proposal ${proposalId} approved` : 'Proposal not found',
        };
        break;
      }

      case 'reject': {
        if (!proposalId) {
          return {
            status: 400,
            error: 'proposalId required for reject action',
          };
        }
        const rejected = updateProposalStatus(proposalId, 'rejected', req.user.username);
        result = {
          success: rejected,
          message: rejected ? `Proposal ${proposalId} rejected` : 'Proposal not found',
        };
        break;
      }

      case 'scan': {
        const scanResult = await runSelfHealing(req.user.username, body.maxErrors || 5);
        result = {
          success: true,
          message: `Found ${scanResult.errorsFound} errors, created ${scanResult.proposalsCreated} proposals`,
          data: {
            errorsFound: scanResult.errorsFound,
            proposalsCreated: scanResult.proposalsCreated,
          },
        };
        break;
      }

      default:
        result = { success: false, message: 'Unknown action' };
    }

    audit({
      category: 'system',
      level: 'info',
      event: 'code_proposal_action',
      actor: req.user.username,
      details: {
        action,
        proposalId,
        result: result.success,
      },
    });

    return {
      status: 200,
      data: result,
    };
  } catch (error) {
    console.error('[active-operator/proposals] POST error:', error);
    return jsonError(error);
  }
}

/**
 * GET /api/active-operator/approvals
 */
export async function handleGetActiveOperatorApprovals(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    if (!req.user.isAuthenticated) {
      return {
        status: 200,
        data: {
          approvals: [],
          count: 0,
        },
      };
    }

    const approvals = getPendingApprovals(req.user.username);

    return {
      status: 200,
      data: {
        approvals,
        count: approvals.length,
      },
    };
  } catch (error) {
    return {
      status: 500,
      data: {
        error: 'Failed to load approvals',
        message: (error as Error).message,
      },
    };
  }
}

/**
 * POST /api/active-operator/approvals
 */
export async function handleResolveActiveOperatorApproval(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    if (!req.user.isAuthenticated) {
      return authRequired();
    }

    const body = req.body || {};
    const { requestId, approved } = body;

    if (!requestId) {
      return {
        status: 400,
        error: 'Missing requestId',
      };
    }

    if (typeof approved !== 'boolean') {
      return {
        status: 400,
        error: 'approved must be a boolean',
      };
    }

    const result = resolveApproval(req.user.username, requestId, approved, req.user.username);

    if (!result) {
      return {
        status: 404,
        error: 'Approval request not found',
      };
    }

    return {
      status: 200,
      data: {
        success: true,
        request: result,
      },
    };
  } catch (error) {
    return {
      status: 500,
      data: {
        error: 'Failed to resolve approval',
        message: (error as Error).message,
      },
    };
  }
}
