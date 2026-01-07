/**
 * Task Execution Node
 *
 * Executes the chosen task via the task executor, respecting the Human-in-the-Loop
 * approval system based on trust level and task risk.
 *
 * Behavior by trust level:
 * - observe: Log intent only, don't execute or create proposals
 * - suggest: Always create proposal, wait for user approval
 * - supervised_auto: Auto-approve low-risk, propose medium/high risk
 * - bounded_auto: Auto-approve low/medium, propose high risk
 * - adaptive_auto: Auto-approve all, but collect post-execution feedback
 *
 * Also logs the decision cycle to the Lizard Brain activity log.
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { executeTask } from '../../active-operator/task-executor.js';
import type { QueuedTask, TaskType } from '../../active-operator/types.js';
import { audit } from '../../audit.js';
import { loadScratchpad } from '../../active-operator/state-persister.js';
import {
  logLizardBrainCycle,
  createLogEntryFromCycle,
} from '../../active-operator/lizard-brain-logger.js';
import {
  createProposal,
  getApprovalRequirement,
  markProposalExecuted,
  hasPendingProposalForTask,
  type ProposalTaskType,
} from '../../active-operator/operator-proposals.js';
import { loadOperatorConfig } from '../../config.js';
import { escalateToBigBrother, type EscalationRequest } from '../../big-brother.js';
import {
  generateTaskSpecification,
  validateOutputWithWorkIndicators,
  type TaskSpecification,
} from '../../active-operator/big-brother-tasks.js';
import { appendReasoningToBuffer } from '../../conversation-buffer.js';

/**
 * Convert a task to a Big Brother escalation request using detailed task specifications.
 * This creates a comprehensive prompt that tells Big Brother exactly what to do,
 * what files to read/write, and what success looks like.
 */
function createEscalationFromTask(
  task: string,
  reasoning: string,
  username: string,
  preferredBackend?: string
): { request: EscalationRequest; spec: TaskSpecification | null } {
  const scratchpad = loadScratchpad();

  // Generate detailed task specification
  const taskSpec = generateTaskSpecification(task, username, { reasoning });

  // Create scratchpad entries for context
  const scratchpadEntries = [
    {
      type: 'thought' as const,
      content: `Need to execute ${task} task. Reasoning: ${reasoning}`,
      timestamp: new Date().toISOString(),
      step: 1,
      thought: reasoning,
    }
  ];

  // Add recent scratchpad context for better decision making
  if (scratchpad.entries.length > 0) {
    const recentEntries = scratchpad.entries.slice(-5);
    recentEntries.forEach((entry, index) => {
      scratchpadEntries.push({
        type: entry.type as any,
        content: entry.content || 'No content',
        timestamp: entry.timestamp,
        step: index + 2,
        thought: entry.content || 'Recent activity'
      });
    });
  }

  // Use the detailed prompt from task specification if available
  const goal = taskSpec?.prompt || `Execute ${task.replace(/_/g, ' ')} task for user ${username}. Reasoning: ${reasoning}`;

  const request: EscalationRequest = {
    goal,
    stuckReason: `Task delegation - ${task} requested for execution via Big Brother`,
    errorType: null,
    scratchpad: scratchpadEntries,
    context: {
      taskType: task,
      username,
      cycleNumber: scratchpad.cycleNumber,
      delegateAll: true,
      relevantPaths: taskSpec?.relevantPaths || [],
      isWriteOperation: taskSpec?.isWriteOperation ?? true,
    },
    preferredBackend,
    suggestions: taskSpec ? [
      `Read the relevant files: ${taskSpec.relevantPaths.slice(0, 3).join(', ')}`,
      'Execute the task as described in the instructions',
      'Report what files were read and modified',
      'Confirm the expected state changes occurred',
    ] : [
      `Execute the ${task} task as requested`,
      'Provide detailed feedback on the execution',
      'Report what files were read or modified',
    ],
  };

  return { request, spec: taskSpec };
}

/**
 * Generate a human-readable description for a task proposal.
 * This helps users understand what they're approving.
 */
function generateTaskDescription(task: string, reasoning: string): string {
  // Task-specific descriptions with context extraction
  const descriptions: Record<string, () => string> = {
    desire_execute: () => {
      // Extract the approved desire name from reasoning
      // Look for: 🚀 "Desire Name" (XX%, approved)
      const approvedMatch = reasoning.match(/🚀\s*"([^"]+)"\s*\([^)]*approved\)/i);
      if (approvedMatch) {
        return `Execute approved desire: "${approvedMatch[1]}"`;
      }
      // Fallback: look for any approved desire mention
      const fallbackMatch = reasoning.match(/approved desire[^"]*"([^"]+)"/i);
      if (fallbackMatch) {
        return `Execute approved desire: "${fallbackMatch[1]}"`;
      }
      return 'Execute an approved desire from the agency system';
    },

    reflect: () => {
      const hourMatch = reasoning.match(/(\d+(?:\.\d+)?)\s*hours?\s*since.*reflect/i);
      if (hourMatch) {
        return `Generate a reflection (${hourMatch[1]}h since last)`;
      }
      return 'Generate a thoughtful reflection on recent experiences';
    },

    dream: () => {
      const hourMatch = reasoning.match(/(\d+(?:\.\d+)?)\s*hours?\s*since.*dream/i);
      if (hourMatch) {
        return `Create a dream sequence (${hourMatch[1]}h since last)`;
      }
      return 'Create a surreal dream from memory fragments';
    },

    curiosity: () => {
      return 'Ask you an exploratory question based on memories';
    },

    inner_curiosity: () => {
      return 'Explore an internal question and generate insights';
    },

    memory_curate: () => {
      const countMatch = reasoning.match(/(\d+)\s*unprocessed/i);
      if (countMatch) {
        return `Tag and organize ${countMatch[1]} unprocessed memories`;
      }
      return 'Tag and organize unprocessed memories';
    },

    training_curate: () => {
      return 'Prepare conversation data for personality training';
    },

    desire_generate: () => {
      return 'Generate new desires from system insights';
    },

    psychoanalyze: () => {
      return 'Perform deep self-analysis of patterns and behaviors';
    },
  };

  // Try to get specific description, or fall back to generic
  const generator = descriptions[task];
  if (generator) {
    return generator();
  }

  // Generic fallback with cleaned task name
  const cleanName = task.replace(/_/g, ' ');
  return `Run ${cleanName} process`;
}

const execute: NodeExecutor = async (inputs, context) => {
  const username = context.userId || context.username || 'anonymous';
  const task = inputs.task;
  const reasoning = inputs.reasoning || 'No reasoning provided';

  // Get cycle number from scratchpad for logging
  const scratchpad = loadScratchpad();
  const cycleNumber = scratchpad.cycleNumber;

  // Check if Human-in-the-Loop is enabled and load operator config
  let hitlEnabled = false;
  let operatorConfig: any;
  try {
    operatorConfig = loadOperatorConfig(username);
    hitlEnabled = operatorConfig.humanInTheLoop?.enabled ?? false;
  } catch {
    // Config not found, HITL disabled
    operatorConfig = null;
  }

  // Check if Big Brother delegateAll mode is enabled
  const delegateAllEnabled = operatorConfig?.bigBrotherMode?.enabled && operatorConfig?.bigBrotherMode?.delegateAll;

  if (delegateAllEnabled && username !== 'anonymous') {
    console.log(`[TaskExecution] Big Brother delegateAll mode enabled - routing ${task} to Big Brother`);

    const startTime = Date.now();
    try {
      // Create escalation request with detailed task specification
      const rawProvider = operatorConfig.bigBrotherMode?.provider;
      const preferredBackend = rawProvider === 'ollama' || rawProvider === 'openai'
        ? 'open-interpreter'
        : rawProvider;

      const { request: escalationRequest, spec: taskSpec } = createEscalationFromTask(
        task, reasoning, username, preferredBackend
      );

      console.log(`[TaskExecution] Generated task specification for ${task}:`, {
        hasSpec: !!taskSpec,
        relevantPaths: taskSpec?.relevantPaths?.slice(0, 2),
        isWriteOperation: taskSpec?.isWriteOperation,
      });

      // Set up streaming callbacks if emitEvent is available (for real-time UI display)
      const streamingCallbacks = context.emitEvent ? {
        onChunk: (chunk: string) => {
          context.emitEvent?.('big_brother_output', { chunk });
        },
        onWaitingForInput: (question: string) => {
          context.emitEvent?.('big_brother_waiting', { question });
        },
      } : undefined;

      if (streamingCallbacks) {
        console.log('[TaskExecution] Streaming callbacks configured for Big Brother UI display');
      }

      // Escalate to Big Brother with streaming
      const escalationResult = await escalateToBigBrother(escalationRequest, operatorConfig, streamingCallbacks);
      const durationMs = Date.now() - startTime;

      // Stream reasoning steps to UI buffer for visibility
      if (escalationResult.reasoningSteps && escalationResult.reasoningSteps.length > 0 && username) {
        const formattedReasoning = escalationResult.reasoningSteps
          .map(step => {
            const label = step.toolName ? `${step.type}(${step.toolName})` : step.type;
            return `🧠 ${label}: ${step.content}`;
          })
          .join('\n\n');

        await appendReasoningToBuffer(username, formattedReasoning, {
          dialogueSource: `big-brother-${escalationResult.backend || 'unknown'}`,
          displayColor: '#f97316', // Orange for Big Brother
          task,
        });
        console.log(`[TaskExecution] Streamed ${escalationResult.reasoningSteps.length} reasoning steps to buffer`);
      }

      // =========================================================================
      // CRITICAL: Validate Big Brother output to detect placeholder/no-op responses
      // =========================================================================
      let validationPassed = true;
      let validationError: string | undefined;

      if (escalationResult.success && taskSpec) {
        // Combine all output for validation
        const outputToValidate = [
          escalationResult.reasoning || '',
          ...(escalationResult.suggestions || []),
          escalationResult.alternativeApproach || '',
        ].join('\n');

        const validation = validateOutputWithWorkIndicators(
          outputToValidate,
          task,
          taskSpec.successCriteria
        );

        if (!validation.isValid) {
          validationPassed = false;
          validationError = validation.failureReason;

          console.error(`[TaskExecution] ❌ Big Brother output validation FAILED for ${task}:`);
          console.error(`[TaskExecution]   Reason: ${validation.failureReason}`);
          console.error(`[TaskExecution]   Is placeholder: ${validation.isPlaceholder}`);
          console.error(`[TaskExecution]   Output length: ${validation.details.outputLength}`);

          if (validation.isPlaceholder) {
            console.error(`[TaskExecution]   Matched placeholder pattern: ${validation.details.matchedPlaceholderPattern}`);
          }

          audit({
            category: 'action',
            level: 'warn',
            event: 'big_brother_output_validation_failed',
            actor: 'active-operator',
            details: {
              task,
              reasoning,
              backend: escalationResult.backend,
              validationError: validation.failureReason,
              isPlaceholder: validation.isPlaceholder,
              outputLength: validation.details.outputLength,
              hasRequiredKeywords: validation.details.hasRequiredKeywords,
            },
          });
        } else {
          console.log(`[TaskExecution] ✅ Big Brother output validation PASSED for ${task}`);
        }
      }

      // Determine final success status
      const actualSuccess = escalationResult.success && validationPassed;

      audit({
        category: 'action',
        level: actualSuccess ? 'info' : 'warn',
        event: actualSuccess ? 'lizard_brain_task_delegated' : 'lizard_brain_task_delegation_invalid',
        actor: 'active-operator',
        details: {
          task,
          reasoning,
          success: actualSuccess,
          rawSuccess: escalationResult.success,
          validationPassed,
          validationError,
          backend: escalationResult.backend,
          durationMs,
          delegateAll: true,
        },
      });

      // Log to Lizard Brain activity log
      try {
        const logEntry = createLogEntryFromCycle(
          username,
          cycleNumber,
          { task: task as TaskType, reasoning },
          { evaluated: 0, fired: [task] },
          { queueLength: 0 },
          scratchpad.entries.length
        );
        logEntry.execution = {
          success: actualSuccess,
          durationMs,
          error: validationError || escalationResult.error,
          outputs: escalationResult.suggestions,
        };
        await logLizardBrainCycle(logEntry, username);
      } catch (logError) {
        console.warn('[TaskExecution] Failed to log delegation cycle:', logError);
      }

      console.log(`[TaskExecution] Task ${task} delegated to Big Brother: success=${actualSuccess} (raw=${escalationResult.success}, validated=${validationPassed})`);

      // Emit completion event to close the terminal panel in UI
      if (context.emitEvent) {
        context.emitEvent('big_brother_complete', { success: actualSuccess });
      }

      return {
        executed: true,
        success: actualSuccess,
        result: {
          success: actualSuccess,
          data: escalationResult.suggestions,
          error: validationError || escalationResult.error,
          backend: escalationResult.backend,
          delegated: true,
          validationPassed,
          validationError,
        },
        durationMs,
        delegated: true,
      };

    } catch (error) {
      const durationMs = Date.now() - startTime;
      console.error(`[TaskExecution] Error delegating ${task} to Big Brother:`, error);

      audit({
        category: 'action',
        level: 'error',
        event: 'lizard_brain_task_delegation_failed',
        actor: 'active-operator',
        details: {
          task,
          reasoning,
          error: (error as Error).message,
          delegateAll: true,
        },
      });

      // Log delegation failure
      try {
        const logEntry = createLogEntryFromCycle(
          username,
          cycleNumber,
          { task: task as TaskType, reasoning },
          { evaluated: 0, fired: [task] },
          { queueLength: 0 },
          scratchpad.entries.length
        );
        logEntry.execution = {
          success: false,
          durationMs,
          error: (error as Error).message,
        };
        await logLizardBrainCycle(logEntry, username);
      } catch (logError) {
        console.warn('[TaskExecution] Failed to log delegation failure:', logError);
      }

      // Emit completion event even on error to close the terminal panel
      if (context.emitEvent) {
        context.emitEvent('big_brother_complete', { success: false, error: (error as Error).message });
      }

      return {
        executed: false,
        success: false,
        error: (error as Error).message,
        durationMs,
        delegated: true,
      };
    }
  }

  if (!task) {
    console.log('[TaskExecution] No task to execute');

    // Log even when no task (for completeness)
    if (username !== 'anonymous') {
      try {
        const logEntry = createLogEntryFromCycle(
          username,
          cycleNumber,
          { task: null, reasoning: reasoning || 'No task needed this cycle' },
          { evaluated: 0, fired: [] },
          { queueLength: 0 },
          scratchpad.entries.length
        );
        await logLizardBrainCycle(logEntry, username);
      } catch (logError) {
        console.warn('[TaskExecution] Failed to log cycle:', logError);
      }
    }

    return {
      executed: false,
      reason: 'No task provided',
    };
  }

  // =========================================================================
  // Human-in-the-Loop Check
  // =========================================================================
  if (hitlEnabled && username !== 'anonymous') {
    const approvalRequirement = getApprovalRequirement(username, task as ProposalTaskType);

    if (approvalRequirement === 'observe_only') {
      // Just log the intent, don't execute
      console.log(`[TaskExecution] HITL: observe_only - logging intent for ${task}`);

      audit({
        category: 'system',
        level: 'info',
        event: 'lizard_brain_task_observed',
        actor: 'active-operator',
        details: { task, reasoning, mode: 'observe_only' },
      });

      return {
        executed: false,
        reason: 'Observe-only mode - task intent logged but not executed',
        observeOnly: true,
      };
    }

    if (approvalRequirement === 'require_approval') {
      // Check if there's already a pending proposal for this task type
      if (hasPendingProposalForTask(username, task as ProposalTaskType)) {
        console.log(`[TaskExecution] HITL: Proposal already pending for ${task}, skipping duplicate`);
        return {
          executed: false,
          reason: `Already awaiting approval for ${task.replace(/_/g, ' ')}`,
          alreadyPending: true,
        };
      }

      // Create a proposal and wait for user approval
      console.log(`[TaskExecution] HITL: Creating proposal for ${task}`);

      const proposal = createProposal(
        username,
        task as ProposalTaskType,
        generateTaskDescription(task, reasoning),
        reasoning,
        {
          cycleNumber,
          triggerSource: 'lizard_brain',
          systemState: {
            scratchpadEntries: scratchpad.entries.length,
          },
        }
      );

      // Note: Proposal approval UI is shown in the LizardBrainCard via API fetch
      // No separate buffer message needed - avoids duplicating the decision info

      audit({
        category: 'system',
        level: 'info',
        event: 'lizard_brain_task_proposed',
        actor: 'active-operator',
        details: {
          task,
          reasoning,
          proposalId: proposal.id,
          mode: 'require_approval',
        },
      });

      // Log the proposal to Lizard Brain log
      try {
        const logEntry = createLogEntryFromCycle(
          username,
          cycleNumber,
          { task: task as TaskType, reasoning },
          { evaluated: 0, fired: [] },
          { queueLength: 0 },
          scratchpad.entries.length
        );
        logEntry.execution = {
          success: false, // Not executed yet
          durationMs: 0,
          error: `Awaiting user approval (proposal: ${proposal.id})`,
        };
        await logLizardBrainCycle(logEntry, username);
      } catch (logError) {
        console.warn('[TaskExecution] Failed to log cycle:', logError);
      }

      return {
        executed: false,
        proposalCreated: true,
        proposalId: proposal.id,
        reason: 'Awaiting user approval',
      };
    }

    // auto_approve - fall through to execute, but we'll track for post-feedback
    console.log(`[TaskExecution] HITL: auto_approve - executing ${task} with feedback tracking`);
  }

  console.log(`[TaskExecution] Executing task: ${task}`);
  const startTime = Date.now();

  // Track proposal ID if we're in auto-approve mode for post-feedback
  let autoProposalId: string | undefined;
  if (hitlEnabled && username !== 'anonymous') {
    // Create a proposal and immediately mark it as approved for tracking
    const proposal = createProposal(
      username,
      task as ProposalTaskType,
      generateTaskDescription(task, reasoning),
      reasoning,
      {
        cycleNumber,
        triggerSource: 'lizard_brain',
        systemState: { autoApproved: true },
      }
    );
    autoProposalId = proposal.id;
  }

  try {
    // Create a queued task object for the executor
    // The payload uses 'type' as the discriminant with reasoning as metadata
    const queuedTask: QueuedTask = {
      id: `graph-${Date.now()}`,
      type: task as TaskType,
      priority: 'normal',
      queuedAt: new Date().toISOString(),
      payload: { type: task, _reasoning: reasoning } as any,
      username,
    };

    // Execute the task
    const result = await executeTask(queuedTask);
    const durationMs = Date.now() - startTime;

    audit({
      category: 'action',
      level: 'info',
      event: 'lizard_brain_task_executed',
      actor: 'active-operator',
      details: {
        task,
        reasoning,
        success: result.success,
        durationMs: result.durationMs || durationMs,
      },
    });

    // Log to Lizard Brain activity log
    if (username !== 'anonymous') {
      try {
        const logEntry = createLogEntryFromCycle(
          username,
          cycleNumber,
          { task: task as TaskType, reasoning },
          { evaluated: 0, fired: [task] }, // Task itself is the "fired trigger"
          { queueLength: 0 },
          scratchpad.entries.length
        );
        // Add execution result
        logEntry.execution = {
          success: result.success,
          durationMs: result.durationMs || durationMs,
          error: result.error,
          outputs: result.data,
        };
        await logLizardBrainCycle(logEntry, username);
      } catch (logError) {
        console.warn('[TaskExecution] Failed to log cycle:', logError);
      }
    }

    console.log(`[TaskExecution] Task ${task} completed: success=${result.success}`);

    // Mark proposal as executed (for post-execution feedback)
    if (autoProposalId) {
      markProposalExecuted(username, autoProposalId, {
        success: result.success,
        summary: result.data ? JSON.stringify(result.data).slice(0, 100) : undefined,
        error: result.error,
      });
    }

    return {
      executed: true,
      success: result.success,
      result,
      durationMs: result.durationMs || durationMs,
      proposalId: autoProposalId, // For post-feedback tracking
    };

  } catch (error) {
    const durationMs = Date.now() - startTime;
    console.error(`[TaskExecution] Error executing ${task}:`, error);

    audit({
      category: 'action',
      level: 'error',
      event: 'lizard_brain_task_failed',
      actor: 'active-operator',
      details: {
        task,
        reasoning,
        error: (error as Error).message,
      },
    });

    // Log failure to Lizard Brain activity log
    if (username !== 'anonymous') {
      try {
        const logEntry = createLogEntryFromCycle(
          username,
          cycleNumber,
          { task: task as TaskType, reasoning },
          { evaluated: 0, fired: [task] },
          { queueLength: 0 },
          scratchpad.entries.length
        );
        logEntry.execution = {
          success: false,
          durationMs,
          error: (error as Error).message,
        };
        await logLizardBrainCycle(logEntry, username);
      } catch (logError) {
        console.warn('[TaskExecution] Failed to log cycle:', logError);
      }
    }

    // Mark proposal as executed with error (for post-execution feedback)
    if (autoProposalId) {
      markProposalExecuted(username, autoProposalId, {
        success: false,
        error: (error as Error).message,
      });
    }

    return {
      executed: false,
      success: false,
      error: (error as Error).message,
      durationMs,
      proposalId: autoProposalId, // For post-feedback tracking
    };
  }
};

export const TaskExecutionNode: NodeDefinition = defineNode({
  id: 'task_execution',
  name: 'Task Execution',
  category: 'active-operator',
  inputs: [
    { name: 'task', type: 'string', description: 'Task type to execute' },
    { name: 'reasoning', type: 'string', description: 'Decision reasoning for audit' },
  ],
  outputs: [
    { name: 'executed', type: 'boolean', description: 'Whether task was executed' },
    { name: 'success', type: 'boolean', description: 'Whether execution succeeded' },
    { name: 'result', type: 'object', description: 'Execution result' },
  ],
  properties: {},
  description: 'Executes the chosen task via the task executor',
  execute,
});
