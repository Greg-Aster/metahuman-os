import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  ExecutionCancelledError, ExecutionConflictError, ExecutionBusyError,
  type CheckpointTransition, type DispatchIntent, type DispatchRecord,
  type ExecutionDefinition, type ExecutionEvent, type ExecutionLease,
  type ExecutionRecord, type NewExecutionEvent,
} from './types.js'

type ClaimedActionReceipt = Pick<import('../queue/types.js').QueuedTask,
  'id' | 'type' | 'handler' | 'state' | 'username' | 'input' | 'durable' | 'startedAt' | 'bodyLease'>

interface ActionResultEvidence {
  /** Compare-and-set against a specifically identified local delivery conclusion. */
  reconcilesEventId?: string
  /** A late transport diagnostic cannot replace a verified physical result. */
  deliveryOnly?: boolean
}

/** Stable serialization for identity/conflict checks, not semantic interpretation. */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const result = JSON.stringify(value)
    if (result === undefined) throw new Error('Durable values must be JSON serializable')
    return result
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`
  return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => `${JSON.stringify(key)}:${canonicalJSON(v)}`).join(',')}}`
}

export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJSON(value)).digest('hex')
}

/**
 * The graph checkpointer's database, not a second job queue. SQLite owns event
 * order, checkpoint heads and outbound intent. Work Coordinator owns admitted
 * job lifecycle; its receipt is attached here by the idempotent relay.
 */
export class ExecutionStore {
  readonly db: Database.Database

  constructor(filename: string, readonly codec = { encode: canonicalJSON, decode: JSON.parse as (text: string) => any },
    private readonly originRuntimeId?: string) {
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 })
    this.db = new Database(filename)
    if (filename !== ':memory:') fs.chmodSync(filename, 0o600)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = FULL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('busy_timeout = 5000')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS executions (
        execution_id TEXT PRIMARY KEY, username TEXT NOT NULL, definition TEXT NOT NULL,
        status TEXT NOT NULL, checkpoint_version INTEGER NOT NULL DEFAULT 0,
        last_sequence INTEGER NOT NULL DEFAULT 0, processed_sequence INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, cancelled_at INTEGER,
        owner TEXT, owner_generation INTEGER NOT NULL DEFAULT 0, lease_until INTEGER, origin_runtime_id TEXT
      );
      CREATE TABLE IF NOT EXISTS execution_events (
        execution_id TEXT NOT NULL REFERENCES executions(execution_id) ON DELETE CASCADE,
        event_id TEXT NOT NULL, sequence INTEGER NOT NULL, kind TEXT NOT NULL,
        payload TEXT NOT NULL, identity TEXT NOT NULL, parent_event_id TEXT,
        action_id TEXT, work_item_id TEXT, created_at INTEGER NOT NULL,
        PRIMARY KEY(execution_id, event_id), UNIQUE(execution_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS execution_waits (
        execution_id TEXT PRIMARY KEY REFERENCES executions(execution_id) ON DELETE CASCADE,
        reason TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS execution_retirements (
        execution_id TEXT PRIMARY KEY, retired_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS execution_heads (
        execution_id TEXT NOT NULL REFERENCES executions(execution_id) ON DELETE CASCADE,
        namespace TEXT NOT NULL, checkpoint_id TEXT NOT NULL,
        PRIMARY KEY(execution_id, namespace)
      );
      CREATE TABLE IF NOT EXISTS execution_transitions (
        execution_id TEXT NOT NULL REFERENCES executions(execution_id) ON DELETE CASCADE,
        transition_id TEXT NOT NULL, identity TEXT NOT NULL,
        PRIMARY KEY(execution_id, transition_id)
      );
      CREATE TABLE IF NOT EXISTS execution_graphs (
        execution_id TEXT NOT NULL REFERENCES executions(execution_id) ON DELETE CASCADE,
        invocation_id TEXT NOT NULL, definition TEXT NOT NULL,
        PRIMARY KEY(execution_id, invocation_id)
      );
      CREATE TABLE IF NOT EXISTS execution_entries (
        execution_id TEXT PRIMARY KEY REFERENCES executions(execution_id) ON DELETE CASCADE,
        admission_key TEXT NOT NULL UNIQUE, bootstrap TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS execution_task (
        execution_id TEXT PRIMARY KEY REFERENCES executions(execution_id) ON DELETE CASCADE,
        checkpoint_id TEXT NOT NULL, task TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS execution_frames (
        execution_id TEXT NOT NULL REFERENCES executions(execution_id) ON DELETE CASCADE,
        frame_id TEXT NOT NULL, identity TEXT NOT NULL, frame TEXT NOT NULL,
        PRIMARY KEY(execution_id, frame_id)
      );
      CREATE TABLE IF NOT EXISTS execution_outbox (
        effect_id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL REFERENCES executions(execution_id) ON DELETE CASCADE,
        checkpoint_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
        identity TEXT NOT NULL, action_id TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending', work_item_id TEXT, attempt_generation INTEGER
      );
      CREATE TABLE IF NOT EXISTS execution_blobs (
        hash TEXT PRIMARY KEY, value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS execution_blob_refs (
        execution_id TEXT NOT NULL REFERENCES executions(execution_id) ON DELETE CASCADE,
        hash TEXT NOT NULL REFERENCES execution_blobs(hash), PRIMARY KEY(execution_id, hash)
      );
      CREATE INDEX IF NOT EXISTS execution_event_order ON execution_events(execution_id, sequence);
      CREATE INDEX IF NOT EXISTS execution_dispatch_state ON execution_outbox(execution_id, status);
    `)
    this.db.transaction(() => {
      if (!(this.db.pragma('table_info(executions)') as { name: string }[]).some(column => column.name === 'origin_runtime_id')) {
        this.db.exec('ALTER TABLE executions ADD COLUMN origin_runtime_id TEXT')
      }
      if (!(this.db.pragma('table_info(execution_outbox)') as { name: string }[]).some(column => column.name === 'attempt_generation')) {
        this.db.exec('ALTER TABLE execution_outbox ADD COLUMN attempt_generation INTEGER')
      }
    }).immediate()
  }

  close(): void { this.db.close() }

  retirements(): string[] {
    return (this.db.prepare('SELECT execution_id FROM execution_retirements').all() as { execution_id: string }[]).map(row => row.execution_id)
  }

  isRetired(executionId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM execution_retirements WHERE execution_id=?').get(executionId))
  }

  acknowledgeRetirement(executionId: string): void {
    this.db.prepare('DELETE FROM execution_retirements WHERE execution_id=?').run(executionId)
  }

  enter(username: string, definition: ExecutionDefinition, admissionKey: string, bootstrap: unknown): ExecutionRecord {
    return this.db.transaction(() => {
      const key = `${username}:${admissionKey}`
      const previous = this.db.prepare('SELECT execution_id FROM execution_entries WHERE admission_key = ?').get(key) as any
      if (previous) {
        this.assertDefinition(previous.execution_id, definition)
        return this.get(previous.execution_id)
      }
      const record = this.create(username, definition)
      this.db.prepare('INSERT INTO execution_entries VALUES (?, ?, ?)')
        .run(record.executionId, key, this.encodeDocument(record.executionId, bootstrap))
      return record
    }).immediate()
  }

  entry(executionId: string): any {
    const entry = this.db.prepare('SELECT bootstrap FROM execution_entries WHERE execution_id = ?').get(executionId) as any
    if (!entry) throw new Error(`Execution ${executionId} has no admitted input`)
    return this.decodeDocument(entry.bootstrap)
  }

  task(executionId: string): import('./types.js').ExecutionObjective | null {
    const row = this.db.prepare('SELECT task FROM execution_task WHERE execution_id = ?').get(executionId) as any
    return row ? this.decodeDocument(row.task) : null
  }

  /** Dashboard selection only. Task meaning remains in the execution checkpoint. */
  projectedTask(username: string): import('./types.js').ExecutionObjective | null {
    const candidates = this.list(username).flatMap(record => {
      const task = this.task(record.executionId)
      if (!task) return []
      return [{ record, task: { ...task, executionStatus: record.status } }]
    })
    candidates.sort((a, b) => {
      const active = (candidate: typeof a) => ['running', 'waiting'].includes(candidate.record.status)
        && !candidate.task.decision.objectiveComplete && !['abandon', 'cancel'].includes(candidate.task.decision.outcome)
      return Number(active(b)) - Number(active(a)) || b.task.updatedAt.localeCompare(a.task.updatedAt)
    })
    return candidates[0]?.task ?? null
  }

  frame(executionId: string, frameId: string): import('../environment-interface/types.js').EnvironmentVisualFrame | null {
    const row = this.db.prepare('SELECT frame FROM execution_frames WHERE execution_id = ? AND frame_id = ?').get(executionId, frameId) as any
    return row ? this.decodeDocument(row.frame) : null
  }

  /** Run status is a projection of the committed root checkpoint, not an objective decision. */
  settle(lease: ExecutionLease, status: 'completed' | 'waiting' | 'failed', waitingReason?: string): void {
    this.db.transaction(() => {
      this.assertLease(lease)
      const record = this.get(lease.executionId)
      if (record.cancelledAt !== null) return
      if (['completed', 'failed'].includes(record.status)) {
        if (record.status !== status) throw new ExecutionConflictError('A terminal execution cannot be revived')
        return
      }
      const pending = this.db.prepare(`SELECT 1 FROM execution_outbox WHERE execution_id = ?
        AND kind != 'graph_resume' AND status IN ('pending','admitted','accepted','outcome_unknown') LIMIT 1`).get(lease.executionId)
      this.db.prepare('UPDATE executions SET status = ?, updated_at = ? WHERE execution_id = ?')
        .run(status === 'completed' && pending ? 'waiting' : status, Date.now(), lease.executionId)
      if (this.get(lease.executionId).status === 'waiting') {
        this.db.prepare('INSERT INTO execution_waits VALUES (?, ?) ON CONFLICT(execution_id) DO UPDATE SET reason=excluded.reason')
          .run(lease.executionId, waitingReason ?? 'effect_delivery')
      } else this.db.prepare('DELETE FROM execution_waits WHERE execution_id=?').run(lease.executionId)
      this.settleFinishedDispatches(lease.executionId)
    }).immediate()
  }

  create(username: string, definition: ExecutionDefinition, executionId = randomUUID()): ExecutionRecord {
    if (!username.trim() || !definition.graphId || !definition.graphHash || !definition.runtimeVersion
      || !Number.isInteger(definition.checkpointSchemaVersion)) throw new Error('Incomplete execution identity')
    const now = Date.now()
    this.db.prepare(`INSERT INTO executions
      (execution_id, username, definition, status, created_at, updated_at, origin_runtime_id) VALUES (?, ?, ?, 'running', ?, ?, ?)`)
      .run(executionId, username, this.codec.encode(definition), now, now, this.originRuntimeId ?? null)
    return this.get(executionId)
  }

  get(executionId: string): ExecutionRecord {
    const row = this.db.prepare('SELECT e.*, w.reason AS waiting_reason FROM executions e LEFT JOIN execution_waits w USING(execution_id) WHERE e.execution_id = ?').get(executionId) as any
    if (!row) throw new Error(`Unknown execution ${executionId}`)
    return {
      executionId: row.execution_id, username: row.username, definition: this.codec.decode(row.definition),
      originRuntimeId: row.origin_runtime_id ?? undefined,
      status: row.status, waitingReason: row.waiting_reason ?? undefined, checkpointVersion: row.checkpoint_version, lastSequence: row.last_sequence,
      lastProcessedSequence: row.processed_sequence, createdAt: row.created_at, updatedAt: row.updated_at,
      cancelledAt: row.cancelled_at, owner: row.owner, ownerGeneration: row.owner_generation,
      leaseUntil: row.lease_until,
    }
  }

  list(username?: string): ExecutionRecord[] {
    const rows = (username
      ? this.db.prepare('SELECT execution_id FROM executions WHERE username = ? ORDER BY created_at').all(username)
      : this.db.prepare('SELECT execution_id FROM executions ORDER BY created_at').all()) as any[]
    return rows.map(row => this.get(row.execution_id))
  }

  assertDefinition(executionId: string, executable: ExecutionDefinition): void {
    if (canonicalJSON(this.get(executionId).definition) !== canonicalJSON(executable)) {
      throw new ExecutionConflictError('Saved execution does not match the executable graph/schema/node versions')
    }
  }

  /** Child invocations share this execution; each pins the actual executable it first enters. */
  pinGraph(lease: ExecutionLease, invocationId: string, executable: ExecutionDefinition): void {
    this.db.transaction(() => {
      this.assertLease(lease)
      const previous = this.db.prepare('SELECT definition FROM execution_graphs WHERE execution_id = ? AND invocation_id = ?')
        .get(lease.executionId, invocationId) as any
      if (previous) {
        if (canonicalJSON(this.codec.decode(previous.definition)) !== canonicalJSON(executable)) {
          throw new ExecutionConflictError('Saved child graph does not match its executable definition')
        }
      } else {
        this.db.prepare('INSERT INTO execution_graphs VALUES (?, ?, ?)')
          .run(lease.executionId, invocationId, this.codec.encode(executable))
      }
    }).immediate()
  }

  claim(executionId: string, executable: ExecutionDefinition, owner = randomUUID(), leaseMs = 30_000,
    resumeAttempt?: { effectId: string; workItemId: string }): ExecutionLease {
    return this.db.transaction(() => {
      this.assertDefinition(executionId, executable)
      const state = this.get(executionId)
      if (state.cancelledAt !== null) throw new ExecutionCancelledError(executionId)
      if (state.status === 'completed' || state.status === 'failed') throw new ExecutionConflictError('Execution is terminal')
      const now = Date.now()
      if (state.owner && state.leaseUntil! > now) throw new ExecutionBusyError(state.leaseUntil!)
      const generation = state.ownerGeneration + 1
      this.db.prepare('UPDATE executions SET owner = ?, owner_generation = ?, lease_until = ? WHERE execution_id = ?')
        .run(owner, generation, now + leaseMs, executionId)
      if (resumeAttempt) {
        const dispatch = this.dispatch(resumeAttempt.effectId)
        if (dispatch.executionId !== executionId || dispatch.kind !== 'graph_resume'
          || dispatch.workItemId !== resumeAttempt.workItemId || dispatch.status !== 'accepted') {
          throw new ExecutionConflictError('Resume writer does not match its accepted Coordinator receipt')
        }
        this.db.prepare('UPDATE execution_outbox SET attempt_generation=? WHERE effect_id=?')
          .run(generation, dispatch.effectId)
      }
      return { executionId, owner, generation }
    }).immediate()
  }

  assertLease(lease: ExecutionLease): void {
    const state = this.get(lease.executionId)
    if (state.owner !== lease.owner || state.ownerGeneration !== lease.generation || (state.leaseUntil ?? 0) <= Date.now()) {
      throw new ExecutionConflictError('Stale execution writer')
    }
  }

  renew(lease: ExecutionLease, leaseMs = 30_000): void {
    this.db.transaction(() => {
      this.assertLease(lease)
      this.db.prepare('UPDATE executions SET lease_until = ? WHERE execution_id = ?')
        .run(Date.now() + leaseMs, lease.executionId)
    }).immediate()
  }

  release(lease: ExecutionLease): void {
    this.db.prepare(`UPDATE executions SET owner = NULL, lease_until = NULL
      WHERE execution_id = ? AND owner = ? AND owner_generation = ?`)
      .run(lease.executionId, lease.owner, lease.generation)
  }

  appendEvent(executionId: string, event: NewExecutionEvent): ExecutionEvent {
    return this.db.transaction(() => this.insertEvent(executionId, event)).immediate()
  }

  private insertEvent(executionId: string, event: NewExecutionEvent): ExecutionEvent {
    if (!event.eventId || !event.kind) throw new Error('Execution event needs an identity and kind')
    const identity = contentHash(event)
    const previous = this.db.prepare('SELECT identity FROM execution_events WHERE execution_id = ? AND event_id = ?')
      .get(executionId, event.eventId) as { identity: string } | undefined
    if (previous) {
      if (previous.identity !== identity) throw new ExecutionConflictError('Event ID reused with different content')
      return this.event(executionId, event.eventId)
    }
    const row = this.db.prepare(`UPDATE executions SET last_sequence = last_sequence + 1, updated_at = ?
      WHERE execution_id = ? RETURNING last_sequence`).get(Date.now(), executionId) as any
    if (!row) throw new Error(`Unknown execution ${executionId}`)
    this.db.prepare(`INSERT INTO execution_events
      (execution_id, event_id, sequence, kind, payload, identity, parent_event_id, action_id, work_item_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(executionId, event.eventId, row.last_sequence, event.kind, this.encodeDocument(executionId, event.payload), identity,
        event.parentEventId ?? null, event.actionId ?? null, event.workItemId ?? null, Date.now())
    return this.event(executionId, event.eventId)
  }

  findEvent(executionId: string, eventId: string): ExecutionEvent | null {
    const row = this.db.prepare('SELECT * FROM execution_events WHERE execution_id = ? AND event_id = ?')
      .get(executionId, eventId) as any
    return row ? this.readEvent(row) : null
  }

  event(executionId: string, eventId: string): ExecutionEvent {
    const event = this.findEvent(executionId, eventId)
    if (!event) throw new Error(`Unknown execution event ${eventId}`)
    return event
  }

  private readEvent(row: any): ExecutionEvent {
    return {
      eventId: row.event_id, executionId: row.execution_id, sequence: row.sequence, kind: row.kind,
      payload: this.decodeDocument(row.payload), createdAt: row.created_at,
      ...(row.parent_event_id ? { parentEventId: row.parent_event_id } : {}),
      ...(row.action_id ? { actionId: row.action_id } : {}),
      ...(row.work_item_id ? { workItemId: row.work_item_id } : {}),
    }
  }

  events(executionId: string, afterSequence = 0): ExecutionEvent[] {
    return (this.db.prepare('SELECT * FROM execution_events WHERE execution_id = ? AND sequence > ? ORDER BY sequence')
      .all(executionId, afterSequence) as any[]).map(row => this.readEvent(row))
  }

  /** Called only inside the saver's checkpoint transaction. */
  commitTransition(executionId: string, checkpointId: string, transition: CheckpointTransition): void {
    if (!this.db.inTransaction) throw new Error('Checkpoint transition requires the checkpoint transaction')
    const identity = contentHash(transition)
    const previous = this.db.prepare('SELECT identity FROM execution_transitions WHERE execution_id = ? AND transition_id = ?')
      .get(executionId, transition.transitionId) as any
    if (previous) {
      if (previous.identity !== identity) throw new ExecutionConflictError('Transition ID reused with different content')
      return
    }
    const state = this.get(executionId)
    if (['completed', 'failed', 'cancelled'].includes(state.status)
      && ((transition.status && transition.status !== state.status) || transition.dispatches?.length)) {
      throw new ExecutionConflictError('A terminal execution cannot be revived')
    }
    const sequence = (transition.processedEventIds ?? []).reduce((last, eventId) =>
      Math.max(last, this.event(executionId, eventId).sequence), state.lastProcessedSequence)
    // Only a contiguous prefix can be acknowledged. Never skip an unconsumed event.
    const processed = new Set(transition.processedEventIds ?? [])
    if (this.events(executionId, state.lastProcessedSequence)
      .some(event => event.sequence <= sequence && !processed.has(event.eventId))) {
      throw new ExecutionConflictError('Transition skipped an unprocessed execution event')
    }
    for (const event of transition.events ?? []) this.insertEvent(executionId, event)
    if (transition.task) {
      if (transition.task.executionId !== executionId || !transition.task.objectiveId) throw new ExecutionConflictError('Task belongs to another execution')
      this.db.prepare(`INSERT INTO execution_task VALUES (?, ?, ?)
        ON CONFLICT(execution_id) DO UPDATE SET checkpoint_id = excluded.checkpoint_id, task = excluded.task`)
        .run(executionId, checkpointId, this.encodeDocument(executionId, transition.task))
    }
    for (const frame of transition.frames ?? []) {
      if (!frame.id) throw new ExecutionConflictError('Evidence frame has no identity')
      const previous = this.frame(executionId, frame.id)
      if (previous && contentHash(previous) !== contentHash(frame)) throw new ExecutionConflictError('Frame identity reused with different evidence')
      if (!previous) this.db.prepare('INSERT INTO execution_frames VALUES (?, ?, ?, ?)')
        .run(executionId, frame.id, contentHash(frame), this.encodeDocument(executionId, frame))
    }
    if (state.cancelledAt === null) {
      for (const dispatch of transition.dispatches ?? []) this.insertDispatch(executionId, checkpointId, dispatch)
    } else if (transition.dispatches?.length) throw new ExecutionCancelledError(executionId)
    this.db.prepare(`UPDATE executions SET processed_sequence = ?, status = ?, updated_at = ? WHERE execution_id = ?`)
      .run(sequence, state.cancelledAt !== null ? 'cancelled' : transition.status ?? state.status, Date.now(), executionId)
    this.settleFinishedDispatches(executionId)
    this.db.prepare('INSERT INTO execution_transitions VALUES (?, ?, ?)').run(executionId, transition.transitionId, identity)
  }

  private insertDispatch(executionId: string, checkpointId: string, intent: DispatchIntent): void {
    const identity = contentHash({ executionId, ...intent })
    const previous = this.db.prepare('SELECT identity FROM execution_outbox WHERE effect_id = ?').get(intent.effectId) as any
    if (previous) {
      if (previous.identity !== identity) throw new ExecutionConflictError('Effect ID reused with different content')
      return
    }
    this.db.prepare(`INSERT INTO execution_outbox
      (effect_id, execution_id, checkpoint_id, kind, payload, identity, action_id, attempt_generation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(intent.effectId, executionId, checkpointId, intent.kind, this.encodeDocument(executionId, intent.payload), identity,
        intent.actionId ?? null, intent.kind === 'graph_resume' ? this.get(executionId).ownerGeneration : null)
  }

  dispatch(effectId: string): DispatchRecord {
    const row = this.db.prepare('SELECT * FROM execution_outbox WHERE effect_id = ?').get(effectId) as any
    if (!row) throw new Error(`Unknown dispatch ${effectId}`)
    return {
      effectId, executionId: row.execution_id, checkpointId: row.checkpoint_id, kind: row.kind,
      payload: this.decodeDocument(row.payload), status: row.status, workItemId: row.work_item_id,
      ...(row.action_id ? { actionId: row.action_id } : {}),
      ...(row.attempt_generation !== null ? { attemptGeneration: row.attempt_generation } : {}),
    }
  }

  dispatches(executionId: string): DispatchRecord[] {
    return (this.db.prepare('SELECT effect_id FROM execution_outbox WHERE execution_id = ? ORDER BY rowid')
      .all(executionId) as { effect_id: string }[]).map(row => this.dispatch(row.effect_id))
  }

  /** The Coordinator's cancelled, never-started receipt proves this intent was not dispatched. */
  confirmUndispatched(effectId: string, receipt: Pick<import('../queue/types.js').QueuedTask,
    'id' | 'state' | 'durable' | 'startedAt' | 'bodyLease'>): ExecutionEvent {
    return this.db.transaction(() => {
      const effect = this.dispatch(effectId)
      if (!['failed', 'cancelled'].includes(this.get(effect.executionId).status)
        || effect.kind !== 'coordinator_work' || !['pending', 'admitted', 'cancelled'].includes(effect.status)) {
        throw new ExecutionConflictError('Execution intent is not eligible for non-dispatch confirmation')
      }
      if (!receipt.id || receipt.state !== 'cancelled' || receipt.startedAt || receipt.bodyLease
        || receipt.durable?.executionId !== effect.executionId || receipt.durable.effectId !== effectId
        || effect.workItemId && effect.workItemId !== receipt.id) {
        throw new ExecutionConflictError('Coordinator receipt does not prove this intent was never dispatched')
      }
      const event = this.insertEvent(effect.executionId, {
        eventId: `work:${receipt.id}:undispatched`, kind: 'dispatch_cancelled', workItemId: receipt.id,
        payload: { effectId, reason: 'Execution ended before work started' },
      })
      this.db.prepare(`UPDATE execution_outbox SET work_item_id = ?, status = 'cancelled'
        WHERE effect_id = ? AND (work_item_id IS NOT ? OR status != 'cancelled')`)
        .run(receipt.id, effectId, receipt.id)
      return event
    }).immediate()
  }

  pendingDispatches(): DispatchRecord[] {
    return (this.db.prepare(`SELECT o.effect_id FROM execution_outbox o JOIN executions e USING(execution_id)
      WHERE o.status = 'pending' AND e.cancelled_at IS NULL AND e.status IN ('running', 'waiting')`).all() as any[])
      .map(row => this.dispatch(row.effect_id))
  }

  assertDispatchable(effectId: string): DispatchRecord {
    const dispatch = this.dispatch(effectId)
    const execution = this.get(dispatch.executionId)
    if (execution.cancelledAt !== null || dispatch.status === 'cancelled') throw new ExecutionCancelledError(dispatch.executionId)
    if (!['running', 'waiting'].includes(execution.status) || !['pending', 'admitted'].includes(dispatch.status)) {
      throw new ExecutionConflictError(`Dispatch ${effectId} is not eligible (${dispatch.status})`)
    }
    return dispatch
  }

  acknowledgeAdmission(effectId: string, workItemId: string): DispatchRecord {
    return this.db.transaction(() => {
      const dispatch = this.dispatch(effectId)
      if (dispatch.workItemId && dispatch.workItemId !== workItemId) throw new ExecutionConflictError('Conflicting Coordinator receipt')
      // A cancellation during cross-store relay keeps the receipt but never revives work.
      this.db.prepare(`UPDATE execution_outbox SET work_item_id = ?, status = CASE
        WHEN status = 'pending' THEN 'admitted' ELSE status END
        WHERE effect_id = ? AND (work_item_id IS NOT ? OR status = 'pending')`).run(workItemId, effectId, workItemId)
      return this.dispatch(effectId)
    }).immediate()
  }

  acceptAction(effectId: string): DispatchRecord {
    return this.db.transaction(() => {
      const previous = this.dispatch(effectId)
      const execution = this.get(previous.executionId)
      if (execution.cancelledAt !== null) throw new ExecutionCancelledError(previous.executionId)
      if (previous.kind === 'graph_resume') {
        // A queued wake may outlive the event or execution it referred to.
        // Refresh legacy admission receipts at the accepting owner as well as
        // at checkpoint commit; this never admits a new physical action.
        this.settleFinishedDispatches(previous.executionId)
        const current = this.dispatch(effectId)
        if (current.status === 'completed') return current
        if (execution.owner && (execution.leaseUntil ?? 0) > Date.now()) throw new ExecutionBusyError(execution.leaseUntil!)
        // Also bind failures before claim (for example an incompatible graph).
        // Once a writer claims this attempt it atomically advances the binding.
        if (current.status !== 'accepted') {
          this.db.prepare('UPDATE execution_outbox SET attempt_generation=? WHERE effect_id=?')
            .run(execution.ownerGeneration, effectId)
        }
      }
      if (previous.status === 'accepted') {
        return previous
      }
      this.assertDispatchable(effectId)
      this.db.prepare("UPDATE execution_outbox SET status = 'accepted' WHERE effect_id = ?").run(effectId)
      return this.dispatch(effectId)
    }).immediate()
  }

  private assertClaimedAction(dispatch: DispatchRecord, receipt: ClaimedActionReceipt): void {
    if (dispatch.kind !== 'coordinator_work' || !dispatch.actionId || dispatch.workItemId !== receipt.id
      || receipt.type !== 'environment_command' || receipt.handler !== 'environment.command'
      || receipt.username !== this.get(dispatch.executionId).username
      || receipt.durable?.executionId !== dispatch.executionId || receipt.durable.effectId !== dispatch.effectId
      || receipt.input.id !== dispatch.actionId || !receipt.startedAt || receipt.state === 'queued'
      || !receipt.bodyLease || receipt.bodyLease.executionId !== dispatch.executionId
      || receipt.bodyLease.bodyId !== receipt.input.sessionId
      || !Number.isSafeInteger(receipt.bodyLease.generation) || receipt.bodyLease.generation < 1) {
      throw new ExecutionConflictError('Coordinator receipt does not prove this action was claimed')
    }
  }

  /** A past physical acceptance is evidence, not permission to dispatch new work. */
  recordActionAcceptance(effectId: string, receipt: ClaimedActionReceipt): DispatchRecord {
    return this.db.transaction(() => {
      const dispatch = this.dispatch(effectId)
      this.assertClaimedAction(dispatch, receipt)
      if (['accepted', 'outcome_unknown', 'completed'].includes(dispatch.status)) return dispatch
      if (!['admitted', 'cancelled'].includes(dispatch.status)) {
        throw new ExecutionConflictError('Action has not been admitted')
      }
      this.db.prepare("UPDATE execution_outbox SET status = 'accepted' WHERE effect_id = ?").run(effectId)
      return this.dispatch(effectId)
    }).immediate()
  }

  recordResult(executionId: string, actionId: string, event: NewExecutionEvent, uncertain = false, notExecuted = false,
    receipt?: ClaimedActionReceipt, evidence?: ActionResultEvidence): ExecutionEvent {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT effect_id FROM execution_outbox WHERE execution_id = ? AND action_id = ?')
        .get(executionId, actionId) as any
      if (!row || event.actionId !== actionId) throw new ExecutionConflictError('Result does not identify this execution action')
      const dispatch = this.dispatch(row.effect_id)
      if (receipt) {
        this.assertClaimedAction(dispatch, receipt)
        if (event.workItemId !== receipt.id) throw new ExecutionConflictError('Result does not identify its Coordinator receipt')
      }
      const previous = this.db.prepare('SELECT event_id FROM execution_events WHERE execution_id = ? AND event_id = ?')
        .get(executionId, event.eventId)
      if (previous) return this.insertEvent(executionId, event)
      if (evidence?.deliveryOnly) {
        if (!receipt || !uncertain || dispatch.status !== 'completed' || event.kind !== 'delivery_result'
          || evidence.reconcilesEventId) throw new ExecutionConflictError('Not a late transport diagnostic')
        return this.insertEvent(executionId, event)
      }
      if (evidence?.reconcilesEventId) {
        const latest = this.db.prepare(`SELECT * FROM execution_events WHERE execution_id = ? AND action_id = ?
          AND kind = 'physical_result' ORDER BY sequence DESC LIMIT 1`).get(executionId, actionId) as any
        if (!receipt || uncertain || dispatch.status !== 'completed' || event.kind !== 'physical_result'
          || !latest || latest.event_id !== evidence.reconcilesEventId || latest.work_item_id !== receipt.id
          || event.parentEventId !== latest.event_id) {
          throw new ExecutionConflictError('Physical reconciliation does not match the current delivery conclusion')
        }
      }
      if (!['accepted', 'outcome_unknown'].includes(dispatch.status)
        && !(receipt && ['admitted', 'cancelled'].includes(dispatch.status))
        && !(notExecuted && ['pending', 'admitted', 'cancelled'].includes(dispatch.status))
        && !evidence?.reconcilesEventId) {
        throw new ExecutionConflictError('Action is not waiting for a result')
      }
      const result = this.insertEvent(executionId, event)
      this.db.prepare('UPDATE execution_outbox SET status = ? WHERE effect_id = ?')
        .run(uncertain ? 'outcome_unknown' : 'completed', row.effect_id)
      // A physical result is evidence, never semantic completion of an objective.
      return result
    }).immediate()
  }

  /** The result and the request to resume its waiting graph cannot be separated by a crash. */
  deliverActionResult(executionId: string, actionId: string, event: NewExecutionEvent, uncertain = false, notExecuted = false,
    receipt?: ClaimedActionReceipt, evidence?: ActionResultEvidence): ExecutionEvent {
    return this.db.transaction(() => {
      const result = this.recordResult(executionId, actionId, event, uncertain, notExecuted, receipt, evidence)
      if (result.kind !== 'delivery_result') this.scheduleResume(result)
      return result
    }).immediate()
  }

  deliverEvent(executionId: string, event: NewExecutionEvent): ExecutionEvent {
    return this.db.transaction(() => {
      const result = this.insertEvent(executionId, event)
      this.scheduleResume(result)
      return result
    }).immediate()
  }

  deliverExecutionInput(effectId: string): void {
    this.db.transaction(() => {
      const effect = this.assertDispatchable(effectId)
      if (effect.kind !== 'execution_event') throw new Error('Not an execution input handoff')
      const input = effect.payload as { executionId: string; kind: string; context: Record<string, unknown> }
      if (this.get(input.executionId).username !== this.get(effect.executionId).username) throw new Error('Execution input belongs to a different profile')
      const event = { eventId: effectId, kind: input.kind, payload: input.context }
      if (input.kind === 'user_cancelled') this.cancel(input.executionId, event)
      else this.deliverEvent(input.executionId, event)
      this.db.prepare("UPDATE execution_outbox SET status='completed' WHERE effect_id=?").run(effectId)
    }).immediate()
  }

  private scheduleResume(event: ExecutionEvent): void {
    const execution = this.get(event.executionId)
    if (execution.cancelledAt !== null || ['completed', 'failed'].includes(execution.status)
      || event.sequence <= execution.lastProcessedSequence) return
    this.insertDispatch(event.executionId, `event:${event.sequence}`, {
      effectId: `${event.executionId}:resume:${event.eventId}`, kind: 'graph_resume',
      payload: { executionId: event.executionId, eventId: event.eventId },
    })
  }

  private settleFinishedDispatches(executionId: string): void {
    const execution = this.get(executionId)
    if (execution.status === 'failed') {
      // A terminal graph cannot deliver its remaining local projections. Keep
      // Coordinator intents: a pending receipt may conceal enqueue-before-ack,
      // and accepted/unknown effects still need their external outcome.
      this.db.prepare(`UPDATE execution_outbox SET status = 'cancelled' WHERE execution_id = ?
        AND status = 'pending' AND kind IN ('buffer_entry', 'robot_status', 'local_tts', 'execution_event')`)
        .run(executionId)
    }
    const rows = this.db.prepare(`SELECT effect_id FROM execution_outbox WHERE execution_id = ?
      AND kind = 'graph_resume' AND status IN ('pending', 'admitted', 'accepted')`).all(executionId) as { effect_id: string }[]
    for (const row of rows) {
      const effect = this.dispatch(row.effect_id)
      const payload = effect.payload as { eventId?: string }
      const consumed = payload.eventId && this.event(executionId, payload.eventId).sequence <= execution.lastProcessedSequence
      // An accepted wake owns an invocation that may still be reviewing the
      // consumed input. Its terminal work receipt settles that invocation;
      // only unstarted wakes are redundant merely because input was consumed.
      if ((consumed && effect.status !== 'accepted') || ['completed', 'failed', 'cancelled'].includes(execution.status)) {
        this.db.prepare("UPDATE execution_outbox SET status = 'completed' WHERE effect_id = ?").run(effect.effectId)
      }
    }
  }

  requestRecovery(executionId: string, interruptedWorkId?: string): void {
    this.db.transaction(() => {
      const record = this.get(executionId)
      if ((record.status !== 'running' && record.waitingReason !== 'interrupted') || record.cancelledAt !== null) return
      this.insertDispatch(executionId, `recovery:${record.checkpointVersion}`, {
        effectId: `${executionId}:recovery:${record.checkpointVersion}${interruptedWorkId ? `:${interruptedWorkId}` : ''}`, kind: 'graph_resume',
        payload: { executionId },
      })
    }).immediate()
  }

  /** Coordinator receipts are facts about jobs, not decisions that an objective succeeded. */
  deliverWorkResult(effectId: string, workItemId: string,
    payload: { state: string; result?: unknown; error?: unknown }, graphResults?: unknown[]): ExecutionEvent | null {
    return this.db.transaction(() => {
      const effect = this.dispatch(effectId)
      if (effect.workItemId !== workItemId) throw new ExecutionConflictError('Result has a different Coordinator receipt')
      if (effect.actionId) throw new ExecutionConflictError('Physical actions require a correlated physical result')
      if (effect.kind === 'graph_resume') {
        const alreadyRecorded = this.findEvent(effect.executionId, `work:${workItemId}:terminal`)
        const result = this.insertEvent(effect.executionId, {
          eventId: `work:${workItemId}:terminal`, kind: 'resume_result', workItemId,
          payload: { effectId, result: payload },
        })
        const receipt = payload as { state: string; error?: unknown }
        const record = this.get(effect.executionId)
        const wake = effect.payload as { eventId?: string }
        const unfinished = effect.status === 'accepted' || (wake.eventId
          ? this.event(effect.executionId, wake.eventId).sequence > record.lastProcessedSequence
          : effect.checkpointId === `recovery:${record.checkpointVersion}`)
        // A terminal wake receipt must settle its saved position, not just the
        // delivery row. A late receipt cannot overwrite a newer/live writer.
        if (!alreadyRecorded && unfinished && !['completed', 'failed', 'cancelled'].includes(record.status)
          && (!record.owner || (record.leaseUntil ?? 0) <= Date.now())) {
          if (effect.attemptGeneration === record.ownerGeneration && (receipt.state === 'failed' || receipt.state === 'expired')) {
            this.db.prepare("UPDATE executions SET status='failed', updated_at=? WHERE execution_id=?")
              .run(Date.now(), effect.executionId)
            this.db.prepare('DELETE FROM execution_waits WHERE execution_id=?').run(effect.executionId)
            this.settleFinishedDispatches(effect.executionId)
          } else if ((effect.attemptGeneration === record.ownerGeneration && receipt.state === 'cancelled')
            || (effect.attemptGeneration === undefined && ['failed', 'expired', 'cancelled'].includes(receipt.state))) {
            // Worker interruption is not a user cancellation of the objective.
            // An old receipt without writer identity cannot settle current state;
            // re-enter its checkpoint once through the version-checked runtime.
            if (record.status !== 'waiting' || record.waitingReason !== 'interrupted') {
              this.db.prepare("UPDATE executions SET status='waiting', updated_at=? WHERE execution_id=?")
                .run(Date.now(), effect.executionId)
              this.db.prepare('INSERT INTO execution_waits VALUES (?, ?) ON CONFLICT(execution_id) DO UPDATE SET reason=excluded.reason')
                .run(effect.executionId, 'interrupted')
            }
            this.requestRecovery(effect.executionId, workItemId)
          }
        }
        this.db.prepare("UPDATE execution_outbox SET status = 'completed' WHERE effect_id = ? AND status NOT IN ('cancelled', 'completed')").run(effectId)
        return result
      }
      // The first committed receipt owns its derived graph-return snapshot.
      // Replays validate the original Coordinator facts, not a recomputation of
      // that snapshot using today's projection code or later checkpoints.
      const committed = this.findEvent(effect.executionId, `work:${workItemId}:terminal`)
      const savedResult = (committed?.payload as { result: typeof payload & { graphResults?: unknown[] } } | undefined)?.result
      if (savedResult) {
        const { graphResults: _derived, ...sourceReceipt } = savedResult
        if (canonicalJSON(sourceReceipt) !== canonicalJSON(payload)) {
          throw new ExecutionConflictError('Coordinator receipt reused with different content')
        }
      }
      const result = this.insertEvent(effect.executionId, {
        eventId: `work:${workItemId}:terminal`, kind: 'work_result', workItemId,
        payload: { effectId, result: savedResult ?? { ...payload, ...(graphResults?.length ? { graphResults } : {}) } },
      })
      this.db.prepare("UPDATE execution_outbox SET status = 'completed' WHERE effect_id = ? AND status NOT IN ('cancelled', 'completed')").run(effectId)
      this.scheduleResume(result)
      return result
    }).immediate()
  }

  completeProjection(effectId: string): void {
    const effect = this.dispatch(effectId)
    if (!['robot_status', 'local_tts', 'buffer_entry'].includes(effect.kind)) throw new ExecutionConflictError('Not a local output delivery')
    this.db.prepare("UPDATE execution_outbox SET status = 'completed' WHERE effect_id = ? AND status != 'cancelled'").run(effectId)
  }

  cancel(executionId: string, event: NewExecutionEvent): ExecutionEvent {
    return this.db.transaction(() => {
      const result = this.insertEvent(executionId, event)
      if (['completed', 'failed'].includes(this.get(executionId).status)) return result
      this.db.prepare(`UPDATE executions SET cancelled_at = COALESCE(cancelled_at, ?), status = 'cancelled', updated_at = ?
        WHERE execution_id = ?`).run(Date.now(), Date.now(), executionId)
      this.db.prepare('DELETE FROM execution_waits WHERE execution_id=?').run(executionId)
      this.db.prepare(`UPDATE execution_outbox SET status = 'cancelled'
        WHERE execution_id = ? AND status IN ('pending', 'admitted')`).run(executionId)
      return result
    }).immediate()
  }


  /** Content-addressed values retain complete evidence without copying it into every checkpoint/write. */
  stageDocument(value: unknown): { encoded: string; blobs: Map<string, string> } {
    const blobs = new Map<string, string>()
    const reference = (item: unknown): string => {
      const hash = contentHash(item)
      blobs.set(hash, this.codec.encode(item))
      return `\u0000mh-blob:${hash}`
    }
    const pack = (item: any): any => {
      if (typeof item === 'string') {
        if (item.length > 4096) return reference(item)
        return item.startsWith('\u0000mh-') ? `\u0000mh-literal:${item}` : item
      }
      if (item && typeof item === 'object') {
        const packed = Array.isArray(item) ? item.map(pack)
          : Object.fromEntries(Object.entries(item).filter(([, entry]) => entry !== undefined).map(([key, entry]) => [key, pack(entry)]))
        // Child references are formed first, so unchanged node outputs/context
        // are shared even when the surrounding scheduler state advances.
        return JSON.stringify(packed).length > 4096 ? reference(packed) : packed
      }
      return item
    }
    const encoded = this.codec.encode(pack(value))
    return { encoded, blobs }
  }

  commitDocument(executionId: string, document: { blobs: Map<string, string> }): void {
    if (!this.db.inTransaction) throw new Error('Evidence writes require the owning transaction')
    for (const [hash, value] of document.blobs) {
      if (!this.db.prepare('SELECT 1 FROM execution_blobs WHERE hash = ?').get(hash)) {
        this.db.prepare('INSERT INTO execution_blobs VALUES (?, ?)').run(hash, value)
      }
      if (!this.db.prepare('SELECT 1 FROM execution_blob_refs WHERE execution_id = ? AND hash = ?').get(executionId, hash)) {
        this.db.prepare('INSERT INTO execution_blob_refs VALUES (?, ?)').run(executionId, hash)
      }
    }
  }

  encodeDocument(executionId: string, value: unknown): string {
    const document = this.stageDocument(value)
    this.db.transaction(() => this.commitDocument(executionId, document)).immediate()
    return document.encoded
  }

  decodeDocument(value: string): any {
    const documents = new Map<string, any>()
    const unpack = (item: any): any => {
      if (typeof item === 'string') {
        if (item.startsWith('\u0000mh-literal:')) return item.slice('\u0000mh-literal:'.length)
        if (item.startsWith('\u0000mh-blob:')) {
          const hash = item.slice('\u0000mh-blob:'.length)
          if (!documents.has(hash)) {
            const row = this.db.prepare('SELECT value FROM execution_blobs WHERE hash = ?').get(hash) as any
            if (!row) throw new Error('Execution evidence blob is missing')
            documents.set(hash, this.codec.decode(row.value))
          }
          const packed = documents.get(hash)
          return packed && typeof packed === 'object' ? unpack(packed) : packed
        }
        return item
      }
      if (Array.isArray(item)) return item.map(unpack)
      if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, unpack(entry)]))
      return item
    }
    return unpack(this.codec.decode(value))
  }
}
