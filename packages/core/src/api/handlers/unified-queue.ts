/**
 * Unified Queue API Handler
 *
 * Provides status and control for the unified queue system.
 * Shows all lanes, running tasks, and allows triggering agents.
 */

import { getQueueSystem, getQueueManager } from '../../queue/index.js';
import { audit } from '../../audit.js';
import type { UnifiedRequest, UnifiedResponse, UnifiedUser } from './types.js';

/**
 * GET /api/unified-queue
 * Returns the current queue state across all lanes
 */
export async function handleGetQueueStatus(
  req: UnifiedRequest,
  user: UnifiedUser
): Promise<UnifiedResponse> {
  try {
    const queueSystem = getQueueSystem();
    const state = queueSystem.getState();

    // Get tasks by lane for detailed view
    const queueManager = getQueueManager();
    const tasksByLane = {
      'local-llm': queueManager.getLaneTasks('local-llm'),
      'vector-index': queueManager.getLaneTasks('vector-index'),
      'remote-llm': queueManager.getLaneTasks('remote-llm'),
    };

    return {
      status: 200,
      json: {
        success: true,
        running: state.running,
        paused: state.paused,
        stats: state.stats,
        lanes: state.lanes,
        tasksByLane,
        inFlightRemote: state.inFlightRemote,
        nextTriggers: state.nextTriggers,
        lastActivity: state.lastActivity,
      },
    };
  } catch (error) {
    console.error('[unified-queue] Error getting status:', error);
    return {
      status: 500,
      json: {
        success: false,
        error: (error as Error).message,
      },
    };
  }
}

/**
 * POST /api/unified-queue/enqueue
 * Enqueue a new task
 */
export async function handleEnqueueTask(
  req: UnifiedRequest,
  user: UnifiedUser
): Promise<UnifiedResponse> {
  try {
    const body = req.body as {
      type: string;
      payload?: Record<string, any>;
      priority?: string;
    };

    if (!body.type) {
      return {
        status: 400,
        json: { success: false, error: 'Missing task type' },
      };
    }

    const queueSystem = getQueueSystem();
    const task = queueSystem.enqueue({
      type: body.type as any,
      payload: body.payload || {},
      username: user.username,
      priority: (body.priority as any) || 'normal',
    });

    audit({
      level: 'info',
      category: 'action',
      event: 'queue_task_enqueued_api',
      actor: user.username,
      details: {
        taskId: task.id,
        type: task.type,
        priority: task.priority,
        lane: task.resourceLane,
      },
    });

    return {
      status: 200,
      json: {
        success: true,
        task: {
          id: task.id,
          type: task.type,
          priority: task.priority,
          lane: task.resourceLane,
          queuedAt: task.queuedAt,
        },
      },
    };
  } catch (error) {
    console.error('[unified-queue] Error enqueueing task:', error);
    return {
      status: 500,
      json: {
        success: false,
        error: (error as Error).message,
      },
    };
  }
}

/**
 * POST /api/unified-queue/trigger/:agentId
 * Manually trigger an agent
 */
export async function handleTriggerAgent(
  req: UnifiedRequest,
  user: UnifiedUser
): Promise<UnifiedResponse> {
  try {
    const agentId = req.params?.agentId || req.body?.agentId;

    if (!agentId) {
      return {
        status: 400,
        json: { success: false, error: 'Missing agentId' },
      };
    }

    const queueSystem = getQueueSystem();
    const taskId = queueSystem.triggerAgent(agentId, user.username);

    if (!taskId) {
      return {
        status: 404,
        json: { success: false, error: `Unknown agent: ${agentId}` },
      };
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'queue_agent_triggered_api',
      actor: user.username,
      details: {
        agentId,
        taskId,
      },
    });

    return {
      status: 200,
      json: {
        success: true,
        agentId,
        taskId,
      },
    };
  } catch (error) {
    console.error('[unified-queue] Error triggering agent:', error);
    return {
      status: 500,
      json: {
        success: false,
        error: (error as Error).message,
      },
    };
  }
}

/**
 * POST /api/unified-queue/control
 * Control the queue (start/stop/pause/resume)
 */
export async function handleQueueControl(
  req: UnifiedRequest,
  user: UnifiedUser
): Promise<UnifiedResponse> {
  try {
    const body = req.body as { action: 'start' | 'stop' | 'pause' | 'resume' };

    if (!body.action) {
      return {
        status: 400,
        json: { success: false, error: 'Missing action' },
      };
    }

    const queueSystem = getQueueSystem();
    let result = false;

    switch (body.action) {
      case 'start':
        result = await queueSystem.start();
        break;
      case 'stop':
        result = await queueSystem.stop();
        break;
      case 'pause':
        queueSystem.pause();
        result = true;
        break;
      case 'resume':
        queueSystem.resume();
        result = true;
        break;
      default:
        return {
          status: 400,
          json: { success: false, error: `Unknown action: ${body.action}` },
        };
    }

    audit({
      level: 'info',
      category: 'action',
      event: `queue_${body.action}`,
      actor: user.username,
      details: { result },
    });

    return {
      status: 200,
      json: {
        success: result,
        action: body.action,
        state: queueSystem.getState(),
      },
    };
  } catch (error) {
    console.error('[unified-queue] Error controlling queue:', error);
    return {
      status: 500,
      json: {
        success: false,
        error: (error as Error).message,
      },
    };
  }
}

/**
 * GET /api/unified-queue/triggers
 * Get all registered triggers and their next run times
 */
export async function handleGetTriggers(
  req: UnifiedRequest,
  user: UnifiedUser
): Promise<UnifiedResponse> {
  try {
    const queueSystem = getQueueSystem();
    const triggers = queueSystem.triggers.getTriggers();

    const triggerList = Array.from(triggers.entries()).map(([id, state]) => ({
      id,
      type: state.config.type,
      enabled: state.config.enabled,
      priority: state.config.priority,
      lastRun: state.lastRun?.toISOString(),
      nextRun: state.nextRun?.toISOString(),
      runCount: state.runCount,
      errorCount: state.errorCount,
      // Type-specific config
      interval: state.config.interval,
      schedule: state.config.schedule,
      inactivityThreshold: state.config.inactivityThreshold,
    }));

    return {
      status: 200,
      json: {
        success: true,
        triggers: triggerList,
        nextTriggers: queueSystem.getState().nextTriggers,
      },
    };
  } catch (error) {
    console.error('[unified-queue] Error getting triggers:', error);
    return {
      status: 500,
      json: {
        success: false,
        error: (error as Error).message,
      },
    };
  }
}

/**
 * POST /api/unified-queue/activity
 * Record user activity (pauses queue temporarily)
 */
export async function handleRecordActivity(
  req: UnifiedRequest,
  user: UnifiedUser
): Promise<UnifiedResponse> {
  try {
    const queueSystem = getQueueSystem();
    queueSystem.recordActivity(user.username);

    return {
      status: 200,
      json: {
        success: true,
        lastActivity: queueSystem.getState().lastActivity,
      },
    };
  } catch (error) {
    console.error('[unified-queue] Error recording activity:', error);
    return {
      status: 500,
      json: {
        success: false,
        error: (error as Error).message,
      },
    };
  }
}
