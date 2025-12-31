/**
 * Active Operator System Types
 *
 * The Active Operator transforms MetaHuman OS from a passive, timer-based
 * scheduler into a proactive, LLM-controlled continuous thinking system.
 */

// ============================================================================
// Task Types
// ============================================================================

/**
 * All possible task types the Active Operator can execute.
 * user_message is always highest priority.
 */
export type TaskType =
  | 'user_message' // User chat message - always processed first
  | 'memory_curate' // Run organizer agent to enrich memories
  | 'training_curate' // Run curator agent to prepare training data
  | 'index_build' // Build/update vector embeddings index
  | 'reflect' // Generate reflections via reflector agent
  | 'curiosity' // Run curiosity service (user-facing questions)
  | 'inner_curiosity' // Run inner curiosity (self-directed Q&A)
  | 'dream' // Generate dreams via dreamer agent
  | 'desire_generate' // Run desire generator
  | 'desire_advance' // Process pending desires through planning/review/approval
  | 'desire_execute' // Execute an APPROVED desire (not pending!)
  | 'psychoanalyze' // Run psychoanalyzer to update persona
  | 'code_analyze'; // Self-healing: analyze codebase for errors

/**
 * Priority levels for queued tasks.
 * Lower numeric value = higher priority.
 */
export type Priority = 'critical' | 'high' | 'normal' | 'low' | 'background';

/**
 * Numeric priority values for sorting.
 */
export const PRIORITY_VALUES: Record<Priority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  background: 4,
};

/**
 * Default priority for each task type.
 */
export const DEFAULT_TASK_PRIORITIES: Record<TaskType, Priority> = {
  user_message: 'critical',
  desire_execute: 'high',
  desire_advance: 'normal', // Process pending desires through approval pipeline
  memory_curate: 'normal',
  training_curate: 'normal', // Curate training data during idle time
  index_build: 'normal',
  reflect: 'normal',
  curiosity: 'normal',
  inner_curiosity: 'low',
  dream: 'low',
  desire_generate: 'low',
  psychoanalyze: 'low',
  code_analyze: 'background',
};

// ============================================================================
// Queue Types
// ============================================================================

/**
 * A task waiting in the queue to be executed.
 */
export interface QueuedTask {
  /** Unique task identifier */
  id: string;

  /** Type of task to execute */
  type: TaskType;

  /** Priority level */
  priority: Priority;

  /** ISO timestamp when task was queued */
  queuedAt: string;

  /** Task-specific payload data */
  payload: TaskPayload;

  /** Optional: username context for the task */
  username?: string;

  /** Number of retry attempts */
  retryCount?: number;

  /** Maximum retries allowed */
  maxRetries?: number;
}

/**
 * Type-safe payloads for different task types.
 */
export type TaskPayload =
  | UserMessagePayload
  | MemoryCuratePayload
  | IndexBuildPayload
  | ReflectPayload
  | CuriosityPayload
  | DreamPayload
  | DesireGeneratePayload
  | DesireAdvancePayload
  | DesireExecutePayload
  | PsychoanalyzePayload
  | CodeAnalyzePayload
  | TriggerPayload;

export interface UserMessagePayload {
  type: 'user_message';
  message: string;
  conversationId?: string;
  sessionId?: string;
}

export interface MemoryCuratePayload {
  type: 'memory_curate';
  maxMemories?: number;
}

export interface IndexBuildPayload {
  type: 'index_build';
  rebuild?: boolean;
}

export interface ReflectPayload {
  type: 'reflect';
  memoryIds?: string[];
}

export interface CuriosityPayload {
  type: 'curiosity';
  isInner?: boolean;
}

export interface DreamPayload {
  type: 'dream';
}

export interface DesireGeneratePayload {
  type: 'desire_generate';
}

export interface DesireAdvancePayload {
  type: 'desire_advance';
  desireId?: string; // Optional: specific desire to advance, or process all pending
}

export interface DesireExecutePayload {
  type: 'desire_execute';
  desireId?: string; // Optional: specific approved desire to execute
}

export interface PsychoanalyzePayload {
  type: 'psychoanalyze';
}

export interface CodeAnalyzePayload {
  type: 'code_analyze';
  targetPaths?: string[];
}

export interface TriggerPayload {
  type: 'trigger';
  triggerId: string;
  reason?: string;
  data?: unknown;
}

// ============================================================================
// Execution Result Types
// ============================================================================

/**
 * Result of executing a queued task.
 */
export interface TaskResult {
  /** The task that was executed */
  taskId: string;

  /** Whether execution succeeded */
  success: boolean;

  /** ISO timestamp when execution completed */
  completedAt: string;

  /** Duration in milliseconds */
  durationMs: number;

  /** Tokens used (if applicable) */
  tokensUsed?: number;

  /** Error message if failed */
  error?: string;

  /** Task-specific result data */
  data?: unknown;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Active Operator configuration stored in etc/active-operator.json
 */
export interface ActiveOperatorConfig {
  /** Master switch - enables/disables active operator */
  enabled: boolean;

  /** Model to use for decision making */
  decisionModel: 'default' | 'persona' | 'fast' | string;

  /** Energy budget configuration */
  energyBudget: {
    /** Whether to enforce budget limits */
    enabled: boolean;
    /** Max tokens per hour (0 = unlimited) */
    tokensPerHour: number;
  };

  /** Which task types are enabled */
  enabledTaskTypes: TaskType[];

  /** Cooldown between tasks in milliseconds */
  cooldownMs: number;

  /** Max consecutive tasks before forcing a pause */
  maxConsecutiveTasks: number;

  /** Enable self-healing code analysis */
  enableSelfHealing: boolean;

  /** Stuck detection timeout in milliseconds */
  stuckTimeoutMs: number;

  /** Max consecutive errors before auto-degrading to passive */
  maxConsecutiveErrors: number;
}

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: ActiveOperatorConfig = {
  enabled: false,
  decisionModel: 'default',
  energyBudget: {
    enabled: false,
    tokensPerHour: 0, // Unlimited by default
  },
  enabledTaskTypes: [
    'user_message',
    'memory_curate',
    'index_build',
    'reflect',
    'curiosity',
    'inner_curiosity',
    'dream',
    'desire_generate',
    'desire_advance',
    'desire_execute',
    'psychoanalyze',
  ],
  cooldownMs: 5000,
  maxConsecutiveTasks: 20,
  enableSelfHealing: true,
  stuckTimeoutMs: 300000, // 5 minutes
  maxConsecutiveErrors: 10,
};

// ============================================================================
// System State Types
// ============================================================================

/**
 * Current system state used by decision engine.
 */
export interface SystemState {
  /** Timestamp when state was gathered */
  gatheredAt: string;

  /** Number of unprocessed memories */
  unprocessedMemories: number;

  /** Hours since last index build */
  indexAgeHours: number;

  /** Number of pending desires (waiting for activation threshold) */
  pendingDesires: number;

  /** Number of pending desires ABOVE activation threshold (can be processed by desire_advance) */
  pendingDesiresReadyToAdvance: number;

  /** Number of active desires (evaluating, planning, reviewing, executing) */
  activeDesires: number;

  /** Number of desires awaiting user approval */
  awaitingApprovalDesires: number;

  /** Number of approved desires ready for autonomous execution */
  approvedDesires: number;

  /** Desire summaries for transparency - shows actual desire names and strengths */
  desireSummaries?: {
    id: string;
    title: string;
    strength: number;
    status: string;
    source?: string;
    readyToAdvance: boolean;
  }[];

  /** Hours since last reflection */
  hoursSinceReflection: number;

  /** Hours since last dream */
  hoursSinceDream: number;

  /** Hours since last psychoanalysis */
  hoursSincePsychoanalysis: number;

  /** Number of items in queue */
  queueLength: number;

  /** Whether user is currently active */
  userActive: boolean;

  /** Current token usage this hour */
  tokensUsedThisHour: number;

  /** TypeScript errors detected (for self-healing) */
  codeErrors?: number;

  /** Current circadian window info (from lizard brain) */
  circadianWindow?: {
    name: string;
    recommendedTasks: TaskType[];
    description: string;
  };

  /** Minutes user has been idle */
  idleMinutes?: number;

  /** Number of files in inbox awaiting ingestion */
  inboxFileCount?: number;

  // ============================================================================
  // Task Metrics (from memory/tasks/active/)
  // ============================================================================

  /** Total number of active tasks */
  activeTasks?: number;

  /** Number of high-priority tasks (P0, P1) */
  highPriorityTasks?: number;

  /** Number of overdue tasks */
  overdueTasks?: number;

  /** Number of tasks in progress */
  inProgressTasks?: number;

  /** Number of blocked tasks */
  blockedTasks?: number;

  // ============================================================================
  // Goal Metrics (from persona/core.json goals)
  // ============================================================================

  /** Number of short-term goals */
  shortTermGoals?: number;

  /** Number of mid-term goals */
  midTermGoals?: number;

  /** Number of long-term goals */
  longTermGoals?: number;

  /** Number of proposed goals awaiting approval */
  proposedGoals?: number;

  /** Number of active goals */
  activeGoals?: number;
}

/**
 * Decision engine output.
 */
export interface TaskDecision {
  /** The task type to execute next */
  task: TaskType;

  /** LLM's reasoning for this choice */
  reasoning: string;

  /** Optional: specific payload for the task */
  payload?: Partial<TaskPayload>;

  /** Confidence score 0-1 */
  confidence?: number;
}

// ============================================================================
// Metrics Types
// ============================================================================

/**
 * Usage metrics for the Active Operator.
 */
export interface OperatorMetrics {
  /** When metrics started being collected */
  startedAt: string;

  /** Total tasks executed */
  totalTasksExecuted: number;

  /** Tasks executed by type */
  tasksByType: Record<TaskType, number>;

  /** Total tokens used */
  totalTokensUsed: number;

  /** Tokens used by hour (for budget tracking) */
  tokensPerHour: Record<string, number>; // ISO hour string -> count

  /** Success/failure counts */
  successCount: number;
  failureCount: number;

  /** Average task duration in ms */
  averageDurationMs: number;

  /** Consecutive errors (resets on success) */
  consecutiveErrors: number;

  /** Last error message */
  lastError?: string;

  /** Last error timestamp */
  lastErrorAt?: string;
}

/**
 * Default metrics values.
 */
export const DEFAULT_METRICS: OperatorMetrics = {
  startedAt: new Date().toISOString(),
  totalTasksExecuted: 0,
  tasksByType: {} as Record<TaskType, number>,
  totalTokensUsed: 0,
  tokensPerHour: {},
  successCount: 0,
  failureCount: 0,
  averageDurationMs: 0,
  consecutiveErrors: 0,
};

// ============================================================================
// Service State Types
// ============================================================================

/**
 * Operator mode.
 */
export type OperatorMode = 'passive' | 'active';

/**
 * Current operator status.
 */
export interface OperatorStatus {
  /** Current mode */
  mode: OperatorMode;

  /** Whether currently executing a task */
  isExecuting: boolean;

  /** Current task being executed */
  currentTask?: QueuedTask;

  /** Queue length */
  queueLength: number;

  /** Last activity timestamp */
  lastActivityAt: string;

  /** Metrics snapshot */
  metrics: OperatorMetrics;

  /** Health status */
  health: 'healthy' | 'degraded' | 'error';

  /** Health message */
  healthMessage?: string;
}
