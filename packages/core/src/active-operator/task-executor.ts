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
  DesireAdvancePayload,
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
  desire_advance: null, // Handled specially - runs desire through planning/review/approval
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
    // Try subdirectory structure first (brain/agents/name/cli.ts)
    let agentPath = path.join(systemPaths.brain, 'agents', agentName, 'cli.ts');
    if (!fs.existsSync(agentPath)) {
      // Fall back to flat structure (brain/agents/name.ts)
      agentPath = path.join(systemPaths.brain, 'agents', `${agentName}.ts`);
    }

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
 * Handle desire_advance task.
 * Processes pending desires through the planning/review/approval pipeline.
 * - Runs desire-planner to generate execution plan
 * - Runs desire-reviewer to check alignment and safety
 * - Gets verdict and either auto-approves or queues for user approval
 * - Posts approval request to inner dialogue if user approval needed
 */
async function executeDesireAdvance(
  payload: DesireAdvancePayload | undefined,
  username: string
): Promise<{ success: boolean; error?: string; data?: any }> {
  console.log('[task-executor] Running desire_advance pipeline');

  try {
    // Dynamic imports to avoid circular dependencies
    const { listDesiresByStatus, loadDesire, moveDesire } = await import('../agency/storage.js');
    const { loadDecisionRules } = await import('../identity.js');
    const { canAutoApprove, loadConfig } = await import('../agency/config.js');
    const { appendReflectionToBuffer } = await import('../conversation-buffer.js');

    // Get pending AND nascent desires that need processing
    // (both status types count toward pendingReadyToAdvance in system-state.ts)
    const [pendingDesires, nascentDesires] = await Promise.all([
      listDesiresByStatus('pending', username),
      listDesiresByStatus('nascent', username),
    ]);
    const allPendingDesires = [...pendingDesires, ...nascentDesires];
    const config = await loadConfig(username);
    const activationThreshold = config.thresholds.activation;

    // Filter to desires that have crossed activation threshold
    const readyDesires = allPendingDesires.filter(d => d.strength >= activationThreshold);

    if (readyDesires.length === 0) {
      console.log('[task-executor] No pending desires ready for advancement');
      return { success: true, data: { processed: 0, reason: 'No pending desires above activation threshold' } };
    }

    console.log(`[task-executor] Found ${readyDesires.length} desire(s) ready for advancement`);

    let processed = 0;
    let autoApproved = 0;
    let awaitingApproval = 0;

    // Get current trust level
    let currentTrustLevel = 'supervised_auto';
    try {
      const rules = loadDecisionRules();
      currentTrustLevel = rules.trustLevel;
    } catch {
      console.warn('[task-executor] Could not load decision rules, using default trust level');
    }

    for (const desire of readyDesires.slice(0, 3)) { // Process max 3 at a time
      console.log(`[task-executor] Processing desire: ${desire.title} (strength: ${desire.strength.toFixed(2)})`);

      // Remember the original status for moveDesire (could be 'pending' or 'nascent')
      const originalStatus = desire.status;

      // Step 1: Generate plan if missing
      if (!desire.plan) {
        console.log('[task-executor] Moving desire to planning status and generating plan...');

        // Move desire to 'planning' status so desire-planner can find it
        const now = new Date().toISOString();
        desire.status = 'planning';
        desire.updatedAt = now;
        await moveDesire(desire, originalStatus, 'planning', username);

        // Run desire-planner (it will find desires in 'planning' status)
        const planResult = await runAgentProcess('desire-planner', [], username);
        if (!planResult.success) {
          console.error(`[task-executor] Plan generation failed for ${desire.id}`);
          // Move back to original status on failure
          desire.status = originalStatus;
          await moveDesire(desire, 'planning', originalStatus, username);
          continue;
        }

        // Reload desire to get the plan
        const updatedDesire = await loadDesire(desire.id, username);
        if (!updatedDesire?.plan) {
          console.error(`[task-executor] No plan generated for ${desire.id}`);
          // Move back to original status if no plan
          desire.status = originalStatus;
          await moveDesire(desire, 'planning', originalStatus, username);
          continue;
        }
        Object.assign(desire, updatedDesire);
      }

      // After planning, the desire is now in 'planning' status (or was already there)
      // Use the current status as the source for subsequent moves
      const currentStatus = desire.status; // 'planning' if we just moved it, or the status it was in

      // Step 2: Check if can auto-approve based on trust and risk
      const risk = desire.plan?.estimatedRisk || 'medium';
      const approvalCheck = await canAutoApprove(risk, desire.strength, currentTrustLevel, username, desire);

      if (approvalCheck.autoApprove) {
        // Auto-approve and move to approved
        console.log(`[task-executor] ✅ Auto-approving desire: ${desire.title}`);
        const now = new Date().toISOString();
        desire.status = 'approved';
        desire.updatedAt = now;
        await moveDesire(desire, currentStatus, 'approved', username);
        autoApproved++;

        // Post to inner dialogue
        appendReflectionToBuffer(username,
          `🚀 Auto-approved desire: "${desire.title}"\n` +
          `Reason: ${approvalCheck.reason}\n` +
          `This will be executed automatically.`,
          { dialogueSource: 'agency-system', displayColor: '#22c55e' }
        );
      } else {
        // Queue for user approval
        console.log(`[task-executor] 📋 Queuing for approval: ${desire.title}`);
        const now = new Date().toISOString();
        desire.status = 'awaiting_approval';
        desire.updatedAt = now;
        await moveDesire(desire, currentStatus, 'awaiting_approval', username);
        awaitingApproval++;

        // Post approval request to inner dialogue with desire ID for inline approve/reject buttons
        appendReflectionToBuffer(username,
          `⚠️ Approval Required: "${desire.title}"\n\n` +
          `Description: ${desire.description}\n` +
          `Risk Level: ${risk}\n` +
          `Strength: ${(desire.strength * 100).toFixed(0)}%\n\n` +
          `Reason for manual approval: ${approvalCheck.reason}`,
          {
            dialogueSource: 'agency-system',
            displayColor: '#f59e0b',
            type: 'approval_request',
            desireId: desire.id,
            desireTitle: desire.title,
            desireRisk: risk,
          }
        );
      }

      processed++;
    }

    console.log(`[task-executor] Desire advance complete: ${processed} processed, ${autoApproved} auto-approved, ${awaitingApproval} awaiting approval`);

    return {
      success: true,
      data: {
        processed,
        autoApproved,
        awaitingApproval,
        trustLevel: currentTrustLevel,
      },
    };
  } catch (err) {
    console.error('[task-executor] Error in desire_advance:', err);
    return {
      success: false,
      error: (err as Error).message,
    };
  }
}

/**
 * Handle desire_execute task.
 * If a specific desireId is provided, pass it to the executor.
 * Otherwise, the executor will process all approved desires.
 */
async function executeDesire(
  payload: DesireExecutePayload | undefined,
  username: string
): Promise<{ success: boolean; error?: string }> {
  // Only pass desireId as arg if it's actually provided
  const args = payload?.desireId ? [payload.desireId] : [];
  const result = await runAgentProcess('desire-executor', args, username);
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

      case 'desire_advance':
        const advanceResult = await executeDesireAdvance(task.payload as DesireAdvancePayload, username);
        success = advanceResult.success;
        error = advanceResult.error;
        data = advanceResult.data;
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
