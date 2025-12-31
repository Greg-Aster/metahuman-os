/**
 * Unified Queue System - Type Definitions
 *
 * Resource-aware queue with three lanes:
 * - local-llm: Sequential execution (GPU contention)
 * - vector-index: Always available (CPU, bypass queue)
 * - remote-llm: Non-blocking (fire and callback)
 */

// Resource lane identifiers
export type ResourceLaneId = 'local-llm' | 'vector-index' | 'remote-llm';

// Priority levels (lower number = higher priority)
export type Priority = 'critical' | 'high' | 'normal' | 'low' | 'background';

export const PRIORITY_VALUES: Record<Priority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  background: 4,
};

// All task types in the system
export type TaskType =
  // User-facing
  | 'user_message'
  // Memory operations
  | 'memory_curate'    // organizer: enriches memories with tags/entities
  | 'training_curate'  // curator: prepares memories for LLM training
  | 'index_build'
  | 'semantic_search'
  // Cognitive agents
  | 'reflect'
  | 'curiosity'
  | 'inner_curiosity'
  | 'dream'
  | 'psychoanalyze'
  // Agency system
  | 'desire_generate'
  | 'desire_execute'
  // Remote/escalation
  | 'big_brother_escalation'
  | 'runpod_inference'
  | 'code_analyze'
  // Generic
  | 'custom'
  | 'generic';

// Task-to-lane mapping
export const TASK_LANE_MAP: Record<TaskType, ResourceLaneId> = {
  // Local LLM lane (sequential, GPU)
  user_message: 'local-llm',
  memory_curate: 'local-llm',
  training_curate: 'local-llm',
  reflect: 'local-llm',
  curiosity: 'local-llm',
  inner_curiosity: 'local-llm',
  dream: 'local-llm',
  desire_generate: 'local-llm',
  psychoanalyze: 'local-llm',
  custom: 'local-llm',
  generic: 'local-llm',

  // Vector index lane (always available, CPU)
  index_build: 'vector-index',
  semantic_search: 'vector-index',

  // Remote LLM lane (non-blocking)
  big_brother_escalation: 'remote-llm',
  runpod_inference: 'remote-llm',
  desire_execute: 'remote-llm',
  code_analyze: 'remote-llm',
};

// Default priorities by task type
export const DEFAULT_PRIORITIES: Record<TaskType, Priority> = {
  user_message: 'critical',
  desire_execute: 'high',
  memory_curate: 'normal',
  training_curate: 'normal',
  index_build: 'normal',
  semantic_search: 'normal',
  reflect: 'normal',
  curiosity: 'normal',
  inner_curiosity: 'low',
  dream: 'low',
  desire_generate: 'low',
  psychoanalyze: 'low',
  big_brother_escalation: 'high',
  runpod_inference: 'normal',
  code_analyze: 'background',
  custom: 'normal',
  generic: 'normal',
};

// Task input (what callers provide)
export interface TaskInput {
  type: TaskType;
  payload: Record<string, any>;
  username: string;
  priority?: Priority;
  deadline?: string;
  callbackHandler?: string;
  metadata?: Record<string, any>;
}

// Queued task (enriched with system fields)
export interface QueuedTask {
  id: string;
  type: TaskType;
  priority: Priority;
  resourceLane: ResourceLaneId;
  queuedAt: string;
  payload: Record<string, any>;
  username: string;

  // Retry handling
  retryCount: number;
  maxRetries: number;

  // Optional fields
  deadline?: string;
  estimatedDurationMs?: number;
  callbackHandler?: string;
  metadata?: Record<string, any>;

  // Execution tracking
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

// Resource lane configuration
export interface LaneConfig {
  id: ResourceLaneId;
  maxConcurrent: number;
  cooldownMs: number;
  bypassQueue?: boolean;
  backends?: string[];
  providers?: string[];
  callbackTimeoutMs?: number;
}

// Resource lane runtime state
export interface ResourceLane {
  config: LaneConfig;
  currentRunning: number;
  lastExecutionAt?: string;
  tasks: QueuedTask[];
}

// Remote task handle (for in-flight tracking)
export interface RemoteTaskHandle {
  taskId: string;
  provider: string;
  startedAt: string;
  timeoutMs: number;
  abortController?: AbortController;
}

// Remote task result (returned by callbacks)
export interface RemoteResult {
  taskId: string;
  success: boolean;
  output: any;
  durationMs: number;

  // Chain triggers
  followUpTasks?: TaskInput[];
  updateBuffer?: boolean;
  saveMemory?: boolean;
  memoryType?: 'inner_dialogue' | 'conversation' | 'observation';
  memoryTags?: string[];
}

// Trigger types (from agents.json)
export type TriggerType = 'interval' | 'activity' | 'time-of-day' | 'event';

// Trigger configuration
export interface TriggerConfig {
  id: string;
  type: TriggerType;
  taskType: TaskType;
  priority?: Priority;
  enabled: boolean;

  // Type-specific
  intervalMs?: number;
  inactivityMs?: number;
  timeOfDay?: string;
  eventName?: string;

  // Lane override (usually auto-detected)
  lane?: ResourceLaneId;
}

// Queue configuration (etc/queue.json)
export interface QueueConfig {
  enabled: boolean;
  lanes: {
    'local-llm': LaneConfig;
    'vector-index': LaneConfig;
    'remote-llm': LaneConfig;
  };
  triggers: Record<string, TriggerConfig>;
  priorities: Record<Priority, { maxWaitMs: number | null }>;
  defaults: {
    maxRetries: number;
    defaultTimeoutMs: number;
  };
}

// Queue state (for persistence)
export interface QueueState {
  lanes: {
    'local-llm': QueuedTask[];
    'vector-index': QueuedTask[];
    'remote-llm': QueuedTask[];
  };
  inFlightRemote: RemoteTaskHandle[];
  lastUpdated: string;
}

// Persisted queue state (for disk storage with versioning)
export interface PersistedQueueState extends QueueState {
  savedAt: string;
  version: number;
}

// Current task being executed (for crash recovery)
export interface PersistedCurrentTask {
  task: QueuedTask;
  startedAt: string;
  lane: ResourceLaneId;
}

// Queue events (for observability)
export type QueueEventType =
  | 'task_enqueued'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'task_retried'
  | 'remote_dispatched'
  | 'remote_callback'
  | 'lane_blocked'
  | 'lane_unblocked';

export interface QueueEvent {
  type: QueueEventType;
  timestamp: string;
  taskId?: string;
  lane?: ResourceLaneId;
  details?: Record<string, any>;
}

// Queue listener callback
export type QueueEventListener = (event: QueueEvent) => void;
