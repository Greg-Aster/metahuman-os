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
  withUserContext,
  runGraph,
  cognitiveGraphPath,
  getCachedCatalog,
  loadGraphFile,
  requireGraphNodeOutput,
  getActiveBackend,
  callLLMText,
  loadConfig as loadAgencyConfig,
  type SvelteFlowGraph,
  type Desire,
  listDesiresByStatus,
  listPendingDesires,
  moveDesire,
  saveDesire,
  saveDesireManifest,
  isAgencyEnabled,
  submitSystemEvent,
  submitInnerReflection,
} from '@metahuman/core';
import {
  needsClarifyingQuestions,
  generateQuestions,
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
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
// Feasibility Check
// ============================================================================

export interface FeasibilityResult {
  feasible: boolean;
  confidence: number; // 0-1
  reasoning: string;
  suggestedApproach?: string;
  blockers?: string[];
}

export function parseFeasibilityResponse(response: string): FeasibilityResult {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Feasibility response did not contain a JSON object');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (error) {
    throw new Error(`Feasibility response was not valid JSON: ${(error as Error).message}`);
  }

  if (!isRecord(parsed)
    || typeof parsed.feasible !== 'boolean'
    || !isFiniteNumber(parsed.confidence) || parsed.confidence < 0 || parsed.confidence > 1
    || typeof parsed.reasoning !== 'string' || parsed.reasoning.trim().length === 0) {
    throw new Error('Feasibility response is missing required typed fields');
  }

  if (parsed.suggestedApproach !== undefined && typeof parsed.suggestedApproach !== 'string') {
    throw new Error('Feasibility response suggestedApproach must be a string');
  }
  if (parsed.blockers !== undefined
    && (!Array.isArray(parsed.blockers) || parsed.blockers.some(blocker => typeof blocker !== 'string'))) {
    throw new Error('Feasibility response blockers must be an array of strings');
  }

  return {
    feasible: parsed.feasible,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning.trim(),
    suggestedApproach: parsed.suggestedApproach?.trim(),
    blockers: parsed.blockers?.map(blocker => blocker.trim()),
  };
}

/**
 * Check if a desire is feasible before planning.
 * Uses LLM to assess whether the desire can be reasonably achieved
 * with available tools and constraints.
 */
async function checkFeasibility(
  desire: Desire,
  username: string,
  signal?: AbortSignal,
): Promise<FeasibilityResult> {
  if (signal?.aborted) throw signal.reason || new DOMException('Planning cancelled', 'AbortError');
  const toolCatalog = getCachedCatalog();
  // Build goal type context
  const isLongRunning = desire.goalType === 'long_running';
  const goalTypeContext = isLongRunning
    ? `
## IMPORTANT: Long-Running Goal Context
**Goal Type**: long_running
**Completion Criteria**: ${desire.completionCriteria || 'Not specified'}
**Milestones**: ${desire.milestones?.length || 0} defined

This is a LONG-RUNNING goal that may take weeks, months, or longer. The user will accomplish the goal themselves.
**The system's role is to SUPPORT the user, NOT to directly execute the goal.**

For long-running goals, feasibility means: "Can the system meaningfully help the user progress toward this goal?"
Support activities include:
- Research and information gathering
- Creating task lists and reminders
- Setting up calendar events for milestones
- Tracking progress and sending check-in questions
- Organizing relevant information
- Helping with logistics (bookings, permits, etc.)

Do NOT reject because the goal requires physical action by the user. If the system can help with planning/research/tracking, it's feasible.
`
    : '';

  const prompt = `You are assessing the feasibility of an autonomous agent's desire.

## Desire to Assess
**Title**: ${desire.title}
**Description**: ${desire.description}
**Reason**: ${desire.reason || 'Not specified'}
**Source**: ${desire.source}
**Goal Type**: ${desire.goalType || 'one_time'}
${goalTypeContext}
## Available Capabilities
The following canonical tool catalog is the complete capability inventory for this assessment.
Do not infer access, permissions, tools, or external effects that are not listed here.

${toolCatalog}

## Assessment Criteria
${isLongRunning ? `For this LONG-RUNNING goal, assess if the system can meaningfully SUPPORT the user:
1. **Supportable**: Can the system help with research, planning, tracking, or logistics?
2. **Progressive**: Can the system help track progress through milestones?
3. **Safe**: Are the support activities within acceptable boundaries?
4. **Clear**: Are the milestones and completion criteria clear enough to track?` : `1. **Achievable**: Can this be accomplished with available tools and capabilities?
2. **Time-bounded**: Can meaningful progress be made in a single execution session?
3. **Safe**: Does this not require actions outside acceptable boundaries?
4. **Clear**: Are the success criteria clear enough to verify completion?`}

## Instructions
${isLongRunning ? `Assess whether this long-running goal can be SUPPORTED by the system. Remember: the user will do the physical work; the system helps with planning, research, tracking, and logistics. If the system can meaningfully help, mark it as feasible.` : `Assess whether this desire is feasible. Consider:
- Is this something that can be done with computer-based tools?
- Does it require physical action that cannot be automated?
- Does it require access or permissions the system doesn't have?
- Is it too vague to create an actionable plan?`}

Respond in this JSON format:
{
  "feasible": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation of your assessment",
  "suggestedApproach": "If feasible, brief suggestion for how to approach it",
  "blockers": ["list of specific blockers if not feasible"]
}`;

  const response = await callLLMText({
    role: 'orchestrator',
    messages: [{ role: 'user', content: prompt }],
    userId: username,
  });

  return parseFeasibilityResponse(response);
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
): Promise<{
  success: boolean;
  outcome: 'planned' | 'approved' | 'needs_approval' | 'rejected' | 'failed' | 'needs_questions';
  error?: string;
  feasibilityResult?: FeasibilityResult;
}> {
  console.log(`${LOG_PREFIX}   Planning: ${desire.title}`);

  try {
    // =========================================================================
    // PHASE 0: Feasibility Check (if enabled)
    // =========================================================================
    const agencyConfig = await loadAgencyConfig(username);
    if (!agencyConfig.execution) {
      throw new Error('Agency configuration is missing the execution section');
    }

    if (agencyConfig.execution.feasibilityCheckEnabled) {
      console.log(`${LOG_PREFIX}     Running feasibility check...`);

      const feasibility = await checkFeasibility(desire, username, signal);

      audit({
        category: 'agent',
        level: 'info',
        event: 'desire_feasibility_check',
        actor: 'desire-planner',
        details: {
          desireId: desire.id,
          title: desire.title,
          feasible: feasibility.feasible,
          confidence: feasibility.confidence,
          reasoning: feasibility.reasoning,
          blockers: feasibility.blockers,
          username,
        },
      });

      if (!feasibility.feasible) {
        console.log(`${LOG_PREFIX}     ❌ Not feasible: ${feasibility.reasoning}`);
        if (feasibility.blockers?.length) {
          console.log(`${LOG_PREFIX}        Blockers: ${feasibility.blockers.join(', ')}`);
        }

        const rejectedAt = new Date().toISOString();
        const rejectedDesire: Desire = {
          ...desire,
          status: 'rejected',
          completedAt: rejectedAt,
          updatedAt: rejectedAt,
          rejectionHistory: [
            ...(desire.rejectionHistory || []),
            {
              rejectedAt,
              rejectedBy: 'system',
              reason: feasibility.reasoning,
              canRetry: true,
            },
          ],
        };
        await moveDesire(rejectedDesire, desire.status, 'rejected', username);

        // Log to inner dialogue so user can see why it was rejected
        await submitInnerReflection(
          username,
          `I assessed "${desire.title}" and determined it's not feasible: ${feasibility.reasoning}${feasibility.blockers?.length ? ` Blockers: ${feasibility.blockers.join(', ')}` : ''}`,
          {
            type: 'desire_feasibility_review',
            tags: ['agency', 'feasibility', 'rejected', 'inner'],
            source: 'desire-planner',
            desireId: desire.id,
            feasibility: {
              feasible: feasibility.feasible,
              confidence: feasibility.confidence,
              reasoning: feasibility.reasoning,
              blockers: feasibility.blockers ?? [],
              suggestedApproach: feasibility.suggestedApproach ?? null,
            },
          }
        );

        // Agency state changes are system events. Conversational text is owned
        // by a cognitive graph and must not be injected into its rolling buffer.
        await submitSystemEvent(
          username,
          `❌ **Desire Not Feasible:** "${desire.title}"\n\n` +
          `**Reason:** ${feasibility.reasoning}\n\n` +
          `${feasibility.blockers?.length ? `**Blockers:**\n${feasibility.blockers.map(b => `• ${b}`).join('\n')}\n\n` : ''}` +
          `_You can provide feedback to clarify or adjust this desire, or create a new one._`,
          {
            dialogueSource: 'agency-system',
            source: 'agency',
            displayColor: '#ef4444',
            type: 'desire_rejected',
            desireId: desire.id,
            desireTitle: desire.title,
            feasibility,
          }
        );

        return {
          success: true,
          outcome: 'rejected',
          error: `Not feasible: ${feasibility.reasoning}`,
          feasibilityResult: feasibility,
        };
      }

      console.log(`${LOG_PREFIX}     ✓ Feasible (confidence: ${(feasibility.confidence * 100).toFixed(0)}%)`);
      if (feasibility.suggestedApproach) {
        console.log(`${LOG_PREFIX}        Suggested: ${feasibility.suggestedApproach}`);
      }
    }

    // =========================================================================
    // PHASE 0.5: Clarifying Questions (if needed)
    // =========================================================================
    const questionsCheck = needsClarifyingQuestions(desire);

    if (questionsCheck.needs) {
      console.log(`${LOG_PREFIX}     Questions needed: ${questionsCheck.reason}`);

      // Generate and store questions
      console.log(`${LOG_PREFIX}     Generating clarifying questions...`);
      const questions = await generateQuestions(desire);

      const now = new Date().toISOString();
      const updatedDesire: Desire = {
        ...desire,
        clarifyingQuestions: {
          phase: 'before_planning',
          questions,
          answers: [],
          askedAt: now,
        },
        status: 'questioning',
        currentStage: 'questioning',
        updatedAt: now,
      };

      // Save desire with questions
      await saveDesireManifest(updatedDesire, username);

      // Publish the questions with Agency state without fabricating a chat turn.
      const questionsList = questions
        .map((q, i) => `${i + 1}. ${q.text}${q.required ? ' *' : ''}`)
        .join('\n');

      await submitSystemEvent(
        username,
        `I'm working on planning "${desire.title}" and would like to ask a few questions to make sure I understand what you're looking for:\n\n${questionsList}\n\n_Please answer these questions to help me create a better plan._`,
        {
          type: 'clarifying_questions',
          source: 'agency',
          desireId: desire.id,
          desireTitle: desire.title,
          questions: questions.map((q) => ({ id: q.id, text: q.text, type: q.type, required: q.required })),
        }
      );

      audit({
        category: 'agent',
        level: 'info',
        event: 'desire_questions_generated',
        actor: 'desire-planner',
        details: {
          desireId: desire.id,
          title: desire.title,
          questionCount: questions.length,
          reason: questionsCheck.reason,
          username,
        },
      });

      console.log(`${LOG_PREFIX}     ✓ Generated ${questions.length} questions, waiting for answers`);

      return {
        success: true,
        outcome: 'needs_questions',
      };
    }

    // If questions were already answered, include them in planning context
    const answeredContext = desire.clarifyingQuestions?.completedAt
      ? desire.clarifyingQuestions.answers.map((a) => {
          const question = desire.clarifyingQuestions?.questions.find((q) => q.id === a.questionId);
          return question ? `Q: ${question.text}\nA: ${a.answer}` : null;
        }).filter(Boolean).join('\n\n')
      : null;

    if (answeredContext) {
      console.log(`${LOG_PREFIX}     Including ${desire.clarifyingQuestions?.answers.length} answered questions in plan context`);
    }

    // =========================================================================
    // PHASE 1: Generate Plan
    // =========================================================================
    const planContext = {
      userId: username,
      username,
      desire,
      desireId: desire.id,
      allowMemoryWrites: true,
      cognitiveMode: 'agent' as const,
      // Include user's answers to clarifying questions for better plan generation
      clarifyingQuestionsContext: answeredContext,
    };

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

    // Extract plan from graph output (node IDs are strings in Svelte Flow format)
    const planGeneratorOutput = requireGraphNodeOutput(planResult, 'desire_plan_generator');
    const plan = planGeneratorOutput.plan;

    if (!plan) {
      console.error(`${LOG_PREFIX}     No plan generated`);
      return {
        success: false,
        outcome: 'failed',
        error: 'Plan generator produced no output',
      };
    }

    console.log(`${LOG_PREFIX}     Plan generated: ${plan.steps?.length || 0} step(s)`);

    // =========================================================================
    // PHASE 2: Review Plan
    // =========================================================================
    const reviewContext = {
      userId: username,
      username,
      desire: { ...desire, plan },
      desireId: desire.id,
      allowMemoryWrites: true,
      cognitiveMode: 'agent' as const,
    };

    console.log(`${LOG_PREFIX}     Executing reviewer graph...`);
    const reviewResult = await runGraph({ graph: reviewerGraph, context: reviewContext, signal });

    if (reviewResult.status !== 'completed') {
      const error = `Reviewer graph ended with status: ${reviewResult.status}`;
      console.error(`${LOG_PREFIX}     ${error}`);
      return { success: false, outcome: 'failed', error };
    }

    // Extract verdict from graph output (node IDs are strings in Svelte Flow format)
    const verdictOutput = requireGraphNodeOutput(reviewResult, 'desire_verdict');
    const verdict = verdictOutput.verdict;
    const autoApprove = verdictOutput.autoApprove;

    if (verdict === 'reject') {
      console.log(`${LOG_PREFIX}     Plan rejected by review`);

      // Extract rejection reason if available
      const reviewReason = verdictOutput.reasoning || verdictOutput.concerns?.join(', ') || 'Plan did not pass safety/alignment review';

      // Publish the rejected plan as an Agency system event.
      await submitSystemEvent(
        username,
        `❌ **Plan Rejected:** "${desire.title}"\n\n` +
        `**Reason:** ${reviewReason}\n\n` +
        `_The plan was reviewed but did not pass alignment or safety checks. You can provide feedback to adjust the approach._`,
        {
          dialogueSource: 'agency-system',
          source: 'agency',
          displayColor: '#ef4444',
          type: 'plan_rejected',
          desireId: desire.id,
          desireTitle: desire.title,
        }
      );

      return { success: true, outcome: 'rejected' };
    }

    if (autoApprove) {
      console.log(`${LOG_PREFIX}     Plan auto-approved (high alignment + safety)`);
      return { success: true, outcome: 'approved' };
    }

    console.log(`${LOG_PREFIX}     Plan queued for manual approval`);
    return { success: true, outcome: 'needs_approval' };

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

/**
 * Process all desires in 'planning' status for a user
 */
export async function processPlanningDesires(
  username: string,
  plannerConfig: PlannerConfig,
  signal?: AbortSignal,
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

  const planningDesires = await listDesiresByStatus('planning', username);
  console.log(`${LOG_PREFIX} Found ${planningDesires.length} desires in planning status`);

  if (planningDesires.length === 0) {
    return { planned: 0, approved: 0, needsApproval: 0, needsQuestions: 0, rejected: 0, failed: 0, errors: [] };
  }

  // Load graphs
  const plannerGraph = await loadGraph(plannerConfig.graph.planner);
  const reviewerGraph = await loadGraph(plannerConfig.graph.reviewer);

  let planned = 0;
  let approved = 0;
  let needsApproval = 0;
  let needsQuestions = 0;
  let rejected = 0;
  let failed = 0;
  const errors: string[] = [];

  // Process up to batchSize desires
  const batch = planningDesires.slice(0, plannerConfig.processing.batchSize);

  for (const desire of batch) {
    if (signal?.aborted) throw signal.reason || new DOMException('Planning cancelled', 'AbortError');
    const result = await processDesire(
      desire,
      plannerGraph,
      reviewerGraph,
      username,
      signal,
    );

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
        // Step 1: Promote pending desires to planning
        const promoted = await promotePendingDesires(user!.username, config.processing.batchSize);
        if (promoted > 0) {
          console.log(`${LOG_PREFIX} Promoted ${promoted} pending desire(s) to planning`);
        }

        // Step 2: Process desires in planning status
        const r = await processPlanningDesires(user!.username, config, options.signal);
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
  if (args.length === 0) return {};
  if (args.length !== 2 || args[0] !== '--username' || !args[1]?.trim()) {
    throw new Error('Desire Planner accepts only --username <profile>');
  }
  return { username: args[1].trim() };
}
