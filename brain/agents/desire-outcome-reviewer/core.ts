/**
 * Desire Outcome Reviewer Agent — Core Logic
 *
 * Post-execution review of desires using the node graph pipeline:
 * - Reviews completed/failed desires that haven't been reviewed
 * - Uses LLM to assess whether the desire was truly satisfied
 * - Graph handles: outcome review → inner dialogue → TTS output
 * - Determines next action based on behavioral metrics (not hardcoded types):
 *   - High cycle count with returns = recurring nature (reset for next cycle)
 *   - Single completion, low cycles = achievable nature (archive)
 *   - Never fully satisfied, always returning = aspirational nature (continue)
 * - If retry needed, sends back to planner with lessons learned
 * - Updates scratchpad with full outcome history
 *
 * MULTI-USER: Processes only logged-in users with isolated contexts.
 */

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import type {
  Desire,
  DesireOutcomeReview,
  OutcomeVerdict,
  FailureCategory,
  DesireScratchpadEntry,
  DesireMetrics,
  DesireScratchpadSummary,
} from '@metahuman/core';

import {
  audit,
  acquireLock,
  isLocked,
  initGlobalLogger,
  getTargetUser,
  withUserContext,
  captureEvent,
  llm,
  isAgencyEnabled,
  saveDesire,
  moveDesire,
  listDesiresByStatus,
  generateOutcomeReviewId,
  createScratchpadEntry,
  updateScratchpadSummary,
  initializeScratchpadSummary,
  initializeDesireMetrics,
  // Graph-based review (single source of truth from @metahuman/core)
  reviewOutcomeViaGraph,
  // Task system
  createTask,
  // Config
  loadUserConfig,
  type AgencyExecutionConfig,
} from '@metahuman/core';

const LOCK_NAME = 'desire-outcome-reviewer';
const LOG_PREFIX = '[AGENCY:outcome-reviewer]';

// Note: reviewOutcomeViaGraph is now imported from @metahuman/core
// This is the single source of truth for graph-based outcome review

// Strength adjustments for post-review actions
const CYCLE_RESET_STRENGTH = 0.3; // Start low after a cycle completes, builds up again
const CONTINUE_STRENGTH = 0.5; // Moderate strength for ongoing desires
const RETRY_STRENGTH_PENALTY = 0.1; // Reduce strength on retry

// Metrics thresholds for inferring desire nature
const RECURRING_CYCLE_THRESHOLD = 2; // More than 2 cycles suggests recurring
const RECURRING_COMPLETION_THRESHOLD = 2; // More than 2 completions suggests recurring

// ============================================================================
// Agency Execution Config
// ============================================================================

function getAgencyExecutionConfig(username?: string): AgencyExecutionConfig {
  const defaults: AgencyExecutionConfig = {
    preferredBackend: 'claude-code',
    fallbackBackend: 'codex',
    availableBackends: ['claude-code', 'codex', 'open-interpreter', 'aider'],
    delegateToToolExecutor: true,
    localExecutionEnabled: false,
    plannerIncludesToolCapabilities: true,
    feasibilityCheckEnabled: true,
    maxPlanRetries: 3,
    taskGenerationEnabled: true,
  };

  try {
    const agencyConfig = loadUserConfig<{ execution?: AgencyExecutionConfig }>(
      'agency.json',
      { execution: defaults },
      username
    );
    return agencyConfig.execution || defaults;
  } catch {
    return defaults;
  }
}

// ============================================================================
// Task Generation for Recurring Desires
// ============================================================================

/**
 * Generate a task for a recurring desire's next cycle.
 * This creates an entry in the task system that tracks the desire's schedule.
 */
function generateRecurringTask(
  desire: Desire,
  cycleNumber: number,
  username?: string
): string | null {
  const execConfig = getAgencyExecutionConfig(username);

  if (!execConfig.taskGenerationEnabled) {
    console.log(`${LOG_PREFIX}   Task generation disabled, skipping`);
    return null;
  }

  try {
    const taskTitle = `[Recurring] ${desire.title} (Cycle ${cycleNumber + 1})`;
    const taskDescription = `Recurring desire from Agency system.

**Original Desire**: ${desire.title}
**Description**: ${desire.description}
**Reason**: ${desire.reason || 'Not specified'}
**Previous Cycles**: ${cycleNumber}
**Source**: ${desire.source}
**Desire ID**: ${desire.id}

This task was automatically generated because the desire completed cycle ${cycleNumber} and was detected as recurring.
The desire will rebuild strength naturally. This task serves as a reference for the next occurrence.`;

    const filepath = createTask(taskTitle, {
      description: taskDescription,
      priority: 'P2',
      tags: ['agency', 'recurring', 'auto-generated', `desire:${desire.id}`],
    });

    console.log(`${LOG_PREFIX}   Generated task for recurring desire: ${taskTitle}`);

    audit({
      category: 'agent',
      level: 'info',
      event: 'recurring_desire_task_generated',
      actor: 'desire-outcome-reviewer',
      details: {
        desireId: desire.id,
        desireTitle: desire.title,
        taskTitle,
        cycleNumber,
        username,
      },
    });

    return filepath;
  } catch (error) {
    console.error(`${LOG_PREFIX}   Failed to generate recurring task:`, error);
    return null;
  }
}

// ============================================================================
// Types
// ============================================================================

export interface DesireOutcomeReviewerOptions {
  singleUser?: boolean;
  username?: string;
}

export interface DesireOutcomeReviewerResult {
  success: boolean;
  usersProcessed: number;
  errors: string[];
  stats: {
    reviewed: number;
    completed: number;
    retried: number;
    abandoned: number;
    escalated: number;
    continued: number;
  };
}

interface LLMOutcomeReviewOutput {
  verdict: OutcomeVerdict;
  successScore: number; // 0-1
  reasoning: string;
  lessonsLearned: string[];
  nextAttemptSuggestions?: string[];
  adjustedStrength?: number;
  notifyUser: boolean;
  userMessage?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Local helper to add scratchpad entry and update summary in memory
 * For folder-based storage, the actual file writing happens in saveDesire
 */
function addScratchpadEntry(
  summary: DesireScratchpadSummary | undefined,
  entry: DesireScratchpadEntry
): DesireScratchpadSummary {
  const current = summary || initializeScratchpadSummary();
  return updateScratchpadSummary(current, entry);
}

/**
 * Infer the behavioral nature of a desire from its metrics
 * Returns: 'recurring' | 'achievable' | 'aspirational'
 */
function inferDesireNature(metrics: DesireMetrics): 'recurring' | 'achievable' | 'aspirational' {
  // High cycles and completions = recurring (keeps coming back)
  if (metrics.cycleCount > RECURRING_CYCLE_THRESHOLD ||
      metrics.completionCount > RECURRING_COMPLETION_THRESHOLD) {
    return 'recurring';
  }

  // First completion with low retry count = achievable
  if (metrics.completionCount <= 1 && metrics.executionAttemptCount <= 3) {
    return 'achievable';
  }

  // Many attempts, never satisfied = aspirational
  if (metrics.executionAttemptCount > 3 && metrics.completionCount === 0) {
    return 'aspirational';
  }

  // Default to achievable for new desires
  return 'achievable';
}

// ============================================================================
// Outcome Review via LLM
// ============================================================================

/**
 * Build the prompt for outcome review
 */
function buildOutcomeReviewPrompt(desire: Desire): string {
  const executionSummary = desire.execution
    ? `
Execution Status: ${desire.execution.status}
Steps Completed: ${desire.execution.stepsCompleted || 0} / ${desire.plan?.steps.length || 0}
${desire.execution.error ? `Error: ${desire.execution.error}` : ''}
${desire.execution.result ? `Result: ${JSON.stringify(desire.execution.result, null, 2)}` : ''}
Started: ${desire.execution.startedAt}
${desire.execution.completedAt ? `Completed: ${desire.execution.completedAt}` : ''}
`
    : 'No execution data available';

  const planSummary = desire.plan
    ? `
Plan Version: ${desire.plan.version}
Operator Goal: ${desire.plan.operatorGoal}
Steps:
${desire.plan.steps.map(s => `  ${s.order}. ${s.action}`).join('\n')}
`
    : 'No plan available';

  const historyContext = desire.planHistory?.length
    ? `\nPrevious Plan Attempts: ${desire.planHistory.length}`
    : '';

  const rejectionContext = desire.rejectionHistory?.length
    ? `\nPrevious Rejections: ${desire.rejectionHistory.length}
${desire.rejectionHistory.map(r => `  - ${r.rejectedBy}: ${r.reason}`).join('\n')}`
    : '';

  // Build metrics context for LLM
  const metrics = desire.metrics || initializeDesireMetrics();
  const inferredNature = inferDesireNature(metrics);

  const metricsContext = `
BEHAVIORAL METRICS (how the desire has evolved):
- Cycles completed: ${metrics.cycleCount} (how many times it's been through the full pipeline)
- Completions: ${metrics.completionCount} (times successfully satisfied)
- Execution attempts: ${metrics.executionAttemptCount} (total attempts)
- Success rate: ${metrics.executionSuccessCount}/${metrics.executionAttemptCount || 1}
- Plan versions: ${metrics.planVersionCount} (times replanned)
- Reinforcements: ${metrics.reinforcementCount} (times strength increased)
- Decays: ${metrics.decayCount} (times strength decreased)
- User interactions: ${metrics.userInputCount} (times user provided input)

INFERRED NATURE: ${inferredNature}
(Based on metrics: ${
  inferredNature === 'recurring' ? 'High cycle/completion count - returns after satisfaction' :
  inferredNature === 'aspirational' ? 'Many attempts, never fully satisfied - continuous pursuit' :
  'First-time or few attempts - likely a one-time goal'
})`;

  return `You are an outcome reviewer for an autonomous agent system. Review the following desire execution and determine the next action.

DESIRE INFORMATION:
Title: ${desire.title}
Description: ${desire.description}
Reason: ${desire.reason}
Current Strength: ${desire.strength}
Source: ${desire.source}
${metricsContext}

PLAN:
${planSummary}

EXECUTION:
${executionSummary}
${historyContext}
${rejectionContext}

UNDERSTANDING DESIRE NATURE (inferred from metrics, not hardcoded):
- Desires with high cycle counts that keep returning after completion are RECURRING (e.g., "exercise daily", "eat healthy")
- Desires with single completion and low attempts are ACHIEVABLE (e.g., "buy a phone", "complete project X")
- Desires with many attempts but never fully satisfied are ASPIRATIONAL (e.g., "be happy", "achieve mastery")

The nature of a desire emerges from its behavior over time - the same desire might start as achievable
and reveal itself to be recurring if it keeps coming back after being satisfied.

Based on this information, provide your review in the following JSON format:
{
  "verdict": "completed" | "continue" | "retry" | "escalate" | "abandon",
  "successScore": <0.0-1.0>,
  "reasoning": "<detailed reasoning for your verdict>",
  "lessonsLearned": ["<lesson 1>", "<lesson 2>"],
  "nextAttemptSuggestions": ["<suggestion 1>", "<suggestion 2>"],
  "adjustedStrength": <0.0-1.0 or null>,
  "notifyUser": true/false,
  "userMessage": "<message for user if notifyUser is true>"
}

VERDICT GUIDELINES:
- "completed": The desire was fully satisfied and should be archived (for achievable) or reset (for recurring)
- "continue": Keep pursuing without changes (for aspirational, or recurring that completed a cycle)
- "retry": Try again with a new approach (include nextAttemptSuggestions)
- "escalate": Human intervention needed - something unexpected happened
- "abandon": Cannot be achieved, give up (only after multiple failures or clear impossibility)

Consider:
1. Was the plan executed successfully?
2. Did the execution actually satisfy the underlying desire/need?
3. What can be learned from this attempt?
4. Should the user be notified of significant events?

Respond ONLY with the JSON object.`;
}

/**
 * Review a desire's execution outcome using LLM
 */
export async function reviewOutcome(desire: Desire): Promise<DesireOutcomeReview> {
  const prompt = buildOutcomeReviewPrompt(desire);

  try {
    const response = await llm.generateJSON<LLMOutcomeReviewOutput>([
      { role: 'user', content: prompt },
    ]);

    if (!response) {
      throw new Error('No response from LLM');
    }

    return {
      id: generateOutcomeReviewId(desire.id),
      verdict: response.verdict,
      reasoning: response.reasoning,
      successScore: response.successScore,
      lessonsLearned: response.lessonsLearned || [],
      nextAttemptSuggestions: response.nextAttemptSuggestions,
      adjustedStrength: response.adjustedStrength,
      reviewedAt: new Date().toISOString(),
      notifyUser: response.notifyUser,
      userMessage: response.userMessage,
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} LLM review failed:`, error);

    // Fallback review based on execution status
    const wasSuccessful = desire.execution?.status === 'completed';
    return {
      id: generateOutcomeReviewId(desire.id),
      verdict: wasSuccessful ? 'completed' : 'retry',
      reasoning: wasSuccessful
        ? 'Execution completed successfully (fallback review)'
        : `Execution failed: ${desire.execution?.error || 'Unknown error'} (fallback review)`,
      successScore: wasSuccessful ? 0.8 : 0.2,
      lessonsLearned: wasSuccessful
        ? ['Plan executed as expected']
        : ['Execution encountered errors - may need different approach'],
      reviewedAt: new Date().toISOString(),
      notifyUser: !wasSuccessful,
      userMessage: wasSuccessful ? undefined : `Desire "${desire.title}" needs attention`,
    };
  }
}

// ============================================================================
// Post-Review Actions
// ============================================================================

/**
 * Handle a 'completed' verdict - archive or reset based on inferred nature from metrics
 */
async function handleCompleted(
  desire: Desire,
  review: DesireOutcomeReview,
  username?: string
): Promise<Desire> {
  const metrics = desire.metrics || initializeDesireMetrics();
  const inferredNature = inferDesireNature(metrics);
  const now = new Date().toISOString();

  let updatedDesire = { ...desire };

  // Update metrics for this completion
  updatedDesire.metrics = {
    ...metrics,
    completionCount: metrics.completionCount + 1,
    executionSuccessCount: metrics.executionSuccessCount + 1,
    avgSuccessScore: (metrics.avgSuccessScore * metrics.executionSuccessCount + review.successScore) /
      (metrics.executionSuccessCount + 1),
    lastActivityAt: now,
  };

  // Add scratchpad entry
  updatedDesire.scratchpad = addScratchpadEntry(
    updatedDesire.scratchpad,
    createScratchpadEntry(
      'outcome_review',
      `Outcome review: ${review.verdict} (score: ${review.successScore})`,
      'agent',
      'desire-outcome-reviewer',
      { review, inferredNature }
    )
  );

  if (inferredNature === 'recurring') {
    // Recurring behavior - reset and prepare for next cycle
    updatedDesire.metrics.cycleCount++;
    updatedDesire.metrics.currentCycle++;
    updatedDesire.strength = CYCLE_RESET_STRENGTH;
    updatedDesire.status = 'nascent'; // Go back to nascent, will rebuild strength
    updatedDesire.execution = undefined; // Clear execution for next cycle
    updatedDesire.plan = undefined; // Will get a new plan next time
    updatedDesire.review = undefined;
    updatedDesire.outcomeReview = review;
    updatedDesire.runCount = 0; // Reset run count for new cycle
    updatedDesire.updatedAt = now;

    // Generate a task in the task system for tracking
    const taskPath = generateRecurringTask(updatedDesire, updatedDesire.metrics.cycleCount, username);

    updatedDesire.scratchpad = addScratchpadEntry(
      updatedDesire.scratchpad,
      createScratchpadEntry(
        'recurring_reset',
        `Recurring nature detected (cycle ${updatedDesire.metrics.cycleCount}). Reset for next cycle. Strength: ${CYCLE_RESET_STRENGTH}${taskPath ? '. Task generated.' : ''}`,
        'agent',
        'desire-outcome-reviewer',
        taskPath ? { taskPath } : undefined
      )
    );

    await moveDesire(updatedDesire, 'completed', 'nascent', username);
    console.log(`${LOG_PREFIX}   Recurring nature - reset for cycle ${updatedDesire.metrics.cycleCount}`);
  } else if (inferredNature === 'aspirational') {
    // Aspirational behavior - never fully satisfied, continue pursuit
    const newStrength = review.adjustedStrength ?? CONTINUE_STRENGTH;
    updatedDesire.strength = newStrength;
    updatedDesire.status = 'pending'; // Back to pending queue
    updatedDesire.execution = undefined;
    updatedDesire.plan = undefined;
    updatedDesire.review = undefined;
    updatedDesire.outcomeReview = review;
    updatedDesire.updatedAt = now;

    updatedDesire.scratchpad = addScratchpadEntry(
      updatedDesire.scratchpad,
      createScratchpadEntry(
        'strength_adjusted',
        `Aspirational nature detected - continuous pursuit. New strength: ${newStrength}`,
        'agent',
        'desire-outcome-reviewer'
      )
    );

    await moveDesire(updatedDesire, 'completed', 'pending', username);
    console.log(`${LOG_PREFIX}   Aspirational nature - continues with strength ${newStrength}`);
  } else {
    // Achievable behavior - goal reached, archive
    updatedDesire.outcomeReview = review;
    updatedDesire.completedAt = now;
    updatedDesire.updatedAt = now;

    updatedDesire.scratchpad = addScratchpadEntry(
      updatedDesire.scratchpad,
      createScratchpadEntry(
        'completed',
        `Achievable nature detected - goal completed and archived`,
        'agent',
        'desire-outcome-reviewer'
      )
    );

    await saveDesire(updatedDesire, username);
    console.log(`${LOG_PREFIX}   Achievable nature - completed and archived`);
  }

  return updatedDesire;
}

/**
 * Handle a 'retry' verdict - send back to planner with lessons
 */
async function handleRetry(
  desire: Desire,
  review: DesireOutcomeReview,
  username?: string
): Promise<Desire> {
  const now = new Date().toISOString();
  let updatedDesire = { ...desire };

  // Reduce strength as penalty for retry
  const newStrength = Math.max(0.3, desire.strength - RETRY_STRENGTH_PENALTY);

  // Store lessons learned in the critique field for the planner
  const critique = [
    'RETRY REQUESTED - Previous attempt failed',
    '',
    'Lessons learned:',
    ...(review.lessonsLearned?.map(l => `- ${l}`) || []),
    '',
    'Suggestions for next attempt:',
    ...(review.nextAttemptSuggestions?.map(s => `- ${s}`) || []),
  ].join('\n');

  updatedDesire.strength = newStrength;
  updatedDesire.status = 'planning'; // Back to planning phase
  updatedDesire.userCritique = critique;
  updatedDesire.critiqueAt = now;
  updatedDesire.outcomeReview = review;
  updatedDesire.updatedAt = now;

  // Move current plan to history
  if (updatedDesire.plan) {
    if (!updatedDesire.planHistory) {
      updatedDesire.planHistory = [];
    }
    updatedDesire.planHistory.push(updatedDesire.plan);
    updatedDesire.plan = undefined;
  }

  // Clear execution for retry
  updatedDesire.execution = undefined;
  updatedDesire.review = undefined;

  // Update scratchpad
  updatedDesire.scratchpad = addScratchpadEntry(
    updatedDesire.scratchpad,
    createScratchpadEntry(
      'outcome_review',
      `Outcome review: retry (score: ${review.successScore})`,
      'agent',
      'desire-outcome-reviewer',
      { review }
    )
  );

  updatedDesire.scratchpad = addScratchpadEntry(
    updatedDesire.scratchpad,
    createScratchpadEntry(
      'retry_scheduled',
      `Retry scheduled. Lessons: ${review.lessonsLearned?.join(', ')}`,
      'agent',
      'desire-outcome-reviewer',
      { newStrength, suggestions: review.nextAttemptSuggestions }
    )
  );

  // Update metrics for retry
  const metrics = desire.metrics || initializeDesireMetrics();
  updatedDesire.metrics = {
    ...metrics,
    executionFailCount: metrics.executionFailCount + 1,
    planRevisionCount: metrics.planRevisionCount + 1,
    lastActivityAt: now,
  };

  await moveDesire(updatedDesire, desire.status, 'planning', username);
  console.log(`${LOG_PREFIX}   Sent back to planning for retry`);

  return updatedDesire;
}

/**
 * Handle an 'abandon' verdict - give up on the desire
 */
async function handleAbandon(
  desire: Desire,
  review: DesireOutcomeReview,
  username?: string
): Promise<Desire> {
  const now = new Date().toISOString();
  let updatedDesire = { ...desire };

  updatedDesire.status = 'abandoned';
  updatedDesire.outcomeReview = review;
  updatedDesire.completedAt = now;
  updatedDesire.updatedAt = now;

  updatedDesire.scratchpad = addScratchpadEntry(
    updatedDesire.scratchpad,
    createScratchpadEntry(
      'outcome_review',
      `Outcome review: abandon (score: ${review.successScore})`,
      'agent',
      'desire-outcome-reviewer',
      { review }
    )
  );

  await moveDesire(updatedDesire, desire.status, 'abandoned', username);
  console.log(`${LOG_PREFIX}   Desire abandoned: ${review.reasoning}`);

  return updatedDesire;
}

/**
 * Handle an 'escalate' verdict - needs user attention
 */
async function handleEscalate(
  desire: Desire,
  review: DesireOutcomeReview,
  username?: string
): Promise<Desire> {
  const now = new Date().toISOString();
  let updatedDesire = { ...desire };

  updatedDesire.status = 'awaiting_approval'; // Send to approval queue for user review
  updatedDesire.outcomeReview = review;
  updatedDesire.updatedAt = now;

  updatedDesire.scratchpad = addScratchpadEntry(
    updatedDesire.scratchpad,
    createScratchpadEntry(
      'outcome_review',
      `Outcome review: escalate to user`,
      'agent',
      'desire-outcome-reviewer',
      { review }
    )
  );

  await moveDesire(updatedDesire, desire.status, 'awaiting_approval', username);
  console.log(`${LOG_PREFIX}   Escalated to user for decision`);

  return updatedDesire;
}

/**
 * Handle a 'continue' verdict - keep going (mainly for aspirational)
 */
async function handleContinue(
  desire: Desire,
  review: DesireOutcomeReview,
  username?: string
): Promise<Desire> {
  const now = new Date().toISOString();
  let updatedDesire = { ...desire };

  const newStrength = review.adjustedStrength ?? desire.strength;

  updatedDesire.strength = newStrength;
  updatedDesire.status = 'pending'; // Back to pending
  updatedDesire.outcomeReview = review;
  updatedDesire.execution = undefined;
  updatedDesire.plan = undefined;
  updatedDesire.review = undefined;
  updatedDesire.updatedAt = now;

  updatedDesire.scratchpad = addScratchpadEntry(
    updatedDesire.scratchpad,
    createScratchpadEntry(
      'outcome_review',
      `Outcome review: continue (strength: ${newStrength})`,
      'agent',
      'desire-outcome-reviewer',
      { review }
    )
  );

  await moveDesire(updatedDesire, desire.status, 'pending', username);
  console.log(`${LOG_PREFIX}   Continuing with strength ${newStrength}`);

  return updatedDesire;
}

/**
 * Handle a system error with a fixable bug - route to Big Brother for self-repair.
 * This creates a high-priority task for Big Brother to diagnose and fix the issue.
 */
async function handleSystemErrorRepair(
  desire: Desire,
  review: DesireOutcomeReview,
  username?: string
): Promise<Desire> {
  const now = new Date().toISOString();
  let updatedDesire = { ...desire };

  // Create a self-repair task for Big Brother
  const taskTitle = `[Self-Repair] Fix bug blocking "${desire.title}"`;
  const taskDescription = `## System Error Detected

A desire execution failed due to what appears to be a fixable code bug in MetaHuman OS.

### Original Desire
- **Title**: ${desire.title}
- **Description**: ${desire.description}
- **Desire ID**: ${desire.id}

### Error Details
- **Failure Category**: ${review.failureCategory}
- **Error Type**: ${review.errorType || 'Unknown'}
- **Success Score**: ${review.successScore}

### Analysis
${review.reasoning}

### Suggested Fix
${review.suggestedFix || 'No specific fix suggested - investigate the error'}

### Lessons Learned
${review.lessonsLearned?.map(l => `- ${l}`).join('\n') || '- No lessons captured'}

## Your Task (Big Brother)

You have FULL PERMISSIONS to:
1. Read and analyze the relevant source code
2. Diagnose the root cause of the bug
3. Implement and test the fix
4. Verify the fix resolves the issue

After fixing the bug:
1. Document what was changed and why
2. The desire will be automatically retried

This is an autonomous self-repair task. Use your judgment to fix the issue properly.
`;

  try {
    const filepath = createTask(taskTitle, {
      description: taskDescription,
      priority: 'P1', // High priority - system health
      tags: ['agency', 'self-repair', 'system-error', 'auto-generated', `desire:${desire.id}`],
    });

    console.log(`${LOG_PREFIX}   🔧 Created self-repair task: ${taskTitle}`);
    console.log(`${LOG_PREFIX}      Task file: ${filepath}`);

    audit({
      category: 'agent',
      level: 'warn',
      event: 'self_repair_task_created',
      actor: 'desire-outcome-reviewer',
      details: {
        desireId: desire.id,
        desireTitle: desire.title,
        taskTitle,
        failureCategory: review.failureCategory,
        errorType: review.errorType,
        suggestedFix: review.suggestedFix,
        username,
      },
    });
  } catch (error) {
    console.error(`${LOG_PREFIX}   ❌ Failed to create self-repair task:`, error);
  }

  // Mark desire as awaiting review (will be retried after fix)
  updatedDesire.status = 'awaiting_review';
  updatedDesire.outcomeReview = review;
  updatedDesire.updatedAt = now;

  // Add scratchpad entry documenting the self-repair routing
  updatedDesire.scratchpad = addScratchpadEntry(
    updatedDesire.scratchpad,
    createScratchpadEntry(
      'outcome_review',
      `System error detected - routing to Big Brother for self-repair`,
      'agent',
      'desire-outcome-reviewer',
      {
        review,
        selfRepairRequested: true,
        errorType: review.errorType,
        suggestedFix: review.suggestedFix,
      }
    )
  );

  await moveDesire(updatedDesire, desire.status, 'awaiting_review', username);
  console.log(`${LOG_PREFIX}   Routed to self-repair, awaiting fix`);

  return updatedDesire;
}

/**
 * Check if max retries have been exceeded.
 * Returns true if the desire should be escalated instead of retried.
 */
function shouldEscalateForMaxRetries(desire: Desire, username?: string): boolean {
  const config = getAgencyExecutionConfig(username);
  const maxRetries = config.maxPlanRetries ?? 3;
  const currentRetries = desire.metrics?.planRevisionCount || 0;

  if (currentRetries >= maxRetries) {
    console.log(`${LOG_PREFIX}   ⚠️ Max retries (${maxRetries}) reached for "${desire.title}"`);
    return true;
  }
  return false;
}

// ============================================================================
// Main Processing
// ============================================================================

/**
 * Process desires that need outcome review
 */
export async function processDesires(username?: string): Promise<{
  reviewed: number;
  completed: number;
  retried: number;
  abandoned: number;
  escalated: number;
  continued: number;
}> {
  if (!await isAgencyEnabled(username)) {
    console.log(`${LOG_PREFIX} Agency disabled for user ${username || 'default'}`);
    return { reviewed: 0, completed: 0, retried: 0, abandoned: 0, escalated: 0, continued: 0 };
  }

  // Get desires that need review (awaiting_review/completed/failed without outcome review)
  const awaitingReviewDesires = await listDesiresByStatus('awaiting_review', username);
  const completedDesires = await listDesiresByStatus('completed', username);
  const failedDesires = await listDesiresByStatus('failed', username);

  // Filter to those without outcome reviews
  const needsReview = [...awaitingReviewDesires, ...completedDesires, ...failedDesires].filter(d => !d.outcomeReview);

  console.log(`${LOG_PREFIX} Found ${needsReview.length} desires needing outcome review`);

  const stats = { reviewed: 0, completed: 0, retried: 0, abandoned: 0, escalated: 0, continued: 0 };

  for (const desire of needsReview) {
    console.log(`${LOG_PREFIX} Reviewing: ${desire.title} (status: ${desire.status})`);

    // Ensure scratchpad and metrics exist
    if (!desire.scratchpad) {
      desire.scratchpad = initializeScratchpadSummary();
    }
    if (!desire.metrics) {
      desire.metrics = initializeDesireMetrics();
    }

    // Get outcome review via graph pipeline (handles inner dialogue + TTS output)
    const graphResult = await reviewOutcomeViaGraph(desire, username!);

    if (!graphResult.success || !graphResult.outcomeReview) {
      console.error(`${LOG_PREFIX}   ❌ Review failed:`, graphResult.error);
      continue;
    }

    const review = graphResult.outcomeReview;
    stats.reviewed++;

    console.log(`${LOG_PREFIX}   Verdict: ${review.verdict} (score: ${review.successScore})`);

    // Handle based on verdict
    // Note: Inner dialogue and TTS are now handled by the graph pipeline
    let updatedDesire: Desire;

    // Special routing for system errors with fixable bugs
    if (review.isFixableBug && review.failureCategory === 'system_error') {
      console.log(`${LOG_PREFIX}   🔧 Detected fixable system bug - routing to self-repair`);
      updatedDesire = await handleSystemErrorRepair(desire, review, username);
      stats.retried++; // Count as retry for stats purposes
    }
    // Check max retries before allowing retry
    else if (review.verdict === 'retry' && shouldEscalateForMaxRetries(desire, username)) {
      console.log(`${LOG_PREFIX}   ⚠️ Max retries exceeded - escalating to user`);
      // Override to escalate
      const escalateReview = {
        ...review,
        verdict: 'escalate' as const,
        reasoning: `${review.reasoning}\n\n[AUTO-ESCALATED: Max retry limit (${desire.metrics?.planRevisionCount || 0}) reached. User intervention required.]`,
        userMessage: `The desire "${desire.title}" has failed ${desire.metrics?.planRevisionCount || 0} times and needs your attention.`,
        notifyUser: true,
      };
      updatedDesire = await handleEscalate(desire, escalateReview, username);
      stats.escalated++;
    }
    else {
      // Normal verdict handling
      switch (review.verdict) {
        case 'completed':
          updatedDesire = await handleCompleted(desire, review, username);
          stats.completed++;
          break;
        case 'retry':
          updatedDesire = await handleRetry(desire, review, username);
          stats.retried++;
          break;
        case 'abandon':
          updatedDesire = await handleAbandon(desire, review, username);
          stats.abandoned++;
          break;
        case 'escalate':
          updatedDesire = await handleEscalate(desire, review, username);
          stats.escalated++;
          break;
        case 'continue':
        default:
          updatedDesire = await handleContinue(desire, review, username);
          stats.continued++;
          break;
      }
    }

    // Audit
    audit({
      category: 'agent',
      level: review.isFixableBug ? 'warn' : 'info',
      event: 'desire_outcome_reviewed',
      actor: 'desire-outcome-reviewer',
      details: {
        desireId: desire.id,
        title: desire.title,
        previousStatus: desire.status,
        verdict: review.verdict,
        successScore: review.successScore,
        failureCategory: review.failureCategory,
        errorType: review.errorType,
        isFixableBug: review.isFixableBug,
        newStatus: updatedDesire.status,
        retryCount: desire.metrics?.planRevisionCount || 0,
        username,
        usedGraphPipeline: true,
      },
    });

    // Note: Inner dialogue and TTS are now handled by the graph pipeline
    // The inner_dialogue_capture and tts nodes in the graph handle this automatically

    // Special user notifications are still captured separately if needed
    if (review.notifyUser && review.userMessage) {
      await captureEvent(review.userMessage, {
        type: 'inner_dialogue',
        tags: ['agency', 'outcome', 'notification', 'user-alert'],
        metadata: {
          desireId: desire.id,
          verdict: review.verdict,
          source: 'desire-outcome-reviewer',
          isUserNotification: true,
        },
      });
    }
  }

  return stats;
}

// ============================================================================
// Agent Runtime Entry Points
// ============================================================================

/**
 * Run a single review cycle - entry point for CLI and Trigger Manager
 */
export async function runCycle(options: DesireOutcomeReviewerOptions = {}): Promise<DesireOutcomeReviewerResult> {
  const result: DesireOutcomeReviewerResult = {
    success: true,
    usersProcessed: 0,
    errors: [],
    stats: { reviewed: 0, completed: 0, retried: 0, abandoned: 0, escalated: 0, continued: 0 },
  };

  try {
    // SECURITY: Get target user - prioritizes explicit username, then API trigger, then most recently active
    let user = getTargetUser(options);
    if (!user && options.singleUser) {
      user = { userId: 'default', username: 'default', role: 'owner' };
    }

    if (!user) {
      console.log(`${LOG_PREFIX} No active user found`);
      return result;
    }

    console.log(`${LOG_PREFIX} Processing user: ${user.username}`);

    try {
      console.log(`${LOG_PREFIX} --- Processing user: ${user.username} ---`);
      await withUserContext(user, async () => {
        const r = await processDesires(user!.username);
        result.stats.reviewed += r.reviewed;
        result.stats.completed += r.completed;
        result.stats.retried += r.retried;
        result.stats.abandoned += r.abandoned;
        result.stats.escalated += r.escalated;
        result.stats.continued += r.continued;
      });
      result.usersProcessed++;
    } catch (error) {
      result.errors.push(`Error processing ${user.username}: ${(error as Error).message}`);
    }

    console.log(`${LOG_PREFIX} Outcome review complete:`);
    console.log(`${LOG_PREFIX}   Reviewed: ${result.stats.reviewed}`);
    console.log(`${LOG_PREFIX}   Completed: ${result.stats.completed}`);
    console.log(`${LOG_PREFIX}   Retried: ${result.stats.retried}`);
    console.log(`${LOG_PREFIX}   Abandoned: ${result.stats.abandoned}`);
    console.log(`${LOG_PREFIX}   Escalated: ${result.stats.escalated}`);
    console.log(`${LOG_PREFIX}   Continued: ${result.stats.continued}`);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_outcome_reviewer_completed',
      actor: 'desire-outcome-reviewer',
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

  let username = opts.username as string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      username = args[i + 1];
      break;
    }
  }

  const options: DesireOutcomeReviewerOptions = {
    singleUser: args.includes('--single-user') || opts.singleUser === true,
    username: username || ctx.userId,
  };

  const result = await runCycle(options);

  return {
    success: result.success,
    data: result.stats,
    errors: result.errors.length > 0 ? result.errors : undefined,
    durationMs: Date.now() - startTime,
  };
}

// ============================================================================
// CLI Entry Point (for direct execution)
// ============================================================================

async function main(): Promise<void> {
  initGlobalLogger('desire-outcome-reviewer');
  console.log(`${LOG_PREFIX} Starting desire outcome reviewer agent...`);

  // Check for existing lock
  if (isLocked(LOCK_NAME)) {
    console.log(`${LOG_PREFIX} Another instance is already running. Exiting.`);
    process.exit(0);
  }

  // Acquire lock
  let lock: { release: () => void } | null = null;
  try {
    lock = acquireLock(LOCK_NAME);
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to acquire lock:`, error);
    process.exit(1);
  }

  try {
    const result = await runCycle();

    if (!result.success) {
      console.error(`${LOG_PREFIX} Errors:`, result.errors);
      process.exit(1);
    }
  } finally {
    if (lock) {
      lock.release();
    }
  }
}

// Only run if executed directly (not imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((error) => {
    console.error(`${LOG_PREFIX} Fatal error:`, error);
    process.exit(1);
  });
}
