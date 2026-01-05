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
// gatherSystemState is now called by the graph's system_state node
import {
  recordThought,
  updateActivitySummary,
  loadQueueState,
} from './state-persister.js';
import { isWithinBudget, shouldPauseDueToErrors } from './cost-tracker.js';
import { checkFocusConstraints } from './lizard-brain.js';
import { getPendingProposalTaskTypes, proposalEvents } from './operator-proposals.js';
import type { QueuedTask } from './types.js';
import { executeTask } from './task-executor.js';
import { audit } from '../audit.js';
import { getUsers, type SafeUser } from '../users.js';
import { gatherSystemState } from './system-state.js';
// Graph executor imports for Lizard Brain graph
import { executeGraph } from '../graph-executor.js';
import { validateSvelteFlowGraph, type SvelteFlowGraph } from '../cognitive-graph-schema.js';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { ROOT } from '../path-builder.js';

// Import the new unified queue system with resource lanes
import { getQueueSystem, getQueueManager } from '../queue/index.js';
import type { TaskType as LaneTaskType } from '../queue/types.js';
// captureEvent and appendReflectionToBuffer are now handled by the graph's inner_dialogue_capture node
import { setUserContext } from '../context.js';

const LOG_PREFIX = '[active-operator]';

/**
 * Wait for a proposal to be resolved (approved/rejected) or timeout.
 * Uses event-driven approach instead of polling - wakes immediately when user responds.
 *
 * @param username - The username to filter events for
 * @param timeoutMs - Maximum time to wait (fallback if no event)
 * @returns Promise that resolves when event received or timeout
 */
function waitForProposalResolution(username: string, timeoutMs: number = 300000): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        proposalEvents.off('proposal-resolved', handler);
      }
    };

    const handler = (event: { username: string }) => {
      // Only wake up for events matching our username
      if (event.username === username) {
        cleanup();
        resolve();
      }
    };

    // Listen for proposal resolution events
    proposalEvents.on('proposal-resolved', handler);

    // Fallback timeout (5 minutes) in case event is missed
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);

    // Ensure timeout doesn't prevent process exit
    timeout.unref?.();
  });
}

// Lizard Brain graph cache
let lizardBrainGraph: SvelteFlowGraph | null = null;
let lizardBrainGraphMtime: number = 0;

/**
 * Load the Lizard Brain cognitive graph.
 * Caches the graph and reloads if file changed.
 */
async function loadLizardBrainGraph(): Promise<SvelteFlowGraph | null> {
  const graphPath = `${ROOT}/etc/cognitive-graphs/lizard-brain.json`;

  try {
    if (!existsSync(graphPath)) {
      console.error(`${LOG_PREFIX} Lizard Brain graph not found: ${graphPath}`);
      return null;
    }

    const { stat } = await import('node:fs/promises');
    const stats = await stat(graphPath);

    // Use cached graph if unchanged
    if (lizardBrainGraph && stats.mtimeMs === lizardBrainGraphMtime) {
      return lizardBrainGraph;
    }

    // Load and validate graph
    const raw = await readFile(graphPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const validated = validateSvelteFlowGraph(parsed);

    lizardBrainGraph = validated;
    lizardBrainGraphMtime = stats.mtimeMs;

    console.log(`${LOG_PREFIX} Loaded Lizard Brain graph: ${validated.nodes.length} nodes, ${validated.edges.length} edges`);
    return validated;
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to load Lizard Brain graph:`, error);
    return null;
  }
}

/**
 * Execute the Lizard Brain graph for autonomous decision making.
 * The graph handles: trigger evaluation, queue check, LLM decision, task execution, audit, TTS.
 */
async function executeLizardBrainGraph(username: string): Promise<{
  executed: boolean;
  task?: string;
  success?: boolean;
  error?: string;
}> {
  const graph = await loadLizardBrainGraph();
  if (!graph) {
    return { executed: false, error: 'Failed to load Lizard Brain graph' };
  }

  // Build context for graph execution
  // NOTE: No cognitiveMode here - the lizard brain is a system utility that runs
  // agents autonomously. It should NOT be tied to any cognitive mode mapping.
  // The unified_decision_llm node uses role: 'orchestrator' directly.
  const context = {
    userId: username,
    username,
    sessionId: `active-operator-${Date.now()}`,
    environment: 'server', // Force server execution for real node executors
    allowMemoryWrites: true, // Enable inner_dialogue_capture to save decisions
  };

  try {
    console.log(`${LOG_PREFIX} Executing Lizard Brain graph for ${username}`);

    const graphState = await executeGraph(graph, context, (event) => {
      // Log graph execution events
      if (event.type === 'node_start') {
        console.log(`${LOG_PREFIX} [Graph] Node started: ${event.nodeId}`);
      } else if (event.type === 'node_error') {
        console.error(`${LOG_PREFIX} [Graph] Node error: ${event.nodeId}`, event.data);
      }
    });

    if (graphState.status === 'failed') {
      console.error(`${LOG_PREFIX} Lizard Brain graph execution failed`);
      return { executed: false, error: 'Graph execution failed' };
    }

    // Extract results from graph output
    // The task_execution node (id: 6) provides the execution result
    const taskExecutionState = graphState.nodes.get('6');
    const decisionState = graphState.nodes.get('5');

    const task = decisionState?.outputs?.task;
    const executed = taskExecutionState?.outputs?.executed ?? false;
    const success = taskExecutionState?.outputs?.success ?? false;

    console.log(`${LOG_PREFIX} Graph execution complete: task=${task}, executed=${executed}, success=${success}`);

    return {
      executed,
      task,
      success,
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Lizard Brain graph execution error:`, error);
    return { executed: false, error: (error as Error).message };
  }
}

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

      // Check if there are pending HITL proposals awaiting user input
      // If so, wait for user response via event (no polling)
      const pendingProposals = getPendingProposalTaskTypes(username);
      if (pendingProposals.length > 0) {
        console.log(`${LOG_PREFIX} Waiting for user approval: ${pendingProposals.join(', ')}`);
        // Event-driven wait - wakes immediately when user approves/rejects
        await waitForProposalResolution(username);
        continue;
      }

      // Execute the Lizard Brain graph
      // The graph handles: trigger evaluation, queue check, LLM decision, task execution, audit, TTS
      const graphResult = await executeLizardBrainGraph(username);

      if (!graphResult.executed) {
        // No task was executed (either no decision made or graph error)
        if (graphResult.error) {
          console.warn(`${LOG_PREFIX} Graph execution issue: ${graphResult.error}`);
        }
        await sleep(config.cooldownMs * 2);
        continue;
      }

      // Track the execution for cooldown management
      if (graphResult.success) {
        consecutiveTasks++;
        console.log(`${LOG_PREFIX} Task ${graphResult.task} completed successfully`);
      } else {
        console.warn(`${LOG_PREFIX} Task ${graphResult.task} failed`);
      }

      // SOCIAL AWARENESS PAUSE: When user is engaged, pause longer between tasks
      // This prevents overwhelming the user with rapid-fire task execution
      const systemState = await gatherSystemState(username);
      const userEngaged = (systemState.idleMinutes || 0) < 15;

      if (userEngaged) {
        // User is present - pause for 2 minutes to let them engage naturally
        // The system just did something (reflect, curiosity, etc.) - give user time to respond
        console.log(`${LOG_PREFIX} User is engaged (idle ${systemState.idleMinutes}m) - pausing for 2 minutes to allow natural interaction`);
        recordThought('Pausing to allow user interaction (social awareness)');
        await sleep(120000); // 2 minutes
      } else {
        // User is idle - use normal cooldown
        await sleep(config.cooldownMs);
      }
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
  // IMPORTANT: Do NOT start TriggerManager when Active Operator is enabled!
  // The Lizard Brain cognitive graph has its own trigger system in lizard-brain.ts
  // that handles all scheduling decisions (checkIdleReflection, checkIdleCuriosity, etc.)
  // Starting TriggerManager would cause duplicate agent triggers (e.g., 3 reflections at once)
  const queueSystem = getQueueSystem();
  await queueSystem.initialize();
  // NOTE: We intentionally skip queueSystem.startTriggersOnly() here.
  // The old TriggerManager reads agents.json and fires activity-based triggers,
  // but when Active Operator is running, the Lizard Brain makes ALL scheduling decisions.
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
