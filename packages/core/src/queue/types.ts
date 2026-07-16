/**
 * Work coordinator contracts.
 *
 * A work item has one durable lifecycle. Resources constrain capacity; they do
 * not own ordering or lifecycle.
 */

export type ResourceLaneId = 'local-llm' | 'vector-index' | 'remote-llm';
export type WorkResource = ResourceLaneId | 'environment' | 'system' | string;

export type Priority = 'critical' | 'high' | 'normal' | 'low' | 'background';

export const PRIORITY_VALUES: Record<Priority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  background: 4,
};

export type WorkState =
  | 'queued'
  | 'leased'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'needs_review';

export type QueueLifecycleState =
  | 'starting'
  | 'running'
  | 'paused'
  | 'degraded'
  | 'stopping'
  | 'stopped';

export type WorkSource = 'user' | 'system' | 'timer' | 'autonomy' | 'environment';
export type AutonomyMode = 'reactive' | 'semi' | 'full';
export type WorkCognitiveMode = 'dual' | 'agent' | 'emulation' | 'environment';

export type TaskType =
  | 'user_message'
  | 'memory_curate'
  | 'training_curate'
  | 'index_build'
  | 'index_update'
  | 'semantic_search'
  | 'reflect'
  | 'curiosity'
  | 'inner_curiosity'
  | 'dream'
  | 'psychoanalyze'
  | 'mood_review'
  | 'desire_generate'
  | 'desire_execute'
  | 'big_brother_escalation'
  | 'runpod_inference'
  | 'code_analyze'
  | 'environment_command'
  | 'environment_observation'
  | 'sleep_workflow'
  | 'operator_policy'
  | 'custom'
  | 'generic';

export const TASK_LANE_MAP: Record<TaskType, ResourceLaneId> = {
  user_message: 'local-llm',
  memory_curate: 'local-llm',
  training_curate: 'local-llm',
  reflect: 'local-llm',
  curiosity: 'local-llm',
  inner_curiosity: 'local-llm',
  dream: 'local-llm',
  desire_generate: 'local-llm',
  psychoanalyze: 'local-llm',
  mood_review: 'local-llm',
  custom: 'local-llm',
  generic: 'local-llm',
  sleep_workflow: 'local-llm',
  operator_policy: 'local-llm',
  environment_command: 'remote-llm',
  environment_observation: 'local-llm',
  index_build: 'vector-index',
  index_update: 'vector-index',
  semantic_search: 'vector-index',
  big_brother_escalation: 'remote-llm',
  runpod_inference: 'remote-llm',
  desire_execute: 'remote-llm',
  code_analyze: 'remote-llm',
};

export const DEFAULT_PRIORITIES: Record<TaskType, Priority> = {
  user_message: 'critical',
  environment_command: 'normal',
  environment_observation: 'high',
  desire_execute: 'high',
  big_brother_escalation: 'high',
  memory_curate: 'normal',
  training_curate: 'normal',
  index_build: 'normal',
  index_update: 'normal',
  semantic_search: 'normal',
  reflect: 'normal',
  curiosity: 'normal',
  runpod_inference: 'normal',
  custom: 'normal',
  generic: 'normal',
  inner_curiosity: 'low',
  dream: 'low',
  desire_generate: 'low',
  psychoanalyze: 'low',
  mood_review: 'normal',
  sleep_workflow: 'background',
  operator_policy: 'background',
  code_analyze: 'background',
};

export const DEFAULT_HANDLERS: Record<TaskType, string> = {
  user_message: 'chat.persona',
  memory_curate: 'agent.organizer',
  training_curate: 'agent.curator',
  index_build: 'vector.index-build',
  index_update: 'vector.append-event',
  semantic_search: 'vector.semantic-search',
  reflect: 'agent.reflector',
  curiosity: 'agent.curiosity-service',
  inner_curiosity: 'agent.inner-curiosity',
  dream: 'agent.dreamer',
  psychoanalyze: 'agent.psychoanalyzer',
  mood_review: 'agent.mood',
  desire_generate: 'agent.desire-generator',
  desire_execute: 'agent.desire-executor',
  big_brother_escalation: 'remote.big-brother',
  runpod_inference: 'remote.runpod',
  code_analyze: 'agent.coder',
  environment_command: 'environment.command',
  environment_observation: 'environment.observation',
  sleep_workflow: 'workflow.sleep',
  operator_policy: 'operator.policy',
  custom: 'custom',
  generic: 'generic',
};

export interface WorkError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface TaskInput {
  type: TaskType;
  handler?: string;
  resource?: WorkResource;
  source?: WorkSource;
  input: Record<string, any>;
  username: string;
  priority?: Priority;
  cognitiveMode?: WorkCognitiveMode;
  notBefore?: string;
  deadline?: string;
  parentTaskId?: string;
  correlationId?: string;
  idempotencyKey?: string;
  maxAttempts?: number;
  callbackHandler?: string;
  metadata?: Record<string, any>;
}

export interface QueuedTask {
  id: string;
  type: TaskType;
  handler: string;
  state: WorkState;
  priority: Priority;
  source: WorkSource;
  username: string;
  cognitiveMode?: WorkCognitiveMode;
  resource: WorkResource;
  createdAt: string;
  notBefore?: string;
  deadline?: string;
  parentTaskId?: string;
  correlationId?: string;
  idempotencyKey?: string;
  attempt: number;
  maxAttempts: number;
  input: Record<string, any>;
  result?: Record<string, any>;
  error?: WorkError;
  waitingReason?: string;
  wakeAt?: string;
  leaseOwner?: string;
  cancellationRequestedAt?: string;
  cancellationReason?: string;
  startedAt?: string;
  completedAt?: string;
  callbackHandler?: string;
  metadata?: Record<string, any>;
  output?: string[];

}

export interface LaneConfig {
  id?: ResourceLaneId;
  description?: string;
  maxConcurrent: number;
  cooldownMs?: number;
}

export interface ResourceLane {
  config: LaneConfig & { id: ResourceLaneId; cooldownMs: number };
  currentRunning: number;
  lastExecutionAt?: string;
}

export interface RemoteTaskHandle {
  taskId: string;
  provider: string;
  startedAt: string;
  timeoutMs: number;
  abortController?: AbortController;
}

export interface RemoteResult {
  taskId: string;
  success: boolean;
  output: any;
  durationMs: number;
  followUpTasks?: TaskInput[];
  updateBuffer?: boolean;
  saveMemory?: boolean;
  memoryType?: 'inner_dialogue' | 'conversation' | 'observation';
  memoryTags?: string[];
}

export interface QueueConfig {
  enabled: boolean;
  lanes: Record<ResourceLaneId, LaneConfig>;
  execution?: {
    staleTaskTimeoutMs?: number;
    maxAttempts?: number;
  };
}

export interface QueueState {
  items?: QueuedTask[];
  history?: QueuedTask[];
  inFlightRemote: RemoteTaskHandle[];
  lastUpdated: string;
}

export interface PersistedQueueState extends QueueState {
  savedAt: string;
  version: number;
}

export type QueueEventType =
  | 'task_enqueued'
  | 'task_started'
  | 'task_waiting'
  | 'task_output'
  | 'task_completed'
  | 'task_failed'
  | 'task_retried'
  | 'task_cancel_requested'
  | 'task_cancelled'
  | 'task_expired'
  | 'task_reordered'
  | 'task_deleted'
  | 'remote_dispatched'
  | 'remote_callback'
  | 'lane_cleared'
  | 'lane_blocked'
  | 'lane_unblocked';

export interface QueueEvent {
  type: QueueEventType;
  timestamp: string;
  taskId?: string;
  lane?: ResourceLaneId;
  details?: Record<string, any>;
}

export type QueueEventListener = (event: QueueEvent) => void;
