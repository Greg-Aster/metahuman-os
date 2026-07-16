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
  updateActiveOperatorConfig,
  loadPendingProposals,
  updateProposalStatus,
  runSelfHealing,
  getPendingApprovals,
  resolveApproval,
} from '../../active-operator/index.js';
import { getQueueManager, getQueueSystem } from '../../queue/index.js';
import type { AutonomyMode } from '../../queue/types.js';

type ControlAction = 'start' | 'stop' | 'set-mode' | 'emergency-stop' | 'reset';

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
    const controller = getModeController();
    const modeStatus = controller.getStatus();
    const manager = getQueueManager();
    const system = getQueueSystem();
    const activeWork = manager.getAllTasks();

    return {
      status: 200,
      data: {
        mode: modeStatus.mode,
        isExecuting: modeStatus.isExecuting,
        currentTask: modeStatus.currentTask || null,
        consecutiveTasks: modeStatus.policy.consecutiveAutonomousWork,
        health: modeStatus.health,
        healthMessage: modeStatus.healthMessage,
        policy: modeStatus.policy,
        queue: {
          length: activeWork.length,
          tasks: activeWork.slice(0, 10).map(task => ({
            id: task.id,
            type: task.type,
            handler: task.handler,
            state: task.state,
            priority: task.priority,
            source: task.source,
            createdAt: task.createdAt,
          })),
          hasUserMessages: activeWork.some(task => task.type === 'user_message'),
        },
        config: {
          autonomyMode: config.autonomyMode,
          cooldownMs: config.cooldownMs,
          maxConsecutiveTasks: config.maxConsecutiveTasks,
          maxEvaluationsPerHour: config.maxEvaluationsPerHour,
          userPresenceCooldownMs: config.userPresenceCooldownMs,
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

    const input = { ...(req.body || {}) };
    const body = {
      autonomyMode: input.autonomyMode,
      cooldownMs: input.cooldownMs,
      maxConsecutiveTasks: input.maxConsecutiveTasks,
      maxEvaluationsPerHour: input.maxEvaluationsPerHour,
      userPresenceCooldownMs: input.userPresenceCooldownMs,
    };
    const requestedMode = body.autonomyMode as AutonomyMode | undefined;
    if (requestedMode && !['reactive', 'semi', 'full'].includes(requestedMode)) {
      return { status: 400, error: 'autonomyMode must be reactive, semi, or full' };
    }
    const config = updateActiveOperatorConfig(body);
    if (requestedMode) await getModeController().setMode(requestedMode, req.user.username);

    return {
      status: 200,
      data: { ...config, autonomyMode: getModeController().mode },
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

    if (!action || !['start', 'stop', 'set-mode', 'emergency-stop', 'reset'].includes(action)) {
      return {
        status: 400,
        error: 'Invalid action. Use: start, stop, set-mode, emergency-stop, reset',
      };
    }

    let result: { success: boolean; mode: string; message: string };
    const controller = getModeController();

    switch (action) {
      case 'start': {
        await controller.setMode('full', req.user.username);
        result = {
          success: true,
          mode: 'full',
          message: 'Full autonomy enabled',
        };
        break;
      }

      case 'stop': {
        await controller.setMode('reactive', req.user.username);
        result = {
          success: true,
          mode: 'reactive',
          message: 'Reactive mode enabled',
        };
        break;
      }

      case 'set-mode': {
        const mode = body.mode as AutonomyMode;
        if (!['reactive', 'semi', 'full'].includes(mode)) {
          return { status: 400, error: 'mode must be reactive, semi, or full' };
        }
        await controller.setMode(mode, req.user.username);
        result = { success: true, mode, message: `${mode} mode enabled` };
        break;
      }

      case 'emergency-stop': {
        await controller.emergencyStop(req.user.username);
        result = {
          success: true,
          mode: 'reactive',
          message: 'Active Operator emergency stopped',
        };
        break;
      }

      case 'reset': {
        await controller.reset(req.user.username);
        result = {
          success: true,
          mode: 'reactive',
          message: 'Active Operator reset to initial state',
        };
        break;
      }

      default:
        result = {
          success: false,
          mode: 'reactive',
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
