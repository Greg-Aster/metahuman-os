/**
 * Desire Executor Node
 *
 * Executes finite approved steps. Robot work uses the existing child graph and
 * correlated receipts; digital work uses the configured escalation owner.
 *
 * Inputs:
 *   - desire: Desire object with approved plan
 *
 * Authenticated account and profile identity arrive through graph context.
 *
 * Outputs:
 *   - execution: DesireExecution object with step results
 *   - success: boolean
 *   - error?: string
 */

import { assertDesireExecutable } from '../../agency/desire-execution-service.js'
import { defineNode, type NodeDefinition } from '../types.js';
import type { Desire, DesireExecution, DesirePlan, PlanStep } from '../../agency/types.js';
import { initializeStageIterations } from '../../agency/types.js';
import type { DesireProgressCallback } from '../../agency/executor.js';
import {
  saveExecutionToFolder,
  saveDesireManifest,
  loadDesire,
} from '../../agency/storage.js';
import {
  escalate,
  getActiveBackend,
  getBackend,
  ensureBackendsInitialized,
} from '../../escalation-backend.js';
import { loadFreshOperatorConfig } from '../../config.js';
import { loadConfig as loadAgencyConfig } from '../../agency/config.js';
import type { AgencyExecutionConfig } from '../../agency/types.js';
import { renderPromptTemplate } from '../prompt-template.js';

// Default timeout: 10 minutes
const DEFAULT_EXECUTION_TIMEOUT = 600000;

const DEFAULT_TASK_PROMPT_TEMPLATE = `You are executing a task for MetaHuman OS Agency system.

## Desire Context
**Title**: {{title}}
**Description**: {{description}}
**Reason**: {{reason}}

## Current Step ({{stepOrder}} of {{stepCount}})
**Action**: {{action}}
**Expected Outcome**: {{expectedOutcome}}
**Risk Level**: {{risk}}
{{skillSection}}{{inputsSection}}

## Instructions
1. Execute this step to completion
2. Be thorough and verify your work
3. Report what you accomplished

Please execute this step now.`;

/**
 * Build a task prompt for execution
 */
function buildTaskPrompt(step: PlanStep, desire: Desire, taskPromptTemplate = DEFAULT_TASK_PROMPT_TEMPLATE): string {
  return renderPromptTemplate(taskPromptTemplate, {
    title: desire.title,
    description: desire.description,
    reason: desire.reason || 'Not specified',
    stepOrder: step.order,
    stepCount: desire.plan?.steps?.length || '?',
    action: step.action,
    expectedOutcome: step.expectedOutcome,
    risk: step.risk,
    skill: step.skill || '',
    skillSection: step.skill ? `**Suggested Approach**: ${step.skill}\n` : '',
    inputs: step.inputs || null,
    inputsSection: step.inputs ? `**Inputs**: ${JSON.stringify(step.inputs, null, 2)}\n` : '',
    desire,
    step,
  });
}

/**
 * Load the canonical agency execution config.
 */
async function getAgencyExecutionConfig(username?: string): Promise<AgencyExecutionConfig> {
  const agencyConfig = await loadAgencyConfig(username);
  if (!agencyConfig.execution) {
    throw new Error('Agency execution configuration is missing');
  }
  return agencyConfig.execution;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Desire execution cancelled', 'AbortError');
}

/**
 * Execute a step using the configured escalation backend
 * Uses the unified backend abstraction to route to the user's preferred backend
 */
async function executeStep(
  step: PlanStep,
  desire: Desire,
  username?: string,
  onProgress?: DesireProgressCallback,
  taskPromptTemplate?: string,
  signal?: AbortSignal,
  onAttemptStart?: () => Promise<void>,
): Promise<{ success: boolean; result?: unknown; error?: string; outcomeUnknown?: boolean }> {
  throwIfAborted(signal);
  const prompt = buildTaskPrompt(step, desire, taskPromptTemplate);

  // Ensure backends are loaded before checking
  await ensureBackendsInitialized();

  // Load agency execution config to get preferred backend
  const execConfig = await getAgencyExecutionConfig(username);
  const preferredBackendId = execConfig.preferredBackend;

  // Resolve one backend before execution begins. A configured fallback may replace
  // an unavailable primary, but an attempted external action is never replayed.
  let selectedBackendId = preferredBackendId;
  let backend = preferredBackendId ?
    getBackend(preferredBackendId) :
    getActiveBackend(username);

  if (!backend || !await backend.isAvailable()) {
    const primaryError = backend
      ? `Backend ${backend.name} is not available`
      : preferredBackendId
        ? `Configured backend '${preferredBackendId}' is not registered`
        : 'No execution backend is configured';
    const fallbackBackend = execConfig.fallbackBackend
      && execConfig.fallbackBackend !== preferredBackendId
      ? getBackend(execConfig.fallbackBackend)
      : undefined;
    if (!fallbackBackend || !await fallbackBackend.isAvailable()) {
      return {
        success: false,
        error: `${primaryError}; configured fallback backend is unavailable`,
      };
    }
    backend = fallbackBackend;
    selectedBackendId = fallbackBackend.id;
    console.log(`[desire-executor] ⚠️ ${primaryError}; using configured fallback ${fallbackBackend.name}`);
  }

  console.log(`[desire-executor] 🤖 Using ${backend.name}...`);
  console.log(`[desire-executor]    Action: ${step.action}`);
  console.log(`[desire-executor]    Expected: ${step.expectedOutcome}`);

  const workingMsg = `🤖 ${backend.name} is working on: ${step.action}`;

  // Emit working progress
  onProgress?.({
    type: 'claude_working',
    stepNumber: step.order,
    totalSteps: desire.plan?.steps?.length || 0,
    action: step.action,
    message: workingMsg,
    timestamp: Date.now(),
  });

  let attempted = false;
  try {
    // Get configurable timeout from operator config
    const timeout = username
      ? loadFreshOperatorConfig(username).bigBrotherMode?.executionTimeout || DEFAULT_EXECUTION_TIMEOUT
      : DEFAULT_EXECUTION_TIMEOUT;

    // Execute exactly once through the backend selected before the external action.
    const timeoutMins = Math.round(timeout / 60000);
    console.log(`[desire-executor] ⏳ Waiting for response (${timeoutMins} min timeout)...`);
    await onAttemptStart?.();
    attempted = true;
    const result = await escalate(prompt, {
      timeout,
      username,
      preferredBackend: selectedBackendId,
      signal,
    });
    throwIfAborted(signal);

    if (!result.success) {
      console.log(`[desire-executor] ❌ Execution failed: ${result.error}`);
      return {
        success: false,
        outcomeUnknown: true,
        error: result.error || 'Execution failed',
      };
    }

    return {
      success: true,
      result: {
        response: result.output,
        executedVia: backend.id,
        executionTime: result.executionTime,
        timestamp: new Date().toISOString(),
      },
    };
  } catch (error) {
    if ((error as Error).name === 'AbortError' || signal?.aborted) throw error;
    if (!attempted) throw error;
    console.log(`[desire-executor] ❌ Execution error: ${(error as Error).message}`);
    return {
      success: false,
      outcomeUnknown: true,
      error: `Execution failed: ${(error as Error).message}`,
    };
  }
}


/** Graph inputs identify an attempt; the persisted reviewed plan supplies its instructions. */
async function loadReviewedExecution(desire: Desire, username: string, executionId: string): Promise<Desire & { plan: DesirePlan; execution: DesireExecution }> {
  const current = await loadDesire(desire.id, username)
  if (!current?.plan || !current.execution || !['executing', 'awaiting_review'].includes(current.status)
    || current.plan.id !== desire.plan?.id || current.plan.version !== desire.plan?.version
    || current.execution.planId !== current.plan.id || current.execution.planVersion !== current.plan.version
    || current.execution.startedAt !== desire.execution?.startedAt
    || (current.execution.executionId && current.execution.executionId !== executionId)) {
    throw new Error('Desire plan or claimed execution changed')
  }
  const config = await loadAgencyConfig(username)
  assertDesireExecutable({ ...current, status: 'approved' }, config.mode === 'yolo')
  const cursor = desire.execution?.stepResults?.length ?? 0
  const recorded = current.execution.stepResults?.length ?? 0
  if (cursor > recorded || recorded > cursor + 1) throw new Error('Desire step cursor does not match its recorded receipts')
  return current as Desire & { plan: DesirePlan; execution: DesireExecution }
}

export const DesireStepPrepareNode = defineNode({
  id: 'desire_step_prepare', name: 'Prepare Approved Desire Step', category: 'agency',
  inputs: [{ name: 'desire', type: 'object', description: 'Claimed Desire attempt and saved graph step cursor' }],
  outputs: [
    { name: 'desire', type: 'object', description: 'Persisted reviewed plan bound to this execution' },
    { name: 'invocation', type: 'object', description: 'One native robot child invocation, or null when no robot action is needed' },
    { name: 'needsRobotAction', type: 'boolean', description: 'Whether this unrecorded step requires the native robot child graph' },
  ],
  properties: {},
  description: 'Binds one approved plan step to its durable execution before any action is dispatched.',
  async execute(inputs, context) {
    const desire = inputs.desire as Desire
    if (!context.graphExecution || !context.username) throw new Error('Desire steps require an authenticated durable execution')
    if (desire.status !== 'executing' || !desire.execution) throw new Error('Desire step requires a claimed execution')
    const current = await loadReviewedExecution(desire, context.username, context.graphExecution.executionId)
    const cursor = desire.execution.stepResults?.length ?? 0
    const execution = { ...current.execution, stepResults: (current.execution.stepResults ?? []).slice(0, cursor),
      executionId: context.graphExecution.executionId }
    if (execution.planId !== current.plan.id || execution.planVersion !== current.plan.version) {
      throw new Error('Desire execution does not match the approved plan version')
    }
    const step = current.plan.steps[execution.stepResults?.length ?? 0]
    if (!step) throw new Error('No unexecuted approved step remains')
    const prepared = { ...current, execution }
    if (step.executionTarget === 'operator' || current.execution.stepResults?.some(result => result.stepOrder === step.order)) {
      if (!current.execution.executionId) await saveDesireManifest({ ...current, execution }, context.username)
      return { desire: prepared, invocation: null, needsRobotAction: false }
    }
    const currentTask = context.graphExecution.task()
    if (currentTask && !currentTask.decision.objectiveComplete && currentTask.desireId !== desire.id) {
      throw new Error('A Desire step cannot replace an unrelated execution objective')
    }
    execution.currentStep = step.order
    await saveDesireManifest(prepared, context.username)
    context.graphExecution.recordTask({
      objectiveId: `${context.graphExecution.executionId}:${current.plan.id}:${step.order}`,
      executionId: context.graphExecution.executionId,
      desireId: desire.id, desirePlanId: current.plan.id, desirePlanVersion: current.plan.version, desireStepOrder: step.order,
      objective: step.action, instruction: step.action, completionCriteria: step.expectedOutcome,
      source: 'desire', decision: { outcome: 'incomplete', reason: 'Approved finite Desire plan step', objectiveComplete: false },
      selectedAction: null, actionId: '', actionStatus: '', feedback: null, baselineFrame: null,
      updatedAt: new Date().toISOString(),
    })
    return {
      desire: prepared, needsRobotAction: true,
      invocation: { graph: 'boredom-autonomy', context: {
        userMessage: '', cognitiveMode: 'agent',
        robotOperatorContext: { plannerDecision: {
          instruction: step.action, reason: `Satisfy approved plan step ${step.order}: ${step.expectedOutcome}`,
          observed: 'Agency admitted the reviewed plan; use current Bridge evidence before acting.',
        } },
      } },
    }
  },
})

export const DesireExecutorNode: NodeDefinition = defineNode({
  id: 'desire_executor', name: 'Record Desire Step', category: 'agency',
  inputs: [
    { name: 'desire', type: 'object', description: 'Reviewed attempt prepared for its next result' },
    { name: 'robotResult', type: 'boolean', optional: true, description: 'Native child completion; the execution task supplies the correlated evidence' },
  ],
  outputs: [
    { name: 'desire', type: 'object', description: 'Desire with the durably recorded step receipt' },
    { name: 'execution', type: 'object', description: 'Current attempt with ordered step results' },
    { name: 'success', type: 'boolean', description: 'Whether the current step returned its expected outcome' },
    { name: 'error', type: 'string', optional: true, description: 'Failed or uncertain step outcome' },
    { name: 'hasNext', type: 'boolean', description: 'Whether a successful result permits the next approved step' },
    { name: 'summary', type: 'string', description: 'Final attempt summary released for persistence before outcome review' },
  ],
  properties: { taskPromptTemplate: DEFAULT_TASK_PROMPT_TEMPLATE },
  propertySchemas: { taskPromptTemplate: { type: 'text_multiline', default: DEFAULT_TASK_PROMPT_TEMPLATE,
    label: 'Approved Step Instruction', description: 'Template supplied only to the configured digital execution backend', rows: 16 } },
  description: 'Executes one digital step or records one native robot result. Only the graph advances to the next approved step.',
  async execute(inputs, context, properties) {
    const username = context.username
    const runtime = context.graphExecution
    const input = inputs.desire as Desire
    if (!username || !runtime || !input?.plan || !input.execution) throw new Error('Desire step lacks its execution owner')
    const current = await loadReviewedExecution(input, username, runtime.executionId)
    const plan = current.plan
    const cursor = input.execution.stepResults?.length ?? 0
    const attempt = { ...current.execution, stepResults: (current.execution.stepResults ?? []).slice(0, cursor) }
    const desire = { ...current, execution: attempt }
    const step = plan.steps[cursor]
    if (!step) throw new Error('No approved step remains')
    // A successful manifest write may precede its graph checkpoint. Reuse that
    // receipt; never repeat an external effect to rebuild a lost acknowledgement.
    const retained = current.execution.stepResults?.find(result => result.stepOrder === step.order)
    let result: { success: boolean; result?: unknown; error?: string; outcomeUnknown?: boolean }
    if (retained) result = { ...retained, outcomeUnknown: current.execution.status === 'outcome_unknown' }
    else if (step.executionTarget === 'robot') {
      const task = runtime.task()
      if (inputs.robotResult !== true || task?.desireId !== desire.id || task.desirePlanId !== plan.id
        || task.desirePlanVersion !== plan.version || task.desireStepOrder !== step.order) {
        throw new Error('Robot result is not correlated to this approved Desire step')
      }
      const feedback = task.feedback
      const success = task.decision.objectiveComplete === true
        && Boolean(task.decision.completionEvidence?.trim())
        && Boolean(task.actionId && feedback?.actionId === task.actionId && feedback.type === 'completed')
      result = { success, result: { task, executionId: runtime.executionId },
        ...(!success ? { error: 'The finite robot step did not return evidence satisfying its approved outcome' } : {}) }
    } else {
      // Escalation backends have no replay receipt API. Once an attempt has begun,
      // recovery must expose uncertainty instead of invoking that effect twice.
      if (current.execution.currentStep === step.order && current.execution.executionId === runtime.executionId) {
        result = { success: false, outcomeUnknown: true, error: 'External step outcome is unknown after interruption; owner review is required' }
      } else {
        result = await executeStep(step, desire, username, context.onDesireProgress,
          properties?.taskPromptTemplate, context.abortSignal,
          () => saveDesireManifest({ ...current, execution: { ...attempt, currentStep: step.order } }, username))
      }
    }
    const now = retained?.completedAt ?? new Date().toISOString()
    const { outcomeUnknown, ...stepOutcome } = result
    const stepResults = [...(desire.execution.stepResults ?? []), retained ?? { stepOrder: step.order, ...stepOutcome, completedAt: now }]
    const hasNext = result.success && stepResults.length < plan.steps.length
    const execution: DesireExecution = {
      ...desire.execution, currentStep: step.order, stepResults,
      stepsCompleted: stepResults.filter(entry => entry.success).length,
      status: outcomeUnknown ? 'outcome_unknown' : hasNext ? 'in_progress' : result.success ? 'completed' : 'failed',
      ...(!hasNext ? { completedAt: now } : {}),
      ...(result.error ? { error: result.error } : {}),
    }
    const updated: Desire = {
      ...desire, execution, updatedAt: now,
      status: hasNext ? 'executing' : 'awaiting_review',
      currentStage: hasNext ? 'executing' : 'outcome_review',
      stageIterations: {
        ...(desire.stageIterations ?? initializeStageIterations()),
        executing: (desire.stageIterations?.executing ?? 0) + (hasNext || retained ? 0 : 1),
      },
      metrics: { ...desire.metrics,
        executionAttemptCount: desire.metrics.executionAttemptCount + (hasNext || retained ? 0 : 1),
        executionSuccessCount: desire.metrics.executionSuccessCount + (!hasNext && !retained && result.success ? 1 : 0),
        executionFailCount: desire.metrics.executionFailCount + (!retained && !result.success ? 1 : 0), lastActivityAt: now },
    }
    await saveDesireManifest(updated, username)
    if (!hasNext) {
      await saveExecutionToFolder(desire.id, execution, updated.metrics.executionAttemptCount, username)
      // Checkpointed admission also runs when a physical receipt resumes this graph
      // after its initial Coordinator worker has returned.
      const { buildDesireAgentTaskInput } = await import('../../queue/work-submission.js')
      runtime.dispatch({ kind: 'coordinator_work', payload: buildDesireAgentTaskInput({
        operation: 'review', username, desireId: desire.id, source: 'autonomy',
        idempotencyKey: `desire-outcome-review:${desire.id}:execution:${execution.startedAt}`,
        metadata: { producer: 'desire-execution-transition' },
      }) })
    }
    return { desire: updated, execution, success: result.success, error: result.error, hasNext,
      summary: hasNext ? '' : `Desire ${desire.id}: ${execution.stepsCompleted}/${plan.steps.length} steps returned successfully; outcome review must verify satisfaction.` }
  },
})
