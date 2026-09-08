import type { RobotStatusTask } from '../robot-status.js'

/** Durable execution identity is independent of conversation, jobs and body actions. */
export interface ExecutionDefinition {
  graphId: string
  graphHash: string
  runtimeVersion: string
  checkpointSchemaVersion: number
  nodeVersions: Record<string, string>
}

export type ExecutionStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'

export interface ExecutionObjective extends RobotStatusTask {
  objectiveId: string
  executionId: string
  completionCriteria: string
  desireId?: string
}

export interface ExecutionRecord {
  executionId: string
  username: string
  /** Coordinator lifetime in which this execution was originally admitted. */
  originRuntimeId?: string
  definition: ExecutionDefinition
  status: ExecutionStatus
  waitingReason?: string
  checkpointVersion: number
  lastSequence: number
  lastProcessedSequence: number
  createdAt: number
  updatedAt: number
  cancelledAt: number | null
  owner: string | null
  ownerGeneration: number
  leaseUntil: number | null
}

export interface ExecutionEvent {
  eventId: string
  executionId: string
  sequence: number
  kind: string
  payload: unknown
  createdAt: number
  parentEventId?: string
  actionId?: string
  workItemId?: string
}

export interface NewExecutionEvent {
  eventId: string
  kind: string
  payload: unknown
  parentEventId?: string
  actionId?: string
  workItemId?: string
}

export interface ExecutionLease {
  executionId: string
  owner: string
  generation: number
}

export interface DispatchIntent {
  /** Stable across relay retries; different from the Coordinator's workItemId. */
  effectId: string
  kind: string
  payload: unknown
  actionId?: string
}

export interface DispatchRecord extends DispatchIntent {
  executionId: string
  status: 'pending' | 'admitted' | 'accepted' | 'completed' | 'outcome_unknown' | 'cancelled'
  workItemId: string | null
  checkpointId: string
  /** Writer generation this resume attempt may settle; absent on pre-migration receipts. */
  attemptGeneration?: number
}

/** Committed with a LangGraph checkpoint, never independently after a node. */
export interface CheckpointTransition {
  transitionId: string
  processedEventIds?: string[]
  events?: NewExecutionEvent[]
  dispatches?: DispatchIntent[]
  status?: ExecutionStatus
  task?: ExecutionObjective
  frames?: import('../environment-interface/types.js').EnvironmentVisualFrame[]
}

export class ExecutionConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecutionConflictError'
  }
}

export class ExecutionBusyError extends ExecutionConflictError {
  constructor(readonly retryAt: number) { super('Execution already has a live writer'); this.name = 'ExecutionBusyError' }
}

export class ExecutionCancelledError extends Error {
  constructor(executionId: string) {
    super(`Execution ${executionId} is cancelled`)
    this.name = 'ExecutionCancelledError'
  }
}

export class ExecutionDeliveryError extends Error {
  constructor(cause: unknown) {
    super(`Committed dispatch is awaiting Coordinator admission: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    this.name = 'ExecutionDeliveryError'
  }
}
