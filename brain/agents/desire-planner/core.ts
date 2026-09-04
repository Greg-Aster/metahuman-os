/**
 * Desire Planner Agent — Core Logic
 *
 * Generates execution plans for desires using cognitive graph workflow:
 * - Loads desires in 'planning' status
 * - Executes planning graph (LLM-based plan generation)
 * - Executes review graph (alignment + safety review)
 * - Updates desires based on review outcome
 *
 * Uses: etc/cognitive-graphs/desire-planner.json
 *       etc/cognitive-graphs/desire-reviewer.json
 *
 * MULTI-USER: Processes only logged-in users (active sessions) with isolated contexts.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import {
  ROOT,
  audit,
  acquireLock,
  getTargetUser,
  getUserContext,
  withUserContext,
  runGraph,
  cognitiveGraphPath,
  loadGraphFile,
  requireGraphNodeOutput,
  getActiveBackend,
  loadConfig as loadAgencyConfig,
  type DesireFeasibilityResult,
  type SvelteFlowGraph,
  type GraphExecutionState,
  type Desire,
  type DesirePlan,
  type DesireReview,
  listDesiresByStatus,
  listPendingDesires,
  loadDesire,
  moveDesire,
  isAgencyEnabled,
  submitSystemEvent,
  submitInnerReflection,
} from '@metahuman/core';

const LOCK_NAME = 'desire-planner';
const LOG_PREFIX = '[AGENCY:planner]';
const CONFIG_PATH = path.join(ROOT, 'etc', 'desire-planner.json');

// ============================================================================
// Types
// ============================================================================

export interface PlannerConfig {
  enabled: boolean;
  graph: {
    planner: string;
    reviewer: string;
  };
  processing: {
    batchSize: number;
  };
  logging: {
    logToInnerDialogue: boolean;
  };
}

export interface DesirePlannerOptions {
  username?: string;
  desireId?: string;
  signal?: AbortSignal;
}

export interface DesirePlannerResult {
  success: boolean;
  usersProcessed: number;
  errors: string[];
  stats: {
    planned: number;
    approved: number;
    needsApproval: number;
    needsQuestions: number;
    rejected: number;
    failed: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGraphFilename(value: unknown): value is string {
  return typeof value === 'string'
    && value.endsWith('.json')
    && value.length > '.json'.length
    && path.basename(value) === value;
}

export function parsePlannerConfig(value: unknown): PlannerConfig {
  if (!isRecord(value)) {
    throw new Error('Desire Planner configuration must be a JSON object');
  }

  const graph = value.graph;
  const processing = value.processing;
  const logging = value.logging;

  if (typeof value.enabled !== 'boolean') {
    throw new Error('Desire Planner configuration requires boolean enabled');
  }
  if (!isRecord(graph) || !isGraphFilename(graph.planner) || !isGraphFilename(graph.reviewer)) {
    throw new Error('Desire Planner graph configuration requires local planner and reviewer JSON filenames');
  }
  if (!isRecord(processing)
    || !Number.isInteger(processing.batchSize) || (processing.batchSize as number) < 1) {
    throw new Error('Desire Planner processing configuration is invalid');
  }
  if (!isRecord(logging)
    || typeof logging.logToInnerDialogue !== 'boolean') {
    throw new Error('Desire Planner logging configuration is invalid');
  }

  return value as unknown as PlannerConfig;
}

// ============================================================================
// Config Loading
// ============================================================================

export async function loadPlannerConfig(): Promise<PlannerConfig> {
  const content = await fs.readFile(CONFIG_PATH, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Desire Planner configuration is not valid JSON: ${(error as Error).message}`);
  }
  return parsePlannerConfig(parsed);
}

// ============================================================================
// Graph Loading
// ============================================================================

export async function loadGraph(filename: string): Promise<SvelteFlowGraph> {
  const loaded = await loadGraphFile(cognitiveGraphPath(filename), {
    cacheKey: `desire-planner:${filename}`,
    logPrefix: LOG_PREFIX,
  });
  if (!loaded) throw new Error(`Desire Planner graph not found: ${filename}`);
  return loaded.graph;
}

export function buildDesirePlannerGraphContext(
  desire: Desire,
  username: string,
  signal?: AbortSignal,
  feasibilityCheckEnabled = true,
): Record<string, unknown> {
  const activeUser = getUserContext();
  if (!activeUser) throw new Error('Desire planning requires an authenticated user context');
  if (activeUser.username !== username && activeUser.activeProfile !== username) {
    throw new Error(`Desire planning context does not own profile ${username}`);
  }
  return {
    userId: activeUser.userId,
    username,
    desire,
    desireId: desire.id,
    allowMemoryWrites: true,
    recordPersonaMemory: true,
    cognitiveMode: 'agent' as const,
    feasibilityCheckEnabled,
    abortSignal: signal,
  };
}

export function buildDesireReviewGraphContext(
  desire: Desire,
  username: string,
  signal?: AbortSignal,
): Record<string, unknown> {
  const activeUser = getUserContext();
  if (!activeUser) throw new Error('Desire review requires an authenticated user context');
  if (activeUser.username !== username && activeUser.activeProfile !== username) {
    throw new Error(`Desire review context does not own profile ${username}`);
  }
  if (desire.status !== 'reviewing' || !desire.plan) {
    throw new Error(`Desire review requires a persisted reviewing plan for ${desire.id}`);
  }
  return {
    userId: activeUser.userId,
    username,
    desireId: desire.id,
    allowMemoryWrites: true,
    recordPersonaMemory: true,
    cognitiveMode: 'agent' as const,
    idempotencyKey: `desire-plan-review:${username}:${desire.id}:v${desire.plan.version}`,
    memoryTimestamp: desire.plan.createdAt,
    abortSignal: signal,
  };
}

export interface DesirePlanGraphReceipt {
  desire: Desire;
  plan: DesirePlan;
}

export type DesirePlanningAdmission =
  | { status: 'infeasible'; feasibility: DesireFeasibilityResult }
  | { status: 'questions'; desire: Desire; questions: NonNullable<Desire['clarifyingQuestions']>['questions']; reason: string }
  | { status: 'planned'; receipt: DesirePlanGraphReceipt }

function feasibilityFromOutput(value: unknown): DesireFeasibilityResult {
  if (!isRecord(value)
    || typeof value.feasible !== 'boolean'
    || typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)
    || value.confidence < 0 || value.confidence > 1
    || typeof value.reasoning !== 'string' || !value.reasoning.trim()
    || (value.suggestedApproach !== undefined && typeof value.suggestedApproach !== 'string')
    || (value.blockers !== undefined
      && (!Array.isArray(value.blockers) || value.blockers.some(blocker => typeof blocker !== 'string')))) {
    throw new Error('Desire feasibility node returned an invalid result')
  }
  return {
    feasible: value.feasible,
    confidence: value.confidence,
    reasoning: value.reasoning.trim(),
    ...(typeof value.suggestedApproach === 'string' && value.suggestedApproach.trim()
      ? { suggestedApproach: value.suggestedApproach.trim() }
      : {}),
    ...(Array.isArray(value.blockers) ? { blockers: value.blockers as string[] } : {}),
  }
}

export function evaluateDesirePlanningAdmission(result: GraphExecutionState): DesirePlanningAdmission {
  const feasibility = feasibilityFromOutput(
    requireGraphNodeOutput(result, 'desire_feasibility').result,
  )
  if (!feasibility.feasible) return { status: 'infeasible', feasibility }

  const questionResult = requireGraphNodeOutput(result, 'desire_question_generator')
  if (questionResult.needsQuestions === true) {
    const transition = requireGraphNodeOutput(result, 'desire_question_transition')
    const desire = transition.desire as Desire | undefined
    if (transition.success !== true || !desire?.clarifyingQuestions
      || desire.status !== 'questioning' || !Array.isArray(transition.questions)
      || transition.questions.length === 0) {
      throw new Error('Desire question graph did not persist generated questions')
    }
    return {
      status: 'questions',
      desire,
      questions: desire.clarifyingQuestions.questions,
      reason: typeof transition.reason === 'string' ? transition.reason : '',
    }
  }
  if (questionResult.needsQuestions !== false) {
    throw new Error('Desire question graph returned no typed decision')
  }
  return { status: 'planned', receipt: evaluateDesirePlanGraph(result) }
}

export function evaluateDesirePlanGraph(result: GraphExecutionState): DesirePlanGraphReceipt {
  const generator = requireGraphNodeOutput(result, 'desire_plan_generator');
  const validator = requireGraphNodeOutput(result, 'plan_validator');
  const persistence = requireGraphNodeOutput(result, 'desire_updater');
  const generatedPlan = generator.plan as DesirePlan | undefined;
  const validatedPlan = validator.plan as DesirePlan | undefined;
  const persistedDesire = persistence.desire as Desire | undefined;

  if (generator.success !== true || !generatedPlan) {
    throw new Error(`Plan generation failed: ${generator.error || 'no typed plan receipt'}`);
  }
  if (validator.valid !== true || !validatedPlan || validatedPlan.id !== generatedPlan.id) {
    const details = Array.isArray(validator.errors) ? validator.errors.join('; ') : 'no validated plan receipt';
    throw new Error(`Plan validation failed: ${details}`);
  }
  if (persistence.success !== true
    || !persistedDesire?.plan
    || persistedDesire.plan.id !== validatedPlan.id
    || persistedDesire.status !== 'reviewing') {
    throw new Error(`Plan persistence failed: ${persistence.error || 'durable reviewing state not confirmed'}`);
  }

  return { desire: persistedDesire, plan: validatedPlan };
}

export interface DesireReviewGraphReceipt {
  desire: Desire;
  review: DesireReview;
  action: 'rejected' | 'auto_approved' | 'awaiting_approval';
  reasoning: string;
}

export function evaluateDesireReviewGraph(result: GraphExecutionState): DesireReviewGraphReceipt {
  requireGraphNodeOutput(result, 'desire_verdict');
  const recorder = requireGraphNodeOutput(result, 'desire_plan_review_recorder');
  const buffer = requireGraphNodeOutput(result, 'inner_dialogue_buffer');
  const memory = requireGraphNodeOutput(result, 'inner_dialogue_saver');
  const transition = requireGraphNodeOutput(result, 'desire_plan_review_transition');
  const review = recorder.review as DesireReview | undefined;
  const reasoning = recorder.reasoning;
  const admittedCount = Number(buffer.savedCount);
  const savedCount = Number(memory.savedCount);
  const updatedDesire = transition.desire as Desire | undefined;
  const action = transition.action;

  if (!review
    || !['approve', 'reject', 'revise'].includes(review.verdict)
    || recorder.success !== true
    || recorder.persisted !== true
    || typeof recorder.autoApprove !== 'boolean'
    || typeof reasoning !== 'string'
    || !reasoning.trim()) {
    throw new Error('Plan reviewer did not produce a typed verdict');
  }
  if (buffer.saved !== true || buffer.persisted !== true
    || !Number.isInteger(admittedCount) || admittedCount < 1
    || buffer.text !== reasoning) {
    throw new Error(`Plan review inner-dialogue persistence failed: ${buffer.error || buffer.reason || 'not admitted'}`);
  }
  if (memory.success !== true || memory.saved !== true
    || !Number.isInteger(savedCount) || savedCount !== admittedCount) {
    throw new Error(`Plan review Persona Memory persistence failed: expected ${admittedCount}, received ${savedCount || 0}`);
  }
  if (transition.success !== true
    || !updatedDesire
    || updatedDesire.review?.id !== review.id
    || !['rejected', 'auto_approved', 'awaiting_approval'].includes(action)) {
    throw new Error(`Plan review transition failed: ${transition.error || 'durable transition not confirmed'}`);
  }

  const expectedStatus = action === 'rejected'
    ? 'rejected'
    : action === 'auto_approved' ? 'approved' : 'awaiting_approval';
  if (updatedDesire.status !== expectedStatus) {
    throw new Error(`Plan review transition reported ${action} but persisted '${updatedDesire.status}'`);
  }

  return {
    desire: updatedDesire,
    review,
    action: action as DesireReviewGraphReceipt['action'],
    reasoning: reasoning.trim(),
  };
}

type DesireProcessingResult = {
  success: boolean;
  outcome: 'planned' | 'approved' | 'needs_approval' | 'rejected' | 'failed' | 'needs_questions';
  error?: string;
  feasibilityResult?: DesireFeasibilityResult;
};

async function reviewPlannedDesire(
  desire: Desire,
  reviewerGraph: SvelteFlowGraph,
  username: string,
  signal?: AbortSignal,
): Promise<DesireProcessingResult> {
  const reviewContext = buildDesireReviewGraphContext(desire, username, signal);

  console.log(`${LOG_PREFIX}     Executing reviewer graph...`);
  const reviewResult = await runGraph({ graph: reviewerGraph, context: reviewContext, signal });

  if (reviewResult.status !== 'completed') {
    const error = `Reviewer graph ended with status: ${reviewResult.status}`;
    console.error(`${LOG_PREFIX}     ${error}`);
    return { success: false, outcome: 'failed', error };
  }

  const reviewReceipt = evaluateDesireReviewGraph(reviewResult);

  if (reviewReceipt.action === 'rejected') {
    console.log(`${LOG_PREFIX}     Plan rejected by review`);
    await submitSystemEvent(
      username,
      `❌ **Plan Rejected:** "${desire.title}"\n\n` +
      `**Reason:** ${reviewReceipt.reasoning}\n\n` +
      `_The plan was reviewed but did not pass alignment or safety checks. You can provide feedback to adjust the approach._`,
      {
        dialogueSource: 'agency-system',
        source: 'agency',
        displayColor: '#ef4444',
        type: 'plan_rejected',
        desireId: desire.id,
        desireTitle: desire.title,
      },
    );
    return { success: true, outcome: 'rejected' };
  }

  if (reviewReceipt.action === 'auto_approved') {
    console.log(`${LOG_PREFIX}     Plan auto-approved (high alignment + safety)`);
    return { success: true, outcome: 'approved' };
  }

  console.log(`${LOG_PREFIX}     Plan queued for manual approval`);
  return { success: true, outcome: 'needs_approval' };
}

// ============================================================================
// Desire Processing
// ============================================================================

/**
 * Process a single desire through planning and review graphs
 */
async function processDesire(
  desire: Desire,
  plannerGraph: SvelteFlowGraph,
  reviewerGraph: SvelteFlowGraph,
  username: string,
  signal?: AbortSignal,
): Promise<DesireProcessingResult> {
  console.log(`${LOG_PREFIX}   Planning: ${desire.title}`);

  try {
    const agencyConfig = await loadAgencyConfig(username);
    if (!agencyConfig.execution) {
      throw new Error('Agency configuration is missing the execution section');
    }
    const planContext = buildDesirePlannerGraphContext(
      desire,
      username,
      signal,
      agencyConfig.execution.feasibilityCheckEnabled,
    );

    console.log(`${LOG_PREFIX}     Executing planner graph...`);
    const planResult = await runGraph({ graph: plannerGraph, context: planContext, signal });

    if (planResult.status !== 'completed') {
      console.error(`${LOG_PREFIX}     Planner graph failed: ${planResult.status}`);
      return {
        success: false,
        outcome: 'failed',
        error: `Planner graph ended with status: ${planResult.status}`,
      };
    }

    const admission = evaluateDesirePlanningAdmission(planResult);
    if (admission.status === 'infeasible') {
      const feasibility = admission.feasibility;
      const rejectedAt = new Date().toISOString();
      await moveDesire({
        ...desire,
        status: 'rejected',
        completedAt: rejectedAt,
        updatedAt: rejectedAt,
        rejectionHistory: [
          ...(desire.rejectionHistory || []),
          { rejectedAt, rejectedBy: 'system', reason: feasibility.reasoning, canRetry: true },
        ],
      }, desire.status, 'rejected', username);
      await submitInnerReflection(
        username,
        `I assessed "${desire.title}" and determined it's not feasible: ${feasibility.reasoning}${feasibility.blockers?.length ? ` Blockers: ${feasibility.blockers.join(', ')}` : ''}`,
        {
          type: 'desire_feasibility_review',
          tags: ['agency', 'feasibility', 'rejected', 'inner'],
          source: 'desire-planner',
          desireId: desire.id,
          feasibility,
        },
      );
      await submitSystemEvent(
        username,
        `❌ **Desire Not Feasible:** "${desire.title}"\n\n**Reason:** ${feasibility.reasoning}\n\n${feasibility.blockers?.length ? `**Blockers:**\n${feasibility.blockers.map(blocker => `• ${blocker}`).join('\n')}\n\n` : ''}_You can provide feedback to clarify or adjust this desire, or create a new one._`,
        {
          dialogueSource: 'agency-system',
          source: 'agency',
          displayColor: '#ef4444',
          type: 'desire_rejected',
          desireId: desire.id,
          desireTitle: desire.title,
          feasibility,
        },
      );
      return {
        success: true,
        outcome: 'rejected',
        error: `Not feasible: ${feasibility.reasoning}`,
        feasibilityResult: feasibility,
      };
    }

    if (admission.status === 'questions') {
      const questionsList = admission.questions
        .map((question, index) => `${index + 1}. ${question.text}${question.required ? ' *' : ''}`)
        .join('\n');
      await submitSystemEvent(
        username,
        `I'm working on planning "${desire.title}" and would like to ask a few questions to make sure I understand what you're looking for:\n\n${questionsList}\n\n_Please answer these questions to help me create a better plan._`,
        {
          type: 'clarifying_questions',
          source: 'agency',
          desireId: desire.id,
          desireTitle: desire.title,
          questions: admission.questions.map(question => ({
            id: question.id,
            text: question.text,
            type: question.type,
            required: question.required,
          })),
        },
      );
      return { success: true, outcome: 'needs_questions' };
    }

    const planReceipt = admission.receipt;
    const plan = planReceipt.plan;

    console.log(`${LOG_PREFIX}     Plan generated: ${plan.steps?.length || 0} step(s)`);

    return await reviewPlannedDesire(planReceipt.desire, reviewerGraph, username, signal);

  } catch (error) {
    console.error(`${LOG_PREFIX}     Error:`, error);
    return {
      success: false,
      outcome: 'failed',
      error: (error as Error).message,
    };
  }
}

/**
 * Promote pending desires to planning status.
 *
 * Pending desires have crossed the activation threshold and are ready for plan generation.
 * This moves them to 'planning' status so they can be picked up by processPlanningDesires.
 */
export async function promotePendingDesires(
  username: string,
  maxToPromote: number = 3
): Promise<number> {
  if (!await isAgencyEnabled(username)) {
    return 0;
  }

  const pendingDesires = await listPendingDesires(username);
  console.log(`${LOG_PREFIX} Found ${pendingDesires.length} pending desires ready for planning`);

  if (pendingDesires.length === 0) {
    return 0;
  }

  // Sort by strength descending (strongest desires get planned first)
  pendingDesires.sort((a, b) => (b.strength || 0) - (a.strength || 0));

  // Promote up to maxToPromote desires
  const toPromote = pendingDesires.slice(0, maxToPromote);
  let promoted = 0;
  const errors: Error[] = [];

  for (const desire of toPromote) {
    const now = new Date().toISOString();
    const updatedDesire: Desire = {
      ...desire,
      status: 'planning',
      updatedAt: now,
    };

    try {
      await moveDesire(updatedDesire, 'pending', 'planning', username);
      promoted++;

      audit({
        category: 'agent',
        level: 'info',
        event: 'desire_promoted_to_planning',
        actor: 'desire-planner',
        details: {
          desireId: desire.id,
          title: desire.title,
          strength: desire.strength,
          reinforcements: desire.reinforcements,
          username,
        },
      });

      console.log(`${LOG_PREFIX} ⬆ Promoted "${desire.title}" to planning (strength: ${(desire.strength || 0).toFixed(2)})`);
    } catch (error) {
      const message = `${desire.id}: failed to promote to planning: ${(error as Error).message}`;
      errors.push(new Error(message, { cause: error }));
      console.error(`${LOG_PREFIX} ${message}`);
      audit({
        category: 'agent',
        level: 'error',
        event: 'desire_promotion_failed',
        actor: 'desire-planner',
        details: { desireId: desire.id, title: desire.title, error: message, username },
      });
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, `Failed to promote ${errors.length} desire(s) to planning`);
  }

  return promoted;
}

export function isReviewResumeCandidate(desire: Desire): boolean {
  return desire.status === 'reviewing' && Boolean(desire.plan);
}

/**
 * Process planning desires and resume any persisted review that has not yet
 * reached its lifecycle transition.
 */
export async function processPlanningDesires(
  username: string,
  plannerConfig: PlannerConfig,
  signal?: AbortSignal,
  desireId?: string,
): Promise<{
  planned: number;
  approved: number;
  needsApproval: number;
  needsQuestions: number;
  rejected: number;
  failed: number;
  errors: string[];
}> {
  if (!await isAgencyEnabled(username)) {
    console.log(`${LOG_PREFIX} Agency disabled for user ${username}`);
    return { planned: 0, approved: 0, needsApproval: 0, needsQuestions: 0, rejected: 0, failed: 0, errors: [] };
  }

  const candidateDesires = desireId
    ? [await loadDesire(desireId, username)].filter((desire): desire is Desire => desire !== null)
    : [
        ...await listDesiresByStatus('reviewing', username),
        ...await listDesiresByStatus('planning', username),
      ];
  if (desireId && candidateDesires.length === 0) {
    throw new Error(`Target desire not found: ${desireId}`);
  }
  if (desireId
    && candidateDesires[0].status !== 'planning'
    && !isReviewResumeCandidate(candidateDesires[0])) {
    throw new Error(
      `Target desire ${desireId} is in '${candidateDesires[0].status}' status, not planning or resumable review`,
    );
  }
  console.log(`${LOG_PREFIX} Found ${candidateDesires.length} planning or resumable-review desires`);

  if (candidateDesires.length === 0) {
    return { planned: 0, approved: 0, needsApproval: 0, needsQuestions: 0, rejected: 0, failed: 0, errors: [] };
  }

  // A resumed review does not load the planner graph or repeat feasibility and
  // plan generation work.
  const plannerGraph = candidateDesires.some(desire => desire.status === 'planning')
    ? await loadGraph(plannerConfig.graph.planner)
    : null;
  const reviewerGraph = await loadGraph(plannerConfig.graph.reviewer);

  let planned = 0;
  let approved = 0;
  let needsApproval = 0;
  let needsQuestions = 0;
  let rejected = 0;
  let failed = 0;
  const errors: string[] = [];

  // Process up to batchSize desires
  const batch = desireId
    ? candidateDesires
    : candidateDesires.slice(0, plannerConfig.processing.batchSize);

  for (const desire of batch) {
    if (signal?.aborted) throw signal.reason || new DOMException('Planning cancelled', 'AbortError');
    let result: DesireProcessingResult;
    if (isReviewResumeCandidate(desire)) {
      try {
        result = await reviewPlannedDesire(desire, reviewerGraph, username, signal);
      } catch (error) {
        result = { success: false, outcome: 'failed', error: (error as Error).message };
      }
    } else {
      if (!plannerGraph) throw new Error('Planner graph was not loaded for a planning desire');
      result = await processDesire(
        desire,
        plannerGraph,
        reviewerGraph,
        username,
        signal,
      );
    }

    switch (result.outcome) {
      case 'planned':
        planned++;
        break;
      case 'approved':
        approved++;
        break;
      case 'needs_approval':
        needsApproval++;
        break;
      case 'needs_questions':
        needsQuestions++;
        break;
      case 'rejected':
        rejected++;
        break;
      case 'failed':
        failed++;
        if (result.error) {
          errors.push(`${desire.id}: ${result.error}`);
          audit({
            category: 'agent',
            level: 'error',
            event: 'desire_planning_failed',
            actor: 'desire-planner',
            details: {
              desireId: desire.id,
              title: desire.title,
              error: result.error,
              username,
            },
          });
        }
        break;
    }
  }

  // Log summary to inner dialogue if enabled
  if (plannerConfig.logging.logToInnerDialogue && (planned + approved + needsApproval + needsQuestions + rejected + failed > 0)) {
    const parts: string[] = [];

    if (approved > 0) parts.push(`${approved} auto-approved`);
    if (needsApproval > 0) parts.push(`${needsApproval} queued for your approval`);
    if (needsQuestions > 0) parts.push(`${needsQuestions} awaiting your answers to clarifying questions`);
    if (rejected > 0) parts.push(`${rejected} rejected by self-review`);
    if (failed > 0) parts.push(`${failed} failed to plan`);

    await submitInnerReflection(
      username,
      `I reviewed ${batch.length} desire plan(s): ${parts.join(', ')}.`,
      {
        type: 'desire_plan_review',
        tags: ['agency', 'planning', 'review', 'inner'],
        source: 'desire-planner',
        planned,
        approved,
        needsApproval,
        rejected,
        failed,
      }
    );
  }

  return { planned, approved, needsApproval, needsQuestions, rejected, failed, errors };
}

// ============================================================================
// Agent Runtime Entry Points
// ============================================================================

export async function prepareTargetDesire(username: string, desireId: string): Promise<Desire> {
  const desire = await loadDesire(desireId, username);
  if (!desire) throw new Error(`Target desire not found: ${desireId}`);
  if (desire.status === 'planning' || isReviewResumeCandidate(desire)) return desire;
  if (desire.status === 'reviewing') {
    throw new Error(`Cannot resume review for desire ${desireId} without a persisted plan`);
  }

  const canPromotePending = desire.status === 'pending';
  const canRepairApprovedWithoutPlan = desire.status === 'approved' && !desire.plan;
  if (!canPromotePending && !canRepairApprovedWithoutPlan) {
    throw new Error(
      `Cannot generate a plan for desire ${desireId} in '${desire.status}' status; reset or revise it to planning first`,
    );
  }

  const now = new Date().toISOString();
  const planningDesire: Desire = {
    ...desire,
    status: 'planning',
    currentStage: 'planning',
    completedAt: undefined,
    updatedAt: now,
  };
  await moveDesire(planningDesire, desire.status, 'planning', username);
  return planningDesire;
}

function existingTargetResult(desire: Desire): Awaited<ReturnType<typeof processPlanningDesires>> | null {
  const result = {
    planned: 0,
    approved: 0,
    needsApproval: 0,
    needsQuestions: 0,
    rejected: 0,
    failed: 0,
    errors: [] as string[],
  };
  if (desire.status === 'questioning' && desire.clarifyingQuestions) {
    result.needsQuestions = 1;
    return result;
  }
  if (desire.status === 'approved' && desire.plan && desire.review) {
    result.approved = 1;
    return result;
  }
  if (desire.status === 'awaiting_approval' && desire.plan && desire.review) {
    result.needsApproval = 1;
    return result;
  }
  if (desire.status === 'rejected'
    && (desire.review || (desire.rejectionHistory?.length ?? 0) > 0)) {
    result.rejected = 1;
    return result;
  }
  return null;
}

/**
 * Run a single planning cycle - entry point for CLI and Trigger Manager
 */
export async function runCycle(options: DesirePlannerOptions = {}): Promise<DesirePlannerResult> {
  const result: DesirePlannerResult = {
    success: true,
    usersProcessed: 0,
    errors: [],
    stats: { planned: 0, approved: 0, needsApproval: 0, needsQuestions: 0, rejected: 0, failed: 0 },
  };

  try {
    const config = await loadPlannerConfig();
    if (!config.enabled) {
      console.log(`${LOG_PREFIX} Disabled in config`);
      return result;
    }

    try {
      console.log(`${LOG_PREFIX} Using LLM backend: ${getActiveBackend()}`);
    } catch {
      console.log(`${LOG_PREFIX} Using model router (backend auto-selected)`);
    }

    // Resolve only a real active or explicitly selected profile.
    const user = getTargetUser({ username: options.username });

    if (!user) {
      result.success = false;
      result.errors.push('Desire planning requires an active or explicit profile');
      return result;
    }

    console.log(`${LOG_PREFIX} Processing user: ${user.username}`);

    const lock = acquireLock(`${LOCK_NAME}:${user.username}`, { exitOnSignal: false });
    try {
      console.log(`${LOG_PREFIX} --- Processing user: ${user.username} ---`);
      await withUserContext(user, async () => {
        if (!await isAgencyEnabled(user!.username)) {
          throw new Error(`Agency is disabled for profile ${user!.username}`);
        }
        let r: Awaited<ReturnType<typeof processPlanningDesires>>;
        if (options.desireId) {
          const existing = await loadDesire(options.desireId, user!.username);
          if (!existing) throw new Error(`Target desire not found: ${options.desireId}`);
          const completed = existingTargetResult(existing);
          if (completed) {
            r = completed;
          } else {
            await prepareTargetDesire(user!.username, options.desireId);
            r = await processPlanningDesires(
              user!.username,
              config,
              options.signal,
              options.desireId,
            );
          }
        } else {
          const promoted = await promotePendingDesires(user!.username, config.processing.batchSize);
          if (promoted > 0) {
            console.log(`${LOG_PREFIX} Promoted ${promoted} pending desire(s) to planning`);
          }
          r = await processPlanningDesires(user!.username, config, options.signal);
        }
        result.stats.planned += r.planned;
        result.stats.approved += r.approved;
        result.stats.needsApproval += r.needsApproval;
        result.stats.needsQuestions += r.needsQuestions;
        result.stats.rejected += r.rejected;
        result.stats.failed += r.failed;
        if (r.errors.length > 0) {
          result.success = false;
          result.errors.push(...r.errors);
        }
      });
      result.usersProcessed++;
    } catch (error) {
      result.success = false;
      result.errors.push(`Error processing ${user.username}: ${(error as Error).message}`);
    } finally {
      lock.release();
    }

    console.log(`${LOG_PREFIX} Planning complete:`);
    console.log(`${LOG_PREFIX}   Planned: ${result.stats.planned}`);
    console.log(`${LOG_PREFIX}   Auto-approved: ${result.stats.approved}`);
    console.log(`${LOG_PREFIX}   Needs approval: ${result.stats.needsApproval}`);
    console.log(`${LOG_PREFIX}   Needs questions: ${result.stats.needsQuestions}`);
    console.log(`${LOG_PREFIX}   Rejected: ${result.stats.rejected}`);
    console.log(`${LOG_PREFIX}   Failed: ${result.stats.failed}`);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_planner_completed',
      actor: 'desire-planner',
      details: { ...result.stats, usersProcessed: result.usersProcessed },
    });

    return result;
  } catch (error) {
    result.success = false;
    result.errors.push((error as Error).message);
    return result;
  }
}

/**
 * Agent runtime entry point - used by mobile and Trigger Manager
 */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  const parsed = parseDesirePlannerArgs(args);
  const options: DesirePlannerOptions = {
    username: typeof opts.username === 'string' ? opts.username : parsed.username || ctx.username,
    desireId: typeof opts.desireId === 'string' ? opts.desireId : parsed.desireId,
    signal: ctx.signal,
  };

  const result = await runCycle(options);

  return {
    success: result.success,
    data: result.stats,
    errors: result.errors.length > 0 ? result.errors : undefined,
    durationMs: Date.now() - startTime,
  };
}

export function parseDesirePlannerArgs(args: string[]): DesirePlannerOptions {
  const result: DesirePlannerOptions = {};
  const supported = new Set(['--username', '--desire-id']);
  for (let index = 0; index < args.length; index += 2) {
    const argument = args[index];
    const value = args[index + 1]?.trim();
    if (!supported.has(argument)) throw new Error(`Unknown Desire Planner argument: ${argument}`);
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    if (argument === '--username') {
      if (result.username) throw new Error('Desire Planner received duplicate --username');
      result.username = value;
    } else {
      if (result.desireId) throw new Error('Desire Planner received duplicate --desire-id');
      result.desireId = value;
    }
  }
  return result;
}
