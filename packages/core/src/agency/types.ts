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
  | 'persona_goal'      // Explicit goals from persona/core.json (weight: 1.0)
  | 'urgent_task'       // High-priority tasks (weight: 0.85)
  | 'task'              // Regular tasks (weight: 0.7)
  | 'memory_pattern'    // Recurring patterns from episodic memory (weight: 0.5)
  | 'curiosity'         // From curiosity service questions (weight: 0.4)
  | 'reflection'        // From reflector insights (weight: 0.35)
  | 'dream'             // Dream-inspired desires (weight: 0.3)
  | 'tool_suggestion';  // From tool/skill outputs (weight: 0.25)

/**
 * Default weights for each desire source.
 */
export const DESIRE_SOURCE_WEIGHTS: Record<DesireSource, number> = {
  persona_goal: 1.0,
  urgent_task: 0.85,
  task: 0.7,
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
  | 'reviewing'         // Plan is under LLM self-review
  | 'awaiting_approval' // In approval queue (high-risk)
  | 'approved'          // Ready for execution
  | 'executing'         // Currently being executed
  | 'completed'         // Successfully executed
  | 'rejected'          // User rejected or LLM review rejected
  | 'abandoned'         // Decayed below threshold
  | 'failed';           // Execution failed

/**
 * Risk levels for desires and plan steps.
 */
export type DesireRisk = 'none' | 'low' | 'medium' | 'high' | 'critical';

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

  // Source tracking
  /** Which service/input inspired this desire */
  source: DesireSource;
  /** ID of the originating event/task/goal */
  sourceId?: string;
  /** Relevant data from source for context */
  sourceData?: Record<string, unknown>;

  // Strength & threshold
  /** Current desire strength (0.0 - 1.0) */
  strength: number;
  /** Source-based weight multiplier */
  baseWeight: number;
  /** Activation threshold (default: 0.7) */
  threshold: number;

  // Decay tracking (run-based, not time-based)
  /** How much strength decays per generator run */
  decayRate: number;
  /** ISO timestamp of last generator run that reviewed this desire */
  lastReviewedAt: string;
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
  /** ISO timestamp when created */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;
  /** ISO timestamp when strength crossed threshold */
  activatedAt?: string;
  /** ISO timestamp when completed/rejected/abandoned */
  completedAt?: string;

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

  // Review (populated after review phase)
  /** Review decision for the plan */
  review?: DesireReview;

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
}

// ============================================================================
// Execution Types
// ============================================================================

/**
 * Execution state for a desire.
 */
export interface DesireExecution {
  /** ISO timestamp when execution started */
  startedAt: string;
  /** ISO timestamp when execution completed */
  completedAt?: string;
  /** Current execution status */
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  /** Operator session ID for tracking */
  operatorSessionId?: string;
  /** Number of plan steps completed */
  stepsCompleted: number;
  /** Total number of plan steps */
  stepsTotal: number;
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
 * Decay is run-based: applied once per generator run, not time-based.
 */
export interface DesireDecayConfig {
  /** Whether decay is enabled */
  enabled: boolean;
  /** Strength lost per generator run (small value, e.g., 0.03) */
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
 * Scheduling configuration for agency agents.
 */
export interface AgencySchedulingConfig {
  /** How often to generate desires (minutes) */
  generatorIntervalMinutes: number;
  /** How often to evaluate queue (minutes) */
  evaluatorIntervalMinutes: number;
  /** How often to apply decay (minutes) */
  decayIntervalMinutes: number;
  /** Only run when system is idle */
  idleOnly: boolean;
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
export interface AgencyRiskPolicyConfig {
  /** Risk levels that can be auto-approved */
  autoApproveRisk: DesireRisk[];
  /** Risk levels that require approval */
  requireApprovalRisk: DesireRisk[];
  /** Risk levels that are never executed */
  blockRisk: DesireRisk[];
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
  /** Scheduling settings */
  scheduling: AgencySchedulingConfig;
  /** Limits */
  limits: AgencyLimitsConfig;
  /** Risk policy */
  riskPolicy: AgencyRiskPolicyConfig;
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
  initialStrength: number;
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
export function generateReviewId(desireId: string): string {
  return `review-${desireId}`;
}

/**
 * Get the default weight for a desire source.
 */
export function getSourceWeight(source: DesireSource): number {
  return DESIRE_SOURCE_WEIGHTS[source] ?? 0.5;
}

/**
 * Calculate effective strength with source weight.
 */
export function calculateEffectiveStrength(strength: number, sourceWeight: number): number {
  return Math.min(1.0, strength * sourceWeight);
}

/**
 * Check if a desire has crossed the activation threshold.
 */
export function isAboveThreshold(desire: Desire): boolean {
  const effectiveStrength = calculateEffectiveStrength(desire.strength, desire.baseWeight);
  return effectiveStrength >= desire.threshold;
}

/**
 * Apply run-based decay to a desire's strength.
 * Called once per generator run for desires not reinforced.
 */
export function applyDecay(
  currentStrength: number,
  decayRate: number,
  minStrength: number
): number {
  return Math.max(minStrength, currentStrength - decayRate);
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
