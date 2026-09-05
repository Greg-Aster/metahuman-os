/**
 * Agency System Types
 *
 * The Agency system synthesizes outputs from services (curiosity, dreams,
 * episodic memory, tasks, persona) into desires - autonomous intentions
 * that the system can plan, review, and execute within trust boundaries.
 */

import type { TrustLevel } from '../skills.js';

// ============================================================================
// Desire Source Types
// ============================================================================

/**
 * Source types for desires - determines base weight in priority calculation.
 * Higher weights = higher priority when competing for execution.
 */
export type DesireSource =
  | 'user_request'      // Explicit want stated by the user (weight: 1.0)
  | 'persona_goal'      // Explicit goals from persona/core.json (weight: 1.0)
  | 'urgent_task'       // High-priority tasks (weight: 0.85)
  | 'task'              // Regular tasks (weight: 0.7)
  | 'help_ticket'       // From negative user feedback requiring fix (weight: 0.65)
  | 'memory_pattern'    // Recurring patterns from episodic memory (weight: 0.5)
  | 'curiosity'         // From curiosity service questions (weight: 0.4)
  | 'reflection'        // From reflector insights (weight: 0.35)
  | 'dream'             // Dream-inspired desires (weight: 0.3)
  | 'tool_suggestion';  // From tool/skill outputs (weight: 0.25)

/**
 * Default weights for each desire source.
 */
export const DESIRE_SOURCE_WEIGHTS: Record<DesireSource, number> = {
  user_request: 1.0,
  persona_goal: 1.0,
  urgent_task: 0.85,
  task: 0.7,
  help_ticket: 0.65,  // User feedback issues are high priority
  memory_pattern: 0.5,
  curiosity: 0.4,
  reflection: 0.35,
  dream: 0.3,
  tool_suggestion: 0.25,
};

// ============================================================================
// Desire Lifecycle States
// ============================================================================

/**
 * Lifecycle states for a desire.
 */
export type DesireStatus =
  | 'nascent'           // Just generated, building strength
  | 'pending'           // In evaluation queue, waiting for threshold
  | 'evaluating'        // Currently being evaluated by LLM
  | 'planning'          // Plan is being generated
  | 'questioning'       // Waiting for user to answer clarifying questions
  | 'reviewing'         // Plan is under LLM self-review
  | 'awaiting_approval' // Manifest is waiting for explicit owner approval
  | 'approved'          // Ready for execution
  | 'executing'         // Currently being executed
  | 'awaiting_review'   // Execution done, waiting for outcome review
  | 'needs_attention'   // A non-approval problem requires an explicit owner decision
  | 'paused'            // Intentionally dormant and excluded from autonomous work
  | 'completed'         // Successfully executed
  | 'rejected'          // User rejected or LLM review rejected
  | 'abandoned'         // Decayed below threshold
  | 'archived'          // Explicitly archived while retaining its full history
  | 'failed';           // Execution failed

/**
 * Current processing stage within the pipeline.
 * More granular than status - tracks exactly where we are in the workflow.
 */
export type DesireStage =
  | 'nascent'           // Just created, waiting for reinforcement
  | 'strengthening'     // Building strength through reinforcements
  | 'planning'          // Generating execution plan
  | 'questioning'       // Waiting for user to answer clarifying questions
  | 'plan_review'       // Plan being reviewed for safety/alignment
  | 'user_approval'     // Waiting for user approval (if required)
  | 'executing'         // Canonical Agency executor is executing the plan
  | 'outcome_review'    // Reviewing execution outcomes
  | 'user_attention'    // Waiting for a non-approval owner decision
  | 'paused'            // Intentionally dormant
  | 'complete'          // Terminal state - done
  | 'failed'            // Terminal state - failed
  | 'archived'          // Terminal state - explicitly archived
  | 'abandoned';        // Terminal state - decayed/given up

/**
 * Per-stage iteration tracking.
 * Tracks how many times we've cycled through each stage.
 */
export interface StageIterations {
  planning: number;
  planReview: number;
  userApproval: number;
  executing: number;
  outcomeReview: number;
}

/**
 * Risk levels for desires and plan steps.
 */
export type DesireRisk = 'none' | 'low' | 'medium' | 'high' | 'critical';

// ============================================================================
// Goal Type and Milestones - Long-Running Goal Support
// ============================================================================

/**
 * Goal type determines how completion is evaluated.
 * - one_time: Single achievement, archived when done (e.g., "buy a car")
 * - recurring: Ongoing without end, cycles forever (e.g., "stay healthy")
 * - long_running: Takes weeks/months with clear end (e.g., "hike PCT")
 */
export type DesireGoalType = 'one_time' | 'recurring' | 'long_running';

/**
 * A milestone within a long-running desire.
 * Milestones break large goals into achievable phases.
 */
export interface DesireMilestone {
  /** Unique identifier */
  id: string;
  /** Order in the milestone sequence (1-based) */
  order: number;
  /** Brief title of the milestone */
  title: string;
  /** Detailed description */
  description?: string;
  /** Current status */
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  /** ISO timestamp when milestone was completed */
  completedAt?: string;
  /** Task IDs created for this milestone */
  tasks?: string[];
  /** Calendar event IDs for this milestone */
  calendarEvents?: string[];
  /** Estimated date to reach this milestone */
  estimatedDate?: string;
}

/**
 * Progress tracking for long-running desires.
 */
export interface DesireGoalProgress {
  /** Current milestone index (0-based) */
  currentMilestone: number;
  /** Total number of milestones */
  totalMilestones: number;
  /** Number of completed milestones */
  completedMilestones: number;
  /** Overall progress percentage (0-100) */
  progressPercent: number;
  /** Estimated completion date (ISO string) */
  estimatedCompletionDate?: string;
  /** ISO timestamp of last check-in */
  lastCheckinAt?: string;
  /** ISO timestamp when next check-in is due */
  nextCheckinAt?: string;
}

/**
 * Initialize empty goal progress for a new long-running desire.
 */
export function initializeGoalProgress(totalMilestones: number): DesireGoalProgress {
  return {
    currentMilestone: 0,
    totalMilestones,
    completedMilestones: 0,
    progressPercent: 0,
  };
}

/**
 * Update goal progress after milestone completion.
 */
export function advanceGoalProgress(progress: DesireGoalProgress): DesireGoalProgress {
  const newCompleted = progress.completedMilestones + 1;
  const newCurrent = Math.min(progress.currentMilestone + 1, progress.totalMilestones - 1);
  return {
    ...progress,
    currentMilestone: newCurrent,
    completedMilestones: newCompleted,
    progressPercent: Math.round((newCompleted / progress.totalMilestones) * 100),
    lastCheckinAt: new Date().toISOString(),
  };
}

// ============================================================================
// Desire Metrics - Nature Emerges From Behavior
// ============================================================================

/**
 * Metrics that track a desire's behavior over time.
 * The nature of a desire (recurring, one-time, aspirational) emerges from these
 * metrics rather than being hardcoded. This mirrors how human desires work -
 * we don't classify them, we just experience them.
 *
 * These metrics can be used by the LLM to understand patterns:
 * - High completionCount + keeps coming back = recurring need
 * - Single completion + high successScore = achievable goal
 * - Never fully satisfied + keeps continuing = aspirational pursuit
 */
export interface DesireMetrics {
  // === Lifecycle Tracking ===
  /** How many complete cycles through the pipeline (plan → execute → review) */
  cycleCount: number;
  /** How many times marked "completed" but desire continued/returned */
  completionCount: number;
  /** Current cycle number (resets to 1 when desire fully completes) */
  currentCycle: number;

  // === Time Tracking ===
  /** Total time spent in active processing states (ms) */
  totalActiveTimeMs: number;
  /** Time spent waiting/idle (ms) */
  totalIdleTimeMs: number;
  /** Average time per cycle (ms) */
  avgCycleTimeMs: number;
  /** Last activity timestamp */
  lastActivityAt: string;

  // === Strength Dynamics ===
  /** Highest strength ever reached */
  peakStrength: number;
  /** Lowest strength before abandonment threshold */
  troughStrength: number;
  /** How many times strength was reinforced */
  reinforcementCount: number;
  /** How many times strength decayed */
  decayCount: number;
  /** Net reinforcement (reinforcements - decays) */
  netReinforcement: number;

  // === Planning Dynamics ===
  /** Total plan versions created */
  planVersionCount: number;
  /** Plans rejected by review/user */
  planRejectionCount: number;
  /** Plans revised based on critique */
  planRevisionCount: number;

  // === Execution Dynamics ===
  /** Total execution attempts */
  executionAttemptCount: number;
  /** Successful executions */
  executionSuccessCount: number;
  /** Failed executions */
  executionFailCount: number;
  /** Average success score across attempts (0-1) */
  avgSuccessScore: number;

  // === User Interaction ===
  /** Direct user modifications/inputs */
  userInputCount: number;
  /** User approvals */
  userApprovalCount: number;
  /** User rejections */
  userRejectionCount: number;
  /** User critiques/revisions requested */
  userCritiqueCount: number;
}

/**
 * Initialize empty metrics for a new desire.
 */
export function initializeDesireMetrics(): DesireMetrics {
  return {
    cycleCount: 0,
    completionCount: 0,
    currentCycle: 1,
    totalActiveTimeMs: 0,
    totalIdleTimeMs: 0,
    avgCycleTimeMs: 0,
    lastActivityAt: new Date().toISOString(),
    peakStrength: 0,
    troughStrength: 1,
    reinforcementCount: 0,
    decayCount: 0,
    netReinforcement: 0,
    planVersionCount: 0,
    planRejectionCount: 0,
    planRevisionCount: 0,
    executionAttemptCount: 0,
    executionSuccessCount: 0,
    executionFailCount: 0,
    avgSuccessScore: 0,
    userInputCount: 0,
    userApprovalCount: 0,
    userRejectionCount: 0,
    userCritiqueCount: 0,
  };
}

/**
 * Initialize empty stage iterations for a new desire.
 */
export function initializeStageIterations(): StageIterations {
  return {
    planning: 0,
    planReview: 0,
    userApproval: 0,
    executing: 0,
    outcomeReview: 0,
  };
}

/**
 * Map DesireStatus to DesireStage.
 * Status is the stored state, Stage is the current processing step.
 */
export function statusToStage(status: DesireStatus): DesireStage {
  switch (status) {
    case 'nascent':
      return 'nascent';
    case 'pending':
      return 'strengthening';
    case 'evaluating':
    case 'planning':
      return 'planning';
    case 'reviewing':
      return 'plan_review';
    case 'awaiting_approval':
      return 'user_approval';
    case 'approved':
    case 'executing':
      return 'executing';
    case 'awaiting_review':
      return 'outcome_review';
    case 'needs_attention':
      return 'user_attention';
    case 'paused':
      return 'paused';
    case 'completed':
      return 'complete';
    case 'rejected':
    case 'failed':
      return 'failed';
    case 'abandoned':
      return 'abandoned';
    case 'archived':
      return 'archived';
    default:
      return 'nascent';
  }
}

// ============================================================================
// Scratchpad Types - Full Lifecycle Logging
// ============================================================================

/**
 * A single entry in the desire's scratchpad log.
 * Records every significant event in the desire's journey.
 */
export interface DesireScratchpadEntry {
  /** ISO timestamp of the entry */
  timestamp: string;
  /** Type of event */
  type: DesireScratchpadEntryType;
  /** Human-readable description */
  description: string;
  /** Actor who triggered this event */
  actor: 'system' | 'user' | 'agent' | 'llm';
  /** Which agent/service if applicable */
  agentName?: string;
  /** Additional structured data */
  data?: Record<string, unknown>;
}

/**
 * Types of desire scratchpad entries.
 */
export type DesireScratchpadEntryType =
  | 'origin'              // Desire was created
  | 'reinforcement'       // Strength increased due to related input
  | 'decay'               // Strength decreased due to inactivity
  | 'threshold_crossed'   // Crossed activation threshold
  | 'status_change'       // Status changed (with from/to)
  | 'plan_generated'      // A plan was created
  | 'plan_revised'        // Plan was revised based on feedback
  | 'user_critique'       // User provided feedback
  | 'questions_asked'     // Clarifying questions were generated and asked
  | 'questions_answered'  // User answered clarifying questions
  | 'review_started'      // LLM review began
  | 'review_completed'    // LLM review finished
  | 'approval_requested'  // Entered manifest-owned user approval state
  | 'approved'            // User approved
  | 'rejected'            // User or system rejected
  | 'execution_started'   // Began execution
  | 'execution_step'      // A step was executed
  | 'execution_completed' // Execution finished
  | 'execution_failed'    // Execution failed
  | 'outcome_review'      // Post-execution review
  | 'retry_scheduled'     // Desire sent back for retry
  | 'completed'           // Desire marked as complete
  | 'recurring_reset'     // Recurring desire reset to continue
  | 'strength_adjusted'   // Strength manually or automatically adjusted
  | 'user_input'          // User provided direct input
  | 'note';               // General note/observation

/**
 * Scratchpad summary - lightweight stats stored in manifest.
 * Individual entries are stored as separate files in the scratchpad/ folder.
 *
 * Folder structure:
 *   desires/<desire-id>/
 *     manifest.json           # Desire + this summary
 *     scratchpad/
 *       0001-origin.json
 *       0002-reinforcement.json
 *       ...
 *     plans/
 *       v1.json
 *       v2.json
 *     reviews/
 *       review-<desire-id>-v1.json
 *       outcome-001.json
 *     executions/
 *       attempt-001.json
 */
export interface DesireScratchpadSummary {
  /** Total number of scratchpad entries (files in scratchpad/) */
  entryCount: number;
  /** Last entry sequence number */
  lastEntryNumber: number;
  /** Last entry timestamp */
  lastEntryAt?: string;
  /** Last entry type */
  lastEntryType?: DesireScratchpadEntryType;
}

// ============================================================================
// Outcome Review Types - Post-Execution Assessment
// ============================================================================

/**
 * Outcome of post-execution review.
 */
export type OutcomeVerdict =
  | 'completed'    // Desire fully satisfied, can be archived
  | 'continue'     // Keep pursuing (recurring/aspirational)
  | 'retry'        // Try again with new approach
  | 'escalate'     // Needs human intervention
  | 'abandon';     // Cannot be achieved, give up

/**
 * Failure category for diagnostic and routing purposes.
 * The LLM determines this based on error patterns and execution context.
 */
export type FailureCategory =
  | 'none'           // No failure - success
  | 'plan_error'     // Wrong approach/strategy - need different plan
  | 'system_error'   // Internal bug or code error requiring explicit user review
  | 'external_error' // API down, permissions, resources - user needs to help
  | 'timeout'        // Took too long - may need retry or simplification
  | 'partial';       // Some progress but incomplete - may continue or retry

/**
 * Post-execution review by the outcome reviewer agent.
 */
export interface DesireOutcomeReview {
  /** Unique identifier */
  id: string;
  /** The verdict */
  verdict: OutcomeVerdict;
  /** Detailed reasoning for the verdict */
  reasoning: string;
  /** Success score (0-1) - how well was the desire satisfied? */
  successScore: number;
  /** Category of failure (for routing and diagnostics) */
  failureCategory?: FailureCategory;
  /** Specific error type or code if identifiable */
  errorType?: string;
  /** Whether this appears to be a fixable code/system bug */
  isFixableBug?: boolean;
  /** Suggested fix if isFixableBug is true */
  suggestedFix?: string;
  /** Lessons learned from this attempt */
  lessonsLearned: string[];
  /** Suggestions for next attempt (if retry/continue) */
  nextAttemptSuggestions?: string[];
  /** New strength value (for continue/retry) */
  adjustedStrength?: number;
  /** ISO timestamp of review */
  reviewedAt: string;
  /** Whether user should be notified */
  notifyUser: boolean;
  /** Message for user (if notifyUser is true) */
  userMessage?: string;
  /** Whether the completed execution should advance a long-running milestone */
  milestoneAdvance?: boolean;
  /** Whether the long-running desire's ultimate completion criteria were met */
  completionCriteriaMet?: boolean;
  /** Human-readable summary of what was accomplished during execution */
  executionSummary?: string;
}

// ============================================================================
// Clarifying Questions Types
// ============================================================================

/**
 * A clarifying question asked during the planning phase.
 */
export interface ClarifyingQuestion {
  /** Unique identifier for this question */
  id: string;
  /** The question text */
  text: string;
  /** Type of input expected */
  type: 'free_text' | 'yes_no' | 'choice';
  /** Options for choice type questions */
  options?: string[];
  /** Whether an answer is required */
  required: boolean;
}

/**
 * An answer to a clarifying question.
 */
export interface ClarifyingAnswer {
  /** ID of the question being answered */
  questionId: string;
  /** The user's answer */
  answer: string;
  /** ISO timestamp when answered */
  answeredAt: string;
}

/**
 * Clarifying questions phase data for a desire.
 * Used to gather context from the user before generating a plan.
 */
export interface DesireClarifyingQuestions {
  /** When in the lifecycle these questions were asked */
  phase: 'before_planning' | 'during_review';
  /** The questions asked */
  questions: ClarifyingQuestion[];
  /** User's answers */
  answers: ClarifyingAnswer[];
  /** ISO timestamp when questions were generated */
  askedAt?: string;
  /** ISO timestamp when all questions were answered */
  completedAt?: string;
}

/** One immutable observation that affected a desire. */
export interface DesireEvidence {
  id: string;
  kind: 'origin' | 'reinforcement' | 'contradiction' | 'withdrawal' | 'completion';
  source: DesireSource;
  sourceId?: string;
  summary: string;
  observedAt: string;
}

// ============================================================================
// Core Desire Interface
// ============================================================================

/**
 * A desire represents an autonomous intention that the system wants to act on.
 */
export interface Desire {
  /** Unique identifier (desire-<timestamp>-<random>) */
  id: string;

  // Core identity
  /** Brief description (5-10 words) */
  title: string;
  /** Detailed desire description */
  description: string;
  /** Why does the system want this? What need does it fulfill? */
  reason: string;

  // Behavioral metrics - nature emerges from these, not hardcoded types
  /** Metrics tracking the desire's behavior over time */
  metrics: DesireMetrics;

  // Folder-based storage
  /** Path to this desire's folder (relative to desires root) */
  folderPath?: string;

  // Source tracking
  /** Which service/input inspired this desire */
  source: DesireSource;
  /** ID of the originating event/task/goal */
  sourceId?: string;
  /** Relevant data from source for context */
  sourceData?: Record<string, unknown>;
  /** Immutable evidence already applied to this desire. */
  evidence?: DesireEvidence[];

  // Strength & threshold
  /** Current desire strength (0.0 - 1.0) */
  strength: number;
  /** Source-based weight multiplier */
  baseWeight: number;
  /** Activation threshold (default: 0.7) */
  threshold: number;

  // Decay tracking
  /** Strength lost per elapsed day without reinforcement */
  decayRate: number;
  /** ISO timestamp of last evidence or decay review */
  lastReviewedAt: string;
  /** ISO timestamp through which elapsed-time decay has been applied */
  lastDecayAt?: string;
  /** Number of times this desire was reinforced by related inputs */
  reinforcements: number;
  /** Number of generator runs this desire has survived */
  runCount: number;

  // Risk assessment
  /** Assessed risk level */
  risk: DesireRisk;
  /** Minimum trust level required to execute */
  requiredTrustLevel: TrustLevel;

  // Lifecycle
  /** Current status in the lifecycle */
  status: DesireStatus;
  /** Current processing stage (more granular than status) */
  currentStage?: DesireStage;
  /** Per-stage iteration counts */
  stageIterations?: StageIterations;
  /** ISO timestamp when created */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
  /** ISO timestamp when strength crossed threshold */
  activatedAt?: string;
  /** ISO timestamp when completed/rejected/abandoned */
  completedAt?: string;
  /** Explanation for an archived or owner-attention state. */
  dispositionReason?: string;

  // Plan (populated after planning phase)
  /** Current execution plan for this desire */
  plan?: DesirePlan;

  // Plan history (for revision tracking)
  /** Previous plan versions (for comparison during review) */
  planHistory?: DesirePlan[];

  // User critique (for revision requests)
  /** User's critique/feedback for re-planning */
  userCritique?: string;
  /** ISO timestamp when critique was submitted */
  critiqueAt?: string;

  // Clarifying questions (for gathering context before planning)
  /** Questions and answers gathered to improve plan generation */
  clarifyingQuestions?: DesireClarifyingQuestions;

  // Review (populated after review phase)
  /** Review decision for the plan */
  review?: DesireReview;

  // Outcome Review (populated after execution review)
  /** Post-execution outcome review - determines next steps */
  outcomeReview?: DesireOutcomeReview;

  // Scratchpad summary (full log stored as individual files in folder)
  /** Summary of scratchpad - entries are in <folderPath>/scratchpad/ */
  scratchpad?: DesireScratchpadSummary;

  // Execution (populated during/after execution)
  /** Execution state and results */
  execution?: DesireExecution;

  // Rejection tracking
  /** History of rejections (for learning) */
  rejectionHistory?: DesireRejection[];

  // Metadata
  /** Categorization tags */
  tags?: string[];
  /** Owner username */
  userId?: string;

  // Long-Running Goal Support
  /** Goal type: one_time (default), recurring, or long_running */
  goalType?: DesireGoalType;
  /** Specific verifiable condition for true satisfaction (LLM-generated) */
  completionCriteria?: string;
  /** Milestones for long_running desires (user-editable) */
  milestones?: DesireMilestone[];
  /** Progress tracking for long_running desires */
  goalProgress?: DesireGoalProgress;
}

// ============================================================================
// Plan Types
// ============================================================================

/**
 * An execution plan for a desire.
 */
export interface DesirePlan {
  /** Unique identifier */
  id: string;
  /** Version number (1 = original, 2+ = revisions) */
  version: number;
  /** Ordered list of steps to execute */
  steps: PlanStep[];
  /** Overall risk assessment */
  estimatedRisk: DesireRisk;
  /** Skills required for execution */
  requiredSkills: string[];
  /** Minimum trust level for all steps */
  requiredTrustLevel: TrustLevel;
  /** Goal string to pass to the operator */
  operatorGoal: string;
  /** ISO timestamp when plan was created */
  createdAt: string;
  /** User critique that led to this revision (if any) */
  basedOnCritique?: string;
}

/**
 * A single step in an execution plan.
 */
export interface PlanStep {
  /** Execution order (1-based) */
  order: number;
  /** Human-readable action description */
  action: string;
  /** Skill ID to invoke */
  skill?: string;
  /** Input parameters for the skill */
  inputs?: Record<string, unknown>;
  /** Expected outcome of this step */
  expectedOutcome: string;
  /** Risk level of this step */
  risk: DesireRisk;
  /** Whether this step requires explicit approval */
  requiresApproval: boolean;
}

// ============================================================================
// Review Types
// ============================================================================

/**
 * LLM self-review result for a plan.
 */
export interface DesireReview {
  /** Unique identifier */
  id: string;
  /** Review verdict */
  verdict: 'approve' | 'reject' | 'revise';
  /** Reasoning for the verdict */
  reasoning: string;
  /** Specific concerns identified */
  concerns?: string[];
  /** Suggestions for improvement (if revise) */
  suggestions?: string[];
  /** Risk assessment summary */
  riskAssessment: string;
  /** Alignment score with persona values (0-1) */
  alignmentScore: number;
  /** ISO timestamp of review */
  reviewedAt: string;
  /** Exact plan reviewed; prevents a review receipt from crossing plan versions. */
  planId?: string;
  /** Plan version reviewed. */
  planVersion?: number;
  /** Durable policy decision associated with this review. */
  autoApprove?: boolean;
  /** Human-readable policy reason for the automatic/manual decision. */
  autoApproveReason?: string;
}

// ============================================================================
// Execution Types
// ============================================================================

/**
 * Result of executing a single plan step.
 */
export interface StepResult {
  /** Step order that was executed */
  stepOrder: number;
  /** Whether this step succeeded */
  success: boolean;
  /** Result data from the step */
  result?: unknown;
  /** Error message if step failed */
  error?: string;
  /** ISO timestamp when step completed */
  completedAt: string;
}

export interface DesireExecution {
  /** ISO timestamp when execution started */
  startedAt: string;
  /** ISO timestamp when execution completed */
  completedAt?: string;
  /** Current execution status */
  status: 'running' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  /** Operator session ID for tracking */
  operatorSessionId?: string;
  /** Current step being executed (1-based) */
  currentStep?: number;
  /** Number of plan steps completed */
  stepsCompleted?: number;
  /** Total number of plan steps */
  stepsTotal?: number;
  /** Results for each executed step */
  stepResults?: StepResult[];
  /** Execution result (if completed) */
  result?: unknown;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Record of a desire rejection.
 */
export interface DesireRejection {
  /** ISO timestamp of rejection */
  rejectedAt: string;
  /** Who/what rejected it */
  rejectedBy: 'system' | 'user' | 'review';
  /** Reason for rejection */
  reason: string;
  /** Whether the desire can be retried */
  canRetry: boolean;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Source configuration for desire generation.
 */
export interface DesireSourceConfig {
  /** Whether this source is enabled */
  enabled: boolean;
  /** Weight multiplier for desires from this source */
  weight: number;
}

/**
 * Decay configuration for desires.
 * Decay is time-based and idempotent through each desire's lastDecayAt value.
 */
export interface DesireDecayConfig {
  /** Whether decay is enabled */
  enabled: boolean;
  /** Strength lost per elapsed day (small value, e.g., 0.03) */
  ratePerRun: number;
  /** Minimum strength before abandonment */
  minStrength: number;
  /** Strength boost when inputs reinforce an existing desire */
  reinforcementBoost: number;
  /** Initial strength for newly created desires (start small, grow through reinforcement) */
  initialStrength: number;
}

/**
 * Threshold configuration for desires.
 */
export interface DesireThresholdsConfig {
  /** Strength needed to enter evaluation */
  activation: number;
  /** Auto-approve if above this AND low risk */
  autoApprove: number;
  /** Decay settings */
  decay: DesireDecayConfig;
}

/**
 * Limits configuration for agency.
 */
export interface AgencyLimitsConfig {
  /** Maximum active desires at once */
  maxActiveDesires: number;
  /** Maximum pending desires in queue */
  maxPendingDesires: number;
  /** Maximum executions per day */
  maxDailyExecutions: number;
  /** Retention periods in days */
  retentionDays: {
    completed: number;
    rejected: number;
    abandoned: number;
  };
}

/**
 * Risk policy configuration.
 */
/**
 * Review bypass setting for desire approval.
 */
export type ReviewBypassSetting = 'never' | 'trust_based' | 'always';

export interface AgencyRiskPolicyConfig {
  /** Review bypass behavior: 'never' | 'trust_based' | 'always' */
  reviewBypass: ReviewBypassSetting;
  /** Risk levels that can be auto-approved (when reviewBypass is 'trust_based') */
  autoApproveRisk: DesireRisk[];
  /** Risk levels that require approval (when reviewBypass is 'trust_based') */
  requireApprovalRisk: DesireRisk[];
  /** Risk levels that are never executed */
  blockRisk: DesireRisk[];
  /** Minimum trust level for auto-approval */
  autoApproveTrustLevel: TrustLevel;
}

/**
 * Logging configuration for agency.
 */
export interface AgencyLoggingConfig {
  /** Verbose terminal output */
  verbose: boolean;
  /** Log to terminal */
  logToTerminal: boolean;
  /** Log to inner dialogue */
  logToInnerDialogue: boolean;
}

/**
 * Execution configuration for desire execution.
 * Controls canonical execution policy. Runtime capability inventory comes from
 * the Tool Catalog rather than duplicated configuration.
 */
export interface AgencyExecutionConfig {
  /** Preferred backend for desire execution (e.g., 'claude-code', 'codex', 'open-interpreter') */
  preferredBackend: string;
  /** Fallback backend if preferred is unavailable */
  fallbackBackend: string;
  /** Whether to run feasibility check before planning */
  feasibilityCheckEnabled: boolean;
  /** Maximum number of plan retries before abandoning */
  maxPlanRetries: number;
}

/**
 * Complete agency configuration.
 */
export interface AgencyConfig {
  /** Whether agency is enabled */
  enabled: boolean;
  /** Operating mode */
  mode: 'off' | 'supervised' | 'autonomous';
  /** Threshold settings */
  thresholds: DesireThresholdsConfig;
  /** Source configurations */
  sources: Record<DesireSource, DesireSourceConfig>;
  /** Limits */
  limits: AgencyLimitsConfig;
  /** Risk policy */
  riskPolicy: AgencyRiskPolicyConfig;
  /** Execution settings - controls which tool executor backend to use */
  execution: AgencyExecutionConfig;
  /** Logging settings */
  logging: AgencyLoggingConfig;
}

// ============================================================================
// Generator Types
// ============================================================================

/**
 * Inputs gathered for desire generation.
 */
export interface DesireGeneratorInputs {
  /** Explicit goals from persona */
  personaGoals: PersonaGoal[];
  /** High-priority tasks */
  urgentTasks: TaskSummary[];
  /** Regular active tasks */
  activeTasks: TaskSummary[];
  /** Recent episodic memories */
  recentMemories: MemorySummary[];
  /** Identified patterns in memories */
  memoryPatterns: MemoryPattern[];
  /** Pending curiosity questions */
  pendingCuriosityQuestions: CuriosityQuestion[];
  /** Recent reflections */
  recentReflections: ReflectionSummary[];
  /** Recent dreams */
  recentDreams: DreamSummary[];
  /** Current trust level */
  currentTrustLevel: TrustLevel;
  /** Recently rejected desires (to avoid regenerating) */
  recentlyRejected: DesireSummary[];
  /** Currently active desires (to avoid duplicates) */
  activeDesires: DesireSummary[];
}

/**
 * Simplified goal from persona for generation input.
 */
export interface PersonaGoal {
  id: string;
  goal: string;
  status: string;
  priority?: 'short' | 'mid' | 'long';
}

/**
 * Simplified task for generation input.
 */
export interface TaskSummary {
  id: string;
  title: string;
  description?: string;
  priority?: string;
  status: string;
  tags?: string[];
}

/**
 * Simplified memory for generation input.
 */
export interface MemorySummary {
  id: string;
  content: string;
  type?: string;
  timestamp: string;
  tags?: string[];
}

/**
 * A detected pattern in memories.
 */
export interface MemoryPattern {
  id: string;
  description: string;
  frequency: number;
  relatedMemoryIds: string[];
}

/**
 * A pending curiosity question.
 */
export interface CuriosityQuestion {
  id: string;
  question: string;
  askedAt: string;
  topic?: string;
}

/**
 * Simplified reflection for generation input.
 */
export interface ReflectionSummary {
  id: string;
  content: string;
  timestamp: string;
  tags?: string[];
}

/**
 * Simplified dream for generation input.
 */
export interface DreamSummary {
  id: string;
  content: string;
  timestamp: string;
  themes?: string[];
}

/**
 * Simplified desire for duplicate checking.
 */
export interface DesireSummary {
  id: string;
  title: string;
  source: DesireSource;
  status: DesireStatus;
  strength: number;
}

// ============================================================================
// LLM Output Types
// ============================================================================

/**
 * LLM output for desire identification.
 */
export interface DesireCandidate {
  title: string;
  description: string;
  reason: string;
  source: DesireSource;
  sourceId?: string;
  risk: DesireRisk;
  suggestedAction: string;
}

/**
 * LLM output for plan generation.
 */
export interface PlanGenerationOutput {
  steps: Array<{
    order: number;
    action: string;
    skill?: string;
    inputs?: Record<string, unknown>;
    expectedOutcome: string;
    risk: DesireRisk;
    requiresApproval: boolean;
  }>;
  estimatedRisk: DesireRisk;
  operatorGoal: string;
  requiredSkills: string[];
}

/**
 * LLM output for alignment review.
 */
export interface AlignmentReviewOutput {
  alignmentScore: number;
  concerns: string[];
  approved: boolean;
  reasoning: string;
}

/**
 * LLM output for safety review.
 */
export interface SafetyReviewOutput {
  safetyScore: number;
  risks: string[];
  mitigations: string[];
  approved: boolean;
  reasoning: string;
}

// ============================================================================
// Metrics Types
// ============================================================================

/**
 * Agency performance metrics.
 */
export interface AgencyMetrics {
  /** Total desires generated all-time */
  totalGenerated: number;
  /** Total desires completed */
  totalCompleted: number;
  /** Total desires rejected */
  totalRejected: number;
  /** Total desires abandoned (decayed) */
  totalAbandoned: number;
  /** Total desires failed during execution */
  totalFailed: number;
  /** Desires completed today */
  completedToday: number;
  /** Average strength at activation */
  avgActivationStrength: number;
  /** Average time from generation to completion (ms) */
  avgTimeToCompletion: number;
  /** Success rate (completed / attempted) */
  successRate: number;
  /** Last updated timestamp */
  updatedAt: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique desire ID.
 */
export function generateDesireId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `desire-${timestamp}-${random}`;
}

/**
 * Generate a unique plan ID.
 */
export function generatePlanId(desireId: string): string {
  return `plan-${desireId}`;
}

/**
 * Generate a unique review ID.
 */
export function generateReviewId(desireId: string, planVersion?: number): string {
  return planVersion === undefined
    ? `review-${desireId}`
    : `review-${desireId}-v${planVersion}`;
}

/**
 * Get the default weight for a desire source.
 */
export function getSourceWeight(source: DesireSource): number {
  return DESIRE_SOURCE_WEIGHTS[source] ?? 0.5;
}

/**
 * Source weight orders competing desires; it must never make an enabled source
 * mathematically incapable of activation.
 */
export function calculateEffectiveStrength(strength: number, sourceWeight: number): number {
  void sourceWeight;
  return Math.max(0, Math.min(1.0, Number.isFinite(strength) ? strength : 0));
}

/**
 * Check if a desire has crossed the activation threshold.
 */
export function isAboveThreshold(desire: Desire): boolean {
  const effectiveStrength = calculateEffectiveStrength(desire.strength, desire.baseWeight);
  return effectiveStrength >= desire.threshold;
}

/**
 * Apply an already-calculated decay reduction to a desire's strength.
 */
export function applyDecay(
  currentStrength: number,
  decayRate: number,
  minStrength: number
): number {
  return Math.max(minStrength, currentStrength - decayRate);
}

/** Calculate elapsed-time decay without allowing repeated runs to compound it. */
export function calculateElapsedDecay(
  lastDecayAt: string | undefined,
  now: string,
  ratePerDay: number,
): number {
  const previous = Date.parse(lastDecayAt || now);
  const current = Date.parse(now);
  if (!Number.isFinite(previous) || !Number.isFinite(current) || current <= previous) return 0;
  const elapsedDays = (current - previous) / 86_400_000;
  return Math.max(0, ratePerDay) * elapsedDays;
}

/**
 * Apply reinforcement to a desire's strength.
 */
export function applyReinforcement(
  currentStrength: number,
  reinforcementBoost: number
): number {
  return Math.min(1.0, currentStrength + reinforcementBoost);
}

/**
 * Create a new scratchpad entry.
 */
export function createScratchpadEntry(
  type: DesireScratchpadEntryType,
  description: string,
  actor: DesireScratchpadEntry['actor'],
  agentName?: string,
  data?: Record<string, unknown>
): DesireScratchpadEntry {
  return {
    timestamp: new Date().toISOString(),
    type,
    description,
    actor,
    agentName,
    data,
  };
}

/**
 * Initialize a new empty scratchpad summary.
 */
export function initializeScratchpadSummary(): DesireScratchpadSummary {
  return {
    entryCount: 0,
    lastEntryNumber: 0,
  };
}

/**
 * Update scratchpad summary after adding an entry.
 * The actual entry file is written separately by storage functions.
 */
export function updateScratchpadSummary(
  summary: DesireScratchpadSummary | undefined,
  entry: DesireScratchpadEntry
): DesireScratchpadSummary {
  const s = summary || initializeScratchpadSummary();
  return {
    entryCount: s.entryCount + 1,
    lastEntryNumber: s.lastEntryNumber + 1,
    lastEntryAt: entry.timestamp,
    lastEntryType: entry.type,
  };
}

/**
 * Generate scratchpad entry filename.
 * Format: NNNN-type.json (e.g., 0001-origin.json)
 */
export function getScratchpadEntryFilename(entryNumber: number, type: DesireScratchpadEntryType): string {
  const paddedNum = String(entryNumber).padStart(4, '0');
  return `${paddedNum}-${type}.json`;
}

/**
 * Generate a unique outcome review ID.
 */
export function generateOutcomeReviewId(desireId: string): string {
  const timestamp = Date.now();
  return `outcome-review-${desireId}-${timestamp}`;
}
