/**
 * Active Operator Service
 *
 * Background service that runs the LLM-controlled continuous thinking system.
 * When enabled, this service:
 * 1. Continuously gathers system state
 * 2. Uses the decision engine to choose what task to run
 * 3. Executes the chosen task
 * 4. Records results and loops
 *
 * User messages are prioritized and processed immediately via the queue.
 */

import {
  getModeController,
  loadActiveOperatorConfig,
  gatherSystemState,
  getTaskRecommendations,
  recordDecision,
  recordThought,
  updateActivitySummary,
  getScratchpadContext,
  saveQueueState,
  loadQueueState,
  isWithinBudget,
  shouldPauseDueToErrors,
  resetErrorCounter,
  UnifiedQueue,
  type TaskType,
  type TaskDecision,
  type QueuedTask,
} from '../../packages/core/src/index.js';

import { executeTask, isTaskExecutable } from '../../packages/core/src/active-operator/task-executor.js';
import { callLLM } from '../../packages/core/src/model-router.js';
import { audit } from '../../packages/core/src/audit.js';
import { loadAllUsers } from '../../packages/core/src/users.js';

const LOG_PREFIX = '[active-operator]';

// Service state
let isRunning = false;
let shouldStop = false;
let currentTask: QueuedTask | null = null;
let consecutiveTasks = 0;
let queue: UnifiedQueue | null = null;

/**
 * Task descriptions for LLM decision prompt.
 */
const TASK_DESCRIPTIONS: Record<TaskType, string> = {
  user_message: 'Process a user chat message (highest priority)',
  memory_curate: 'Run organizer to enrich memories with tags and entities',
  index_build: 'Build/update vector embeddings index for semantic search',
  reflect: 'Generate internal reflections using associative memory chains',
  curiosity: 'Generate user-facing curiosity questions',
  inner_curiosity: 'Generate and answer internal curiosity questions',
  dream: 'Create surreal dreams from memory fragments',
  desire_generate: 'Generate new desires from goals, tasks, and memories',
  desire_execute: 'Execute a pending desire that reached activation threshold',
  psychoanalyze: 'Run psychoanalyzer to update persona based on memories',
  code_analyze: 'Analyze codebase for TypeScript errors (self-healing)',
};

/**
 * Make a decision about what task to run next.
 */
async function makeDecision(
  username: string,
  queueLength: number
): Promise<TaskDecision | null> {
  const config = loadActiveOperatorConfig();

  // Check budget and error limits
  if (!isWithinBudget()) {
    recordThought('Energy budget exhausted, pausing...');
    return null;
  }

  if (shouldPauseDueToErrors()) {
    recordThought('Too many consecutive errors, pausing...');
    return null;
  }

  // Gather system state
  const systemState = await gatherSystemState(username, queueLength);
  const recommendations = getTaskRecommendations(systemState);

  // Get recent activity context
  const recentActivity = getScratchpadContext(10);

  // Format task options
  const taskOptions = config.enabledTaskTypes
    .filter((t) => t !== 'user_message' && isTaskExecutable(t))
    .map((t) => `- ${t}: ${TASK_DESCRIPTIONS[t]}`)
    .join('\n');

  const recommendationsText = recommendations
    .slice(0, 5)
    .map((r) => `- [${r.urgency.toUpperCase()}] ${r.task}: ${r.reason}`)
    .join('\n');

  // Build decision prompt
  const messages = [
    {
      role: 'system' as const,
      content: `You are the Active Operator for MetaHuman OS. Decide what cognitive task to run next.

Available Tasks:
${taskOptions}

Guidelines:
1. Prioritize HIGH urgency recommendations
2. Balance maintenance (memory, indexing) with creative (dreams, reflections)
3. Consider recent activity to avoid repetition
4. If nothing urgent, choose a low-impact background task

Respond with JSON only: {"task": "<type>", "reasoning": "<why>"}`,
    },
    {
      role: 'user' as const,
      content: `System State:
- Unprocessed memories: ${systemState.unprocessedMemories}
- Index age: ${systemState.indexAgeHours.toFixed(1)} hours
- Pending desires: ${systemState.pendingDesires}
- Last reflection: ${systemState.hoursSinceReflection.toFixed(1)} hours ago
- User active: ${systemState.userActive ? 'Yes' : 'No'}

Recommendations:
${recommendationsText}

Recent Activity:
${recentActivity}

What should I focus on next?`,
    },
  ];

  try {
    // Determine model based on config
    let modelRole = 'orchestrator';
    if (config.decisionModel === 'persona') {
      modelRole = 'persona';
    } else if (config.decisionModel === 'fast') {
      modelRole = 'fallback';
    }

    const response = await callLLM({
      role: modelRole,
      messages,
      userId: username,
      options: {
        maxTokens: 256,
        temperature: 0.3,
      },
    });

    // Parse response
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.task && TASK_DESCRIPTIONS[parsed.task as TaskType]) {
        const decision: TaskDecision = {
          task: parsed.task as TaskType,
          reasoning: parsed.reasoning || 'No reasoning provided',
        };
        recordDecision(decision);
        return decision;
      }
    }

    // Fallback to first recommendation
    console.warn(`${LOG_PREFIX} Failed to parse decision, using recommendation`);
    const fallback = recommendations[0];
    if (fallback) {
      const decision: TaskDecision = {
        task: fallback.task,
        reasoning: `Fallback: ${fallback.reason}`,
      };
      recordDecision(decision);
      return decision;
    }

    return null;
  } catch (error) {
    console.error(`${LOG_PREFIX} Decision error:`, error);
    recordThought(`Decision error: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Main decision loop.
 */
async function runDecisionLoop(username: string): Promise<void> {
  const config = loadActiveOperatorConfig();
  const modeController = getModeController();

  console.log(`${LOG_PREFIX} Starting decision loop for ${username}`);

  while (isRunning && !shouldStop && !modeController.shutdownRequested) {
    try {
      // Check for user messages in queue first (critical priority)
      if (queue && queue.hasUserMessages()) {
        const userTask = queue.dequeue()!;
        console.log(`${LOG_PREFIX} Processing user message from queue`);
        currentTask = userTask;
        await executeTask(userTask);
        currentTask = null;
        saveQueueState(queue.export());
        consecutiveTasks++;
        continue;
      }

      // Check if we should pause for cooldown
      if (consecutiveTasks >= config.maxConsecutiveTasks) {
        console.log(`${LOG_PREFIX} Max consecutive tasks reached, pausing...`);
        updateActivitySummary(`Paused after ${consecutiveTasks} consecutive tasks`);
        await sleep(config.cooldownMs * 2);
        consecutiveTasks = 0;
        continue;
      }

      // Make a decision
      const decision = await makeDecision(username, queue?.length || 0);

      if (!decision) {
        // No decision made (budget/error limits), wait and retry
        await sleep(config.cooldownMs * 2);
        continue;
      }

      // Execute the chosen task
      console.log(`${LOG_PREFIX} Executing: ${decision.task} - ${decision.reasoning}`);

      const task: QueuedTask = {
        id: `active-${Date.now()}`,
        type: decision.task,
        priority: 'normal',
        queuedAt: new Date().toISOString(),
        payload: { type: decision.task } as any,
        username,
      };

      currentTask = task;
      const result = await executeTask(task);
      currentTask = null;

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
 * Sleep helper.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Start the active operator service.
 */
export async function startActiveOperatorService(): Promise<void> {
  if (isRunning) {
    console.log(`${LOG_PREFIX} Already running`);
    return;
  }

  const config = loadActiveOperatorConfig();
  if (!config.enabled) {
    console.log(`${LOG_PREFIX} Active operator is disabled in config`);
    return;
  }

  console.log(`${LOG_PREFIX} Starting Active Operator Service...`);

  isRunning = true;
  shouldStop = false;
  consecutiveTasks = 0;

  // Initialize queue with persisted state
  const savedQueue = loadQueueState();
  queue = new UnifiedQueue({
    initialQueue: savedQueue || [],
    onQueueChange: saveQueueState,
  });

  // Get primary user (for now, use first available user)
  const users = await loadAllUsers();
  const primaryUser = users.find((u) => u.role === 'owner') || users[0];

  if (!primaryUser) {
    console.error(`${LOG_PREFIX} No users found, cannot start`);
    isRunning = false;
    return;
  }

  const modeController = getModeController();
  await modeController.activateActiveMode();
  modeController.start();

  audit({
    category: 'system',
    level: 'info',
    event: 'active_operator_service_started',
    actor: 'active-operator-service',
    details: {
      username: primaryUser.username,
      config: {
        decisionModel: config.decisionModel,
        cooldownMs: config.cooldownMs,
        maxConsecutiveTasks: config.maxConsecutiveTasks,
        enabledTaskTypes: config.enabledTaskTypes,
      },
    },
  });

  // Start the decision loop
  runDecisionLoop(primaryUser.username).catch((error) => {
    console.error(`${LOG_PREFIX} Fatal error in decision loop:`, error);
    isRunning = false;
  });

  console.log(`${LOG_PREFIX} Active Operator Service started for ${primaryUser.username}`);
}

/**
 * Stop the active operator service.
 */
export async function stopActiveOperatorService(): Promise<void> {
  if (!isRunning) {
    console.log(`${LOG_PREFIX} Not running`);
    return;
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
  queue = null;

  await modeController.activatePassiveMode();

  audit({
    category: 'system',
    level: 'info',
    event: 'active_operator_service_stopped',
    actor: 'active-operator-service',
    details: {},
  });

  console.log(`${LOG_PREFIX} Active Operator Service stopped`);
}

/**
 * Enqueue a user message for priority processing.
 */
export function enqueueUserMessage(
  message: string,
  username: string,
  options?: { conversationId?: string; sessionId?: string }
): QueuedTask | null {
  if (!queue) {
    console.warn(`${LOG_PREFIX} Queue not initialized, cannot enqueue message`);
    return null;
  }

  const task = queue.enqueueUserMessage(message, username, options);
  console.log(`${LOG_PREFIX} Enqueued user message: ${task.id}`);
  return task;
}

/**
 * Get current service status.
 */
export function getActiveOperatorStatus(): {
  isRunning: boolean;
  currentTask: QueuedTask | null;
  queueLength: number;
  consecutiveTasks: number;
} {
  return {
    isRunning,
    currentTask,
    queueLength: queue?.length || 0,
    consecutiveTasks,
  };
}

/**
 * Check if active operator is running.
 */
export function isActiveOperatorRunning(): boolean {
  return isRunning;
}

// If run directly, start the service
if (import.meta.url === `file://${process.argv[1]}`) {
  startActiveOperatorService().catch((error) => {
    console.error(`${LOG_PREFIX} Failed to start:`, error);
    process.exit(1);
  });
}
