/**
 * Task Executor for Active Operator
 *
 * Executes queued tasks by invoking the appropriate agents or handlers.
 * Maps task types to their implementations.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { systemPaths, ROOT } from '../paths.js';
import { audit } from '../audit.js';
import type {
  QueuedTask,
  TaskResult,
  TaskType,
  UserMessagePayload,
  DesireExecutePayload,
} from './types.js';
import {
  saveCurrentTask,
  clearCurrentTask,
  recordExecutionStart,
  recordTaskResult,
} from './state-persister.js';
import { recordTaskExecution } from './cost-tracker.js';
import { runSelfHealing } from './self-healing.js';

// Path to tsx executable
const TSX_PATH = path.join(ROOT, 'node_modules', '.bin', 'tsx');

/**
 * Map of task types to their agent script names.
 */
const TASK_TO_AGENT: Record<TaskType, string | null> = {
  user_message: null, // Handled specially via chat handler
  memory_curate: 'organizer',
  index_build: null, // Handled via buildMemoryIndex function
  reflect: 'reflector',
  curiosity: 'curiosity-service',
  inner_curiosity: 'inner-curiosity',
  dream: 'dreamer',
  desire_generate: 'desire-generator',
  desire_execute: 'desire-executor',
  psychoanalyze: 'psychoanalyzer',
  code_analyze: null, // Will be implemented in Phase 5
};

/**
 * Run an agent as a subprocess.
 */
async function runAgentProcess(
  agentName: string,
  args: string[] = [],
  username?: string
): Promise<{ success: boolean; exitCode: number; error?: string }> {
  return new Promise((resolve) => {
    const agentPath = path.join(systemPaths.brain, 'agents', `${agentName}.ts`);

    if (!fs.existsSync(agentPath)) {
      console.warn(`[task-executor] Agent not found: ${agentPath}`);
      resolve({
        success: false,
        exitCode: 1,
        error: `Agent ${agentName} not found`,
      });
      return;
    }

    console.log(`[task-executor] Running agent: ${agentName}`);

    // Set username in environment if provided
    const env = { ...process.env };
    if (username) {
      env.MH_TRIGGER_USERNAME = username;
    }

    const child = spawn(TSX_PATH, [agentPath, ...args], {
      stdio: 'pipe',
      cwd: ROOT,
      env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      console.error(`[task-executor] Failed to start ${agentName}: ${err.message}`);
      resolve({
        success: false,
        exitCode: 1,
        error: err.message,
      });
    });

    child.on('close', (code) => {
      const exitCode = code ?? 0;
      if (exitCode !== 0) {
        console.error(`[task-executor] ${agentName} exited with code ${exitCode}`);
        if (stderr) console.error(`[task-executor] stderr: ${stderr.slice(0, 500)}`);
      } else {
        console.log(`[task-executor] ${agentName} completed successfully`);
      }
      resolve({
        success: exitCode === 0,
        exitCode,
        error: exitCode !== 0 ? (stderr || `Exit code ${exitCode}`) : undefined,
      });
    });
  });
}

/**
 * Handle index_build task by calling buildMemoryIndex.
 */
async function executeIndexBuild(username: string): Promise<{ success: boolean; error?: string }> {
  try {
    // Dynamic import to avoid circular dependency
    const { buildMemoryIndex } = await import('../vector-index.js');
    await buildMemoryIndex({ username });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Handle user_message task.
 * This is typically handled by the chat handler directly, but we provide
 * a fallback implementation here.
 */
async function executeUserMessage(
  payload: UserMessagePayload,
  username: string
): Promise<{ success: boolean; error?: string }> {
  // User messages should be processed through the normal chat pipeline.
  // This executor is called if the message was queued and needs processing.
  // For now, we'll mark it as needing to be handled by the chat system.
  console.log(`[task-executor] User message should be processed by chat handler`);

  // The actual processing happens in persona-chat.ts when it dequeues
  // We just acknowledge here
  return { success: true };
}

/**
 * Handle desire_execute task with specific desire ID.
 */
async function executeDesire(
  payload: DesireExecutePayload,
  username: string
): Promise<{ success: boolean; error?: string }> {
  const result = await runAgentProcess('desire-executor', [payload.desireId], username);
  return {
    success: result.success,
    error: result.error,
  };
}

/**
 * Execute a queued task.
 */
export async function executeTask(task: QueuedTask): Promise<TaskResult> {
  const startTime = Date.now();
  const username = task.username || 'anonymous';

  // Save current task for crash recovery
  saveCurrentTask(task);
  recordExecutionStart(task);

  audit({
    category: 'agent',
    level: 'info',
    event: 'active_operator_task_started',
    actor: 'active-operator',
    details: {
      taskId: task.id,
      taskType: task.type,
      priority: task.priority,
      username,
    },
  });

  let success = false;
  let error: string | undefined;
  let data: unknown;

  try {
    switch (task.type) {
      case 'user_message':
        const msgResult = await executeUserMessage(task.payload as UserMessagePayload, username);
        success = msgResult.success;
        error = msgResult.error;
        break;

      case 'index_build':
        const indexResult = await executeIndexBuild(username);
        success = indexResult.success;
        error = indexResult.error;
        break;

      case 'desire_execute':
        const desireResult = await executeDesire(task.payload as DesireExecutePayload, username);
        success = desireResult.success;
        error = desireResult.error;
        break;

      case 'code_analyze':
        // Self-healing code analysis
        console.log('[task-executor] Running self-healing code analysis');
        try {
          const healingResult = await runSelfHealing(username, 5);
          success = true;
          data = {
            errorsFound: healingResult.errorsFound,
            proposalsCreated: healingResult.proposalsCreated,
            proposals: healingResult.proposals.map((p) => ({
              id: p.id,
              file: p.error.file,
              line: p.error.line,
              confidence: p.confidence,
            })),
          };
        } catch (err) {
          success = false;
          error = (err as Error).message;
        }
        break;

      default:
        // Standard agent execution
        const agentName = TASK_TO_AGENT[task.type];
        if (agentName) {
          const agentResult = await runAgentProcess(agentName, [], username);
          success = agentResult.success;
          error = agentResult.error;
        } else {
          error = `No handler for task type: ${task.type}`;
          success = false;
        }
    }
  } catch (err) {
    success = false;
    error = (err as Error).message;
    console.error(`[task-executor] Error executing ${task.type}:`, err);
  }

  const durationMs = Date.now() - startTime;

  // Clear current task
  clearCurrentTask();

  // Build result
  const result: TaskResult = {
    taskId: task.id,
    success,
    completedAt: new Date().toISOString(),
    durationMs,
    error,
    data,
  };

  // Record result
  recordTaskResult(result);
  recordTaskExecution(task.type, result);

  audit({
    category: 'agent',
    level: success ? 'info' : 'warn',
    event: 'active_operator_task_completed',
    actor: 'active-operator',
    details: {
      taskId: task.id,
      taskType: task.type,
      success,
      durationMs,
      error,
      username,
    },
  });

  return result;
}

/**
 * Check if a task type is executable.
 */
export function isTaskExecutable(taskType: TaskType): boolean {
  if (taskType === 'user_message') return true;
  if (taskType === 'index_build') return true;
  if (taskType === 'code_analyze') return true; // Will be implemented

  const agentName = TASK_TO_AGENT[taskType];
  if (!agentName) return false;

  const agentPath = path.join(systemPaths.brain, 'agents', `${agentName}.ts`);
  return fs.existsSync(agentPath);
}

/**
 * Get list of available task types.
 */
export function getAvailableTaskTypes(): TaskType[] {
  const types: TaskType[] = [];

  for (const [taskType, agentName] of Object.entries(TASK_TO_AGENT)) {
    if (isTaskExecutable(taskType as TaskType)) {
      types.push(taskType as TaskType);
    }
  }

  return types;
}
