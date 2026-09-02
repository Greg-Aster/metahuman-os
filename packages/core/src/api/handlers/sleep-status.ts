/**
 * Sleep Status API Handlers
 *
 * Unified handlers for sleep/dream status.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { isLocked } from '../../locks.js';
import { loadSleepConfig } from '../../sleep-config.js';
import { readSleepRuntimeState, type SleepSessionRuntime } from '../../sleep-runtime.js';
import { SLEEP_WORKFLOW_STAGES } from '../../queue/sleep-workflow.js';
import { getQueueManager } from '../../queue/unified-queue-manager.js';

type SleepState = 'awake' | 'sleeping' | 'dreaming';

function determineState(session?: SleepSessionRuntime): SleepState {
  if (session?.currentStageId === 'dream') return 'dreaming';
  if (session) return 'sleeping';
  if (isLocked('agent-dreamer')) return 'dreaming';
  if (isLocked('service-sleep')) return 'sleeping';
  return 'awake';
}

/**
 * GET /api/sleep-status - Get current sleep/dream state
 */
export async function handleGetSleepStatus(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  try {
    const runtime = readSleepRuntimeState();
    const visibleCurrent = runtime.currentSession
      && (user.role === 'owner' || runtime.currentSession.username === user.username)
      ? runtime.currentSession
      : undefined;
    const recentSessions = user.isAuthenticated
      ? runtime.recentSessions.filter(session => user.role === 'owner' || session.username === user.username)
      : [];
    const queue = getQueueManager();
    const currentSession = visibleCurrent ? {
      ...visibleCurrent,
      stages: visibleCurrent.stages.map(stage => {
        const task = stage.taskId ? queue.getTask(stage.taskId) : null;
        return {
          ...stage,
          state: task?.state === 'leased' ? 'running' : stage.state,
          queueState: task?.state,
          attempt: task?.attempt,
          maxAttempts: task?.maxAttempts,
        };
      }),
    } : null;
    const configuredStages = SLEEP_WORKFLOW_STAGES.map(stage => ({
      id: stage.id,
      displayName: stage.displayName,
      handler: stage.handler,
    }));
    return successResponse({
      status: determineState(visibleCurrent),
      phase: visibleCurrent ? runtime.phase : 'awake',
      config: loadSleepConfig(user.isAuthenticated ? user.username : undefined),
      currentSession,
      recentSessions,
      configuredStages,
      lastChecked: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[sleep-status] GET error:', error);
    return { status: 500, error: 'Failed to read sleep status' };
  }
}
