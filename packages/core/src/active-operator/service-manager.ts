/**
 * Active Operator Service Manager
 *
 * Manages the lifecycle of the Active Operator decision loop.
 * This module provides a way for the control API to start/stop
 * the actual decision loop service.
 */

// Import directly from modules to avoid circular imports
import { getModeController } from './mode-controller.js';
import { loadConfig as loadActiveOperatorConfig } from './state-persister.js';
import { gatherSystemState } from './system-state.js';
import {
  recordThought,
  updateActivitySummary,
  saveQueueState,
  loadQueueState,
} from './state-persister.js';
import { isWithinBudget, shouldPauseDueToErrors } from './cost-tracker.js';
import { makeUnifiedDecision, checkFocusConstraints } from './lizard-brain.js';
import type { QueuedTask } from './types.js';
import { executeTask } from './task-executor.js';
import { audit } from '../audit.js';
import { getUsers, type SafeUser } from '../users.js';

// Import the new unified queue system with resource lanes
import { getQueueSystem, getQueueManager } from '../queue/index.js';
import type { TaskType as LaneTaskType } from '../queue/types.js';
import { captureEvent } from '../memory.js';
import { setUserContext } from '../context.js';
import { appendReflectionToBuffer } from '../conversation-buffer.js';

const LOG_PREFIX = '[active-operator]';

// Service state
let isRunning = false;
let shouldStop = false;
let currentTask: QueuedTask | null = null;
let consecutiveTasks = 0;
let currentUsername: string | null = null;

// Use the new unified queue system with resource lanes
// The queue is a singleton - we just need to track if we've initialized it
let queueSystemStarted = false;


/**
 * Sleep helper.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main decision loop.
 * Uses the new unified queue system with resource lanes for execution.
 */
async function runDecisionLoop(username: string): Promise<void> {
  const config = loadActiveOperatorConfig();
  const modeController = getModeController();
  const queueManager = getQueueManager();

  // Set user context for memory operations (needed for captureEvent)
  setUserContext(username, username, 'owner');

  console.log(`${LOG_PREFIX} Starting decision loop for ${username} (using lane-based queue)`);

  while (isRunning && !shouldStop && !modeController.shutdownRequested) {
    try {
      // Check for user messages in local-llm lane (critical priority)
      const localLlmTasks = queueManager.getLaneTasks('local-llm');
      const userMessageTask = localLlmTasks.find(t => t.type === 'user_message');
      if (userMessageTask) {
        const dequeuedTask = queueManager.dequeue(userMessageTask.id);
        if (dequeuedTask) {
          console.log(`${LOG_PREFIX} Processing user message from lane queue`);
          // Convert lane task to active-operator task format
          const aoTask: QueuedTask = {
            id: dequeuedTask.id,
            type: dequeuedTask.type as any,
            priority: dequeuedTask.priority as any,
            queuedAt: dequeuedTask.queuedAt,
            payload: dequeuedTask.payload as any,
            username: dequeuedTask.username || username,
          };
          currentTask = aoTask;
          await executeTask(aoTask);
          currentTask = null;
          queueManager.complete(dequeuedTask.id, true);
          consecutiveTasks++;
          continue;
        }
      }

      // Check focus constraints (calendar events, meetings)
      const focusConstraints = await checkFocusConstraints(username);
      if (focusConstraints?.shouldPause) {
        console.log(`${LOG_PREFIX} Pausing due to focus constraint: ${focusConstraints.reason}`);
        recordThought(`Pausing: ${focusConstraints.reason}`);
        await sleep(60000); // Check again in 1 minute
        continue;
      }

      // Track if we're in quick-tasks-only mode (event approaching)
      const quickTasksOnly = focusConstraints?.quickTasksOnly ?? false;
      if (quickTasksOnly) {
        console.log(`${LOG_PREFIX} Quick tasks only mode: ${focusConstraints?.reason}`);
      }

      // Check if we should pause for cooldown
      if (consecutiveTasks >= config.maxConsecutiveTasks) {
        console.log(`${LOG_PREFIX} Max consecutive tasks reached, pausing...`);
        updateActivitySummary(`Paused after ${consecutiveTasks} consecutive tasks`);
        await sleep(config.cooldownMs * 2);
        consecutiveTasks = 0;
        continue;
      }

      // Check budget and error limits before calling LLM
      if (!isWithinBudget()) {
        recordThought('Energy budget exhausted, pausing...');
        await sleep(config.cooldownMs * 2);
        continue;
      }

      if (shouldPauseDueToErrors()) {
        recordThought('Too many consecutive errors, pausing...');
        await sleep(config.cooldownMs * 2);
        continue;
      }

      // Get queue stats from the new lane-based system
      const queueStats = queueManager.getStats();

      // Gather system state for unified decision
      const systemState = await gatherSystemState(username, queueStats.totalQueued);

      // Get all tasks from the queue for decision making
      const allTasks = queueManager.getAllTasks();
      const tasksForDecision: QueuedTask[] = allTasks.map(t => ({
        id: t.id,
        type: t.type as any,
        priority: t.priority as any,
        queuedAt: t.queuedAt,
        payload: t.payload as any,
        username: t.username,
      }));

      // Unified decision: evaluates triggers + queue + state in ONE LLM call
      const decision = await makeUnifiedDecision(
        username,
        tasksForDecision,
        systemState,
        config.enabledTaskTypes,
        quickTasksOnly
      );

      if (!decision) {
        // No decision made, wait and retry
        await sleep(config.cooldownMs * 2);
        continue;
      }

      // Execute the chosen task via the lane-based queue system
      console.log(`${LOG_PREFIX} Executing: ${decision.task} - ${decision.reasoning}`);

      // Capture lizard brain reasoning as inner dialogue
      const innerDialogueText = `🧠 Lizard Brain Decision: ${decision.task}\n\n${decision.reasoning}`;
      captureEvent(innerDialogueText, {
        type: 'inner_dialogue',
        tags: ['lizard-brain', 'autonomous-decision', 'inner', decision.task],
        metadata: {
          source: 'active-operator',
          taskType: decision.task,
          actor: username,
        },
      });
      // Also append to inner buffer for immediate UI display
      appendReflectionToBuffer(username, innerDialogueText);

      // Enqueue to the new unified queue system - it will route to the appropriate lane
      const laneTask = queueManager.enqueue({
        type: decision.task as LaneTaskType,
        payload: { type: decision.task },
        username,
        priority: 'normal',
      });

      // For local-llm tasks, we execute directly since we're the decision loop
      // The queue tracks state, but we handle execution here
      const aoTask: QueuedTask = {
        id: laneTask.id,
        type: decision.task,
        priority: 'normal',
        queuedAt: new Date().toISOString(),
        payload: { type: decision.task } as any,
        username,
      };

      currentTask = aoTask;
      const result = await executeTask(aoTask);
      currentTask = null;

      // Mark task complete in the lane queue
      queueManager.complete(laneTask.id, result.success, result.error);

      if (result.success) {
        consecutiveTasks++;
        console.log(`${LOG_PREFIX} Task completed successfully in ${result.durationMs}ms`);
      } else {
        console.warn(`${LOG_PREFIX} Task failed: ${result.error}`);
      }

      // Cooldown between tasks
      await sleep(config.cooldownMs);
    } catch (error) {
      console.error(`${LOG_PREFIX} Loop error:`, error);
      recordThought(`Loop error: ${(error as Error).message}`);
      await sleep(config.cooldownMs);
    }
  }

  console.log(`${LOG_PREFIX} Decision loop stopped`);
}

/**
 * Start the active operator service.
 * Now uses the unified queue system with resource lanes.
 */
export async function startActiveOperatorService(username?: string): Promise<{
  success: boolean;
  message: string;
}> {
  if (isRunning) {
    return { success: true, message: 'Already running' };
  }

  const config = loadActiveOperatorConfig();

  console.log(`${LOG_PREFIX} Starting Active Operator Service...`);

  isRunning = true;
  shouldStop = false;
  consecutiveTasks = 0;

  // Initialize the unified queue system with resource lanes
  const queueSystem = getQueueSystem();
  await queueSystem.initialize();
  queueSystemStarted = true;

  // Restore any persisted queue state to the new system
  const savedQueue = loadQueueState();
  if (savedQueue && savedQueue.length > 0) {
    const queueManager = getQueueManager();
    for (const task of savedQueue) {
      queueManager.enqueue({
        type: task.type as LaneTaskType,
        payload: task.payload,
        username: task.username || 'system',
        priority: task.priority as any,
      });
    }
    console.log(`${LOG_PREFIX} Restored ${savedQueue.length} tasks from persisted state`);
  }

  // Determine username
  let targetUsername = username;
  if (!targetUsername) {
    const users = getUsers();
    const primaryUser = users.find((u: SafeUser) => u.role === 'owner') || users[0];
    if (!primaryUser) {
      isRunning = false;
      return { success: false, message: 'No users found' };
    }
    targetUsername = primaryUser.username;
  }
  currentUsername = targetUsername;

  const modeController = getModeController();
  await modeController.activateActiveMode();
  modeController.start();

  audit({
    category: 'system',
    level: 'info',
    event: 'active_operator_service_started',
    actor: 'active-operator-service',
    details: {
      username: targetUsername,
      config: {
        decisionModel: config.decisionModel,
        cooldownMs: config.cooldownMs,
        maxConsecutiveTasks: config.maxConsecutiveTasks,
        enabledTaskTypes: config.enabledTaskTypes,
      },
      queueSystem: 'lane-based',
    },
  });

  // Start the decision loop (don't await - runs in background)
  runDecisionLoop(targetUsername).catch((error) => {
    console.error(`${LOG_PREFIX} Fatal error in decision loop:`, error);
    isRunning = false;
  });

  console.log(`${LOG_PREFIX} Active Operator Service started for ${targetUsername} (lane-based queue)`);
  return { success: true, message: `Started for ${targetUsername}` };
}

/**
 * Stop the active operator service.
 */
export async function stopActiveOperatorService(): Promise<{
  success: boolean;
  message: string;
}> {
  if (!isRunning) {
    return { success: true, message: 'Not running' };
  }

  console.log(`${LOG_PREFIX} Stopping Active Operator Service...`);

  shouldStop = true;
  const modeController = getModeController();
  modeController.stop();

  // Wait for current task to complete (up to 30 seconds)
  const maxWait = 30000;
  const startWait = Date.now();
  while (currentTask && Date.now() - startWait < maxWait) {
    await sleep(100);
  }

  isRunning = false;
  queueSystemStarted = false;
  currentUsername = null;

  await modeController.activatePassiveMode();

  audit({
    category: 'system',
    level: 'info',
    event: 'active_operator_service_stopped',
    actor: 'active-operator-service',
    details: {},
  });

  console.log(`${LOG_PREFIX} Active Operator Service stopped`);
  return { success: true, message: 'Stopped' };
}

/**
 * Toggle the active operator service.
 */
export async function toggleActiveOperatorService(username?: string): Promise<{
  success: boolean;
  mode: 'active' | 'passive';
  message: string;
}> {
  if (isRunning) {
    const result = await stopActiveOperatorService();
    return { success: result.success, mode: 'passive', message: result.message };
  } else {
    const result = await startActiveOperatorService(username);
    return { success: result.success, mode: 'active', message: result.message };
  }
}

/**
 * Get current service status.
 */
export function getActiveOperatorServiceStatus(): {
  isRunning: boolean;
  currentTask: QueuedTask | null;
  queueLength: number;
  consecutiveTasks: number;
  username: string | null;
} {
  const queueManager = queueSystemStarted ? getQueueManager() : null;
  return {
    isRunning,
    currentTask,
    queueLength: queueManager?.getStats().totalQueued || 0,
    consecutiveTasks,
    username: currentUsername,
  };
}

/**
 * Enqueue a user message for priority processing.
 */
export function enqueueUserMessage(
  message: string,
  username: string,
  options?: { conversationId?: string; sessionId?: string }
): QueuedTask | null {
  if (!queueSystemStarted) {
    console.warn(`${LOG_PREFIX} Queue not initialized, cannot enqueue message`);
    return null;
  }

  const queueManager = getQueueManager();
  const laneTask = queueManager.enqueue({
    type: 'user_message' as LaneTaskType,
    payload: { message, ...options },
    username,
    priority: 'critical',
  });

  // Convert to QueuedTask format for return
  const task: QueuedTask = {
    id: laneTask.id,
    type: 'user_message',
    priority: 'critical',
    queuedAt: laneTask.queuedAt,
    payload: { message, ...options } as any,
    username,
  };

  console.log(`${LOG_PREFIX} Enqueued user message: ${task.id}`);
  return task;
}
