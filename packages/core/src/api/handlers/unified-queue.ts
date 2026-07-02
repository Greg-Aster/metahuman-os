/**
 * Unified Queue API Handler
 *
 * Provides status and control for the unified queue system.
 * Shows all lanes, running tasks, and allows triggering agents.
 */

import {
  getAllLaneMetrics,
  getLastHourSummary,
  getQueueManager,
  getQueueSystem,
  getThroughputHistory,
  type QueueEvent,
  type ResourceLaneId,
} from '../../queue/index.js';
import { audit } from '../../audit.js';
import type { UnifiedRequest, UnifiedResponse, UnifiedUser } from '../types.js';

type LaneId = 'local-llm' | 'vector-index' | 'remote-llm';

const VALID_LANES: LaneId[] = ['local-llm', 'vector-index', 'remote-llm'];

function success(data: Record<string, unknown>, status = 200): UnifiedResponse {
  return { status, data };
}

function failure(error: string, status = 500): UnifiedResponse {
  return {
    status,
    data: { success: false, error },
  };
}

function requireUser(user: UnifiedUser): UnifiedResponse | null {
  if (user.isAuthenticated) return null;
  return failure('Authentication required', 401);
}

/**
 * GET /api/unified-queue
 * Returns the current queue state across all lanes
 */
export async function handleGetQueueStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
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

    return success({
      success: true,
      running: state.running,
      paused: state.paused,
      stats: state.stats,
      lanes: state.lanes,
      tasksByLane,
      inFlightRemote: state.inFlightRemote,
      nextTriggers: state.nextTriggers,
      lastActivity: state.lastActivity,
    });
  } catch (error) {
    console.error('[unified-queue] Error getting status:', error);
    return failure((error as Error).message);
  }
}

/**
 * POST /api/unified-queue
 * Enqueue a new task
 */
export async function handleEnqueueTask(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const authError = requireUser(req.user);
    if (authError) return authError;

    const body = req.body as {
      type: string;
      payload?: Record<string, any>;
      priority?: string;
    };

    if (!body.type) {
      return failure('Missing task type', 400);
    }

    const queueSystem = getQueueSystem();
    const task = queueSystem.enqueue({
      type: body.type as any,
      payload: body.payload || {},
      username: req.user.username,
      priority: (body.priority as any) || 'normal',
    });

    return success({
      success: true,
      task: {
        id: task.id,
        type: task.type,
        priority: task.priority,
        lane: task.resourceLane,
        queuedAt: task.queuedAt,
      },
    });
  } catch (error) {
    console.error('[unified-queue] Error enqueueing task:', error);
    return failure((error as Error).message);
  }
}

/**
 * POST /api/unified-queue/trigger/:agentId
 * Manually trigger an agent
 */
export async function handleTriggerAgent(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const authError = requireUser(req.user);
    if (authError) return authError;

    const agentId = req.params?.agentId || req.params?.id || req.body?.agentId;

    if (!agentId) {
      return failure('Missing agentId', 400);
    }

    const queueSystem = getQueueSystem();
    const taskId = queueSystem.triggerAgent(agentId, req.user.username);

    if (!taskId) {
      return failure(`Unknown agent: ${agentId}`, 404);
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'queue_agent_triggered',
      actor: req.user.username,
      details: {
        agentId,
        taskId,
      },
    });

    return success({
      success: true,
      agentId,
      taskId,
    });
  } catch (error) {
    console.error('[unified-queue] Error triggering agent:', error);
    return failure((error as Error).message);
  }
}

/**
 * POST /api/unified-queue/control
 * Control the queue (start/stop/pause/resume)
 */
export async function handleQueueControl(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const authError = requireUser(req.user);
    if (authError) return authError;

    const body = req.body as { action: 'start' | 'stop' | 'pause' | 'resume' };

    if (!body.action) {
      return failure('Missing action', 400);
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
        return failure(`Unknown action: ${body.action}`, 400);
    }

    audit({
      level: 'info',
      category: 'action',
      event: `queue_${body.action}`,
      actor: req.user.username,
      details: { result },
    });

    return success({
      success: result,
      action: body.action,
      state: queueSystem.getState(),
    });
  } catch (error) {
    console.error('[unified-queue] Error controlling queue:', error);
    return failure((error as Error).message);
  }
}

/**
 * GET /api/unified-queue/triggers
 * Get all registered triggers and their next run times
 */
export async function handleGetTriggers(req: UnifiedRequest): Promise<UnifiedResponse> {
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

    return success({
      success: true,
      triggers: triggerList,
      nextTriggers: queueSystem.getState().nextTriggers,
    });
  } catch (error) {
    console.error('[unified-queue] Error getting triggers:', error);
    return failure((error as Error).message);
  }
}

/**
 * POST /api/unified-queue/activity
 * Record user activity (pauses queue temporarily)
 */
export async function handleRecordActivity(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const authError = requireUser(req.user);
    if (authError) return authError;

    const queueSystem = getQueueSystem();
    queueSystem.recordActivity(req.user.username);

    return success({
      success: true,
      lastActivity: queueSystem.getState().lastActivity,
    });
  } catch (error) {
    console.error('[unified-queue] Error recording activity:', error);
    return failure((error as Error).message);
  }
}

/**
 * GET /api/queue/lane-control
 */
export async function handleGetQueueLaneControl(): Promise<UnifiedResponse> {
  try {
    const system = getQueueSystem();
    const state = system.getState();

    return success({
      success: true,
      lanes: {
        'local-llm': {
          ...state.lanes['local-llm'],
          paused: system.isLanePaused('local-llm'),
        },
        'vector-index': {
          ...state.lanes['vector-index'],
          paused: system.isLanePaused('vector-index'),
        },
        'remote-llm': {
          ...state.lanes['remote-llm'],
          paused: system.isLanePaused('remote-llm'),
        },
      },
      pausedLanes: system.getPausedLanes(),
    });
  } catch (error) {
    console.error('[queue/lane-control] Error:', error);
    return failure((error as Error).message);
  }
}

/**
 * POST /api/queue/lane-control
 */
export async function handleUpdateQueueLaneControl(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = (req.body || {}) as { lane?: string; action?: 'pause' | 'resume' };
    const { lane, action } = body;

    if (!VALID_LANES.includes(lane as LaneId)) {
      return failure(`Invalid lane: ${lane}. Must be one of: ${VALID_LANES.join(', ')}`, 400);
    }

    if (action !== 'pause' && action !== 'resume') {
      return failure('Invalid action. Must be "pause" or "resume"', 400);
    }

    const system = getQueueSystem();
    const laneId = lane as ResourceLaneId;

    if (action === 'pause') {
      system.pauseLane(laneId);
    } else {
      system.resumeLane(laneId);
    }

    return success({
      success: true,
      lane,
      action,
      paused: system.isLanePaused(laneId),
    });
  } catch (error) {
    console.error('[queue/lane-control] Error:', error);
    return failure((error as Error).message);
  }
}

/**
 * GET /api/queue/metrics
 */
export async function handleGetQueueMetrics(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const hours = parseInt(req.query?.hours || '24', 10);
    const lane = req.query?.lane as LaneId | undefined;
    const metrics = getAllLaneMetrics();
    const history = lane
      ? { [lane]: getThroughputHistory(lane, hours) }
      : {
          'local-llm': getThroughputHistory('local-llm', hours),
          'vector-index': getThroughputHistory('vector-index', hours),
          'remote-llm': getThroughputHistory('remote-llm', hours),
        };

    return success({
      success: true,
      metrics: {
        lastUpdated: metrics.lastUpdated,
        lanes: metrics.lanes,
        history,
        lastHour: getLastHourSummary(),
      },
    });
  } catch (error) {
    console.error('[queue/metrics] Error:', error);
    return failure((error as Error).message);
  }
}

/**
 * GET /api/queue-stream
 */
export async function handleQueueStream(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    async function* errorStream(): AsyncIterable<string> {
      yield `data: ${JSON.stringify({ type: 'error', error: 'Not authenticated' })}\n\n`;
    }

    return {
      status: 200,
      stream: errorStream(),
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    };
  }

  async function* generateStream(): AsyncIterable<string> {
    let isClosed = false;
    const eventQueue: string[] = [];
    const queueManager = getQueueManager();

    const sendEvent = (data: object) => {
      if (isClosed) return;
      eventQueue.push(`data: ${JSON.stringify(data)}\n\n`);
    };

    const listener = (event: QueueEvent) => {
      if (isClosed) return;
      console.log(`[queue-stream] Forwarding event: ${event.type}`);
      sendEvent(event);
    };

    queueManager.addEventListener(listener);

    try {
      yield `data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`;

      while (!isClosed) {
        while (eventQueue.length > 0) {
          yield eventQueue.shift()!;
        }

        if (req.signal?.aborted) {
          isClosed = true;
          break;
        }

        await new Promise(resolve => setTimeout(resolve, 250));
      }
    } finally {
      console.log('[queue-stream] Client disconnected');
      isClosed = true;
      queueManager.removeEventListener(listener);
    }
  }

  return {
    status: 200,
    stream: generateStream(),
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  };
}
