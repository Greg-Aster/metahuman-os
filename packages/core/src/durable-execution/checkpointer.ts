import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { WRITES_IDX_MAP, type Checkpoint, type CheckpointListOptions, type CheckpointMetadata, type CheckpointTuple, type PendingWrite } from '@langchain/langgraph-checkpoint'
import type { CheckpointTransition, ExecutionLease } from './types.js'
import { ExecutionConflictError } from './types.js'
import { canonicalJSON, ExecutionStore } from './store.js'
import type { QueuedTask } from '../queue/types.js'

export type CheckpointConfig = Parameters<SqliteSaver['put']>[0]

/**
 * Uses LangGraph's SQLite format and read/replay implementation. The write
 * boundary adds serialized ownership, immutable checkpoint heads, and an atomic
 * event/outbox commit. It never commits to the Coordinator's separate ledger.
 */
export class ExecutionCheckpointer extends SqliteSaver {
  private readonly documents = new WeakMap<Uint8Array, { blobs: Map<string, string> }>()
  constructor(readonly store: ExecutionStore, readonly lease: ExecutionLease, private readonly afterCommit?: () => Promise<void>, private readonly namespaceRoot = '') {
    super(store.db)
    const base = this.serde
    this.serde = {
      dumpsTyped: async (value) => {
        const [type, bytes] = await base.dumpsTyped(value)
        const document = type === 'json'
          ? { type, json: JSON.parse(Buffer.from(bytes).toString('utf8')) }
          : { type, bytes: Buffer.from(bytes).toString('base64') }
        const staged = store.stageDocument(document)
        const encoded = Buffer.from(staged.encoded)
        this.documents.set(encoded, staged)
        return ['metahuman-v1', encoded]
      },
      loadsTyped: async (type, bytes) => {
        if (type !== 'metahuman-v1') throw new ExecutionConflictError('Unknown checkpoint encoding')
        const document = store.decodeDocument(Buffer.from(bytes).toString('utf8'))
        return base.loadsTyped(document.type, 'json' in document
          ? Buffer.from(JSON.stringify(document.json)) : Buffer.from(document.bytes, 'base64'))
      },
    }
    this.setup()
  }

  // LangGraph owns checkpoint_ns and resets it for a top-level invocation. A
  // Coordinator child re-enters from another process, so its stable work identity
  // scopes storage here while its native subgraph namespaces remain unchanged.
  private storageConfig(config: CheckpointConfig): CheckpointConfig {
    if (!this.namespaceRoot) return config
    return { ...config, configurable: { ...config.configurable,
      checkpoint_ns: `${this.namespaceRoot}|${config.configurable?.checkpoint_ns ?? ''}` } }
  }

  private logicalConfig(config: CheckpointConfig): CheckpointConfig {
    if (!this.namespaceRoot) return config
    const prefix = `${this.namespaceRoot}|`
    const namespace = config.configurable?.checkpoint_ns
    if (typeof namespace !== 'string' || !namespace.startsWith(prefix)) {
      throw new ExecutionConflictError('Checkpoint belongs to a different child invocation')
    }
    return { ...config, configurable: { ...config.configurable, checkpoint_ns: namespace.slice(prefix.length) } }
  }

  private logicalTuple(tuple: CheckpointTuple): CheckpointTuple {
    return { ...tuple, config: this.logicalConfig(tuple.config),
      parentConfig: tuple.parentConfig ? this.logicalConfig(tuple.parentConfig) : undefined }
  }

  override async getTuple(config: CheckpointConfig): Promise<CheckpointTuple | undefined> {
    const tuple = await super.getTuple(this.storageConfig(config))
    return tuple ? this.logicalTuple(tuple) : undefined
  }

  /** Read the saved returns of finite child graphs belonging to one dispatch. */
  async workGraphResults(effectId: string, receipt: Pick<QueuedTask, 'state' | 'error'>) {
    const effect = this.store.dispatch(effectId)
    if (effect.executionId !== this.lease.executionId) throw new ExecutionConflictError('Work belongs to a different execution')
    const prefix = `work:${effectId}:graph:`
    const rows = this.store.db.prepare('SELECT invocation_id, definition FROM execution_graphs WHERE execution_id = ?')
      .all(effect.executionId) as Array<{ invocation_id: string; definition: string }>
    const results = []
    const { getGraphOutput } = await import('../graph-executor.js')
    for (const row of rows) {
      if (!row.invocation_id.startsWith(prefix) || !/^\d+$/.test(row.invocation_id.slice(prefix.length))) continue
      const reader = new ExecutionCheckpointer(this.store, this.lease, undefined, row.invocation_id)
      const saved = await reader.getTuple({ configurable: { thread_id: effect.executionId } })
      if (!saved) continue // The process can fail before its first graph checkpoint.
      const values = saved.checkpoint.channel_values
      const nodes = new Map((values.nodeEntries ?? []) as Array<[string, import('../graph-executor.js').NodeExecutionState]>)
      const failed = [...nodes.values()].find(node => node.status === 'failed')
      const unfinished = !Array.isArray(values.queue) || values.queue.length > 0
      const status = failed ? 'failed' : unfinished
        ? ['failed', 'cancelled', 'expired'].includes(receipt.state) ? receipt.state : 'waiting'
        : 'completed'
      const error = failed?.error ?? (unfinished ? receipt.error : undefined)
      results.push({ invocationId: row.invocation_id, graph: this.store.codec.decode(row.definition).graphId,
        status, output: status === 'completed'
          ? getGraphOutput({ nodes, status: 'completed', startTime: Number(values.startedAt) }) : null,
        ...(error ? { error } : {}) })
    }
    return results
  }

  override async *list(config: CheckpointConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    // Metadata uses our reference-aware serializer, so filtering must operate on
    // decoded metadata rather than SQLite JSON paths into the encoded envelope.
    let remaining = options?.limit
    const { filter, limit: _limit, ...query } = options ?? {}
    for await (const tuple of super.list(this.storageConfig(config), query)) {
      if (filter && !Object.entries(filter).every(([key, value]) => {
        const actual = (tuple.metadata as Record<string, unknown> | undefined)?.[key]
        return value === undefined || actual !== undefined && canonicalJSON(actual) === canonicalJSON(value)
      })) continue
      if (remaining !== undefined && remaining <= 0) break
      yield this.logicalTuple(tuple)
      if (remaining !== undefined) remaining--
    }
  }

  private sameDocument(left: Uint8Array, right: Uint8Array): boolean {
    return canonicalJSON(this.store.decodeDocument(Buffer.from(left).toString('utf8')))
      === canonicalJSON(this.store.decodeDocument(Buffer.from(right).toString('utf8')))
  }

  private checkConfig(config: CheckpointConfig): { executionId: string; namespace: string; parentId: string | null } {
    const executionId = config.configurable?.thread_id
    if (executionId !== this.lease.executionId) throw new ExecutionConflictError('Checkpoint belongs to a different execution')
    return {
      executionId,
      namespace: this.storageConfig(config).configurable?.checkpoint_ns ?? '',
      parentId: config.configurable?.checkpoint_id ?? null,
    }
  }

  override async put(config: CheckpointConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<CheckpointConfig> {
    const { executionId, namespace, parentId } = this.checkConfig(config)
    const [[type, serializedCheckpoint], [metadataType, serializedMetadata]] = await Promise.all([
      this.serde.dumpsTyped(checkpoint), this.serde.dumpsTyped(metadata),
    ])
    if (type !== metadataType) throw new Error('Checkpoint and metadata serialization types differ')
    this.store.db.transaction(() => {
      this.store.assertLease(this.lease)
      const head = this.store.db.prepare(`SELECT checkpoint_id FROM execution_heads WHERE execution_id = ? AND namespace = ?`)
        .get(executionId, namespace) as any
      const existing = this.store.db.prepare(`SELECT checkpoint, metadata, parent_checkpoint_id FROM checkpoints
        WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`).get(executionId, namespace, checkpoint.id) as any
      if (!existing && (head?.checkpoint_id ?? null) !== parentId) throw new ExecutionConflictError('Stale checkpoint parent')
      this.store.commitDocument(executionId, this.documents.get(serializedCheckpoint)!)
      this.store.commitDocument(executionId, this.documents.get(serializedMetadata)!)
      if (existing) {
        if (!this.sameDocument(existing.checkpoint, serializedCheckpoint)
          || !this.sameDocument(existing.metadata, serializedMetadata)
          || existing.parent_checkpoint_id !== parentId) {
          throw new ExecutionConflictError('Checkpoint ID reused with different state')
        }
        return
      }
      this.store.db.prepare(`INSERT INTO checkpoints
        (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(executionId, namespace, checkpoint.id, parentId, type, serializedCheckpoint, serializedMetadata)
      this.store.db.prepare(`INSERT INTO execution_heads VALUES (?, ?, ?)
        ON CONFLICT(execution_id, namespace) DO UPDATE SET checkpoint_id = excluded.checkpoint_id`)
        .run(executionId, namespace, checkpoint.id)
      const transition = checkpoint.channel_values.executionTransition as CheckpointTransition | undefined
      if (transition) this.store.commitTransition(executionId, checkpoint.id, transition)
      this.store.db.prepare(`UPDATE executions SET checkpoint_version = checkpoint_version + 1, updated_at = ?
        WHERE execution_id = ?`).run(Date.now(), executionId)
    }).immediate()
    await this.afterCommit?.()
    return { configurable: { ...config.configurable, thread_id: executionId, checkpoint_ns: config.configurable?.checkpoint_ns ?? '', checkpoint_id: checkpoint.id } }
  }

  override async putWrites(config: CheckpointConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const { executionId, namespace, parentId } = this.checkConfig(config)
    if (!parentId) throw new Error('Pending writes require a checkpoint')
    const rows = await Promise.all(writes.map(async ([channel, value], index) => {
      const [type, serialized] = await this.serde.dumpsTyped(value)
      return { channel, index: WRITES_IDX_MAP[channel] ?? index, type, serialized }
    }))
    this.store.db.transaction(() => {
      this.store.assertLease(this.lease)
      const head = this.store.db.prepare('SELECT checkpoint_id FROM execution_heads WHERE execution_id = ? AND namespace = ?')
        .get(executionId, namespace) as any
      if (head?.checkpoint_id !== parentId) throw new ExecutionConflictError('Pending writes target a stale checkpoint')
      for (const row of rows) {
        this.store.commitDocument(executionId, this.documents.get(row.serialized)!)
        const existing = this.store.db.prepare(`SELECT channel, type, value FROM writes
          WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ? AND task_id = ? AND idx = ?`)
          .get(executionId, namespace, parentId, taskId, row.index) as any
        if (existing) {
          if (existing.channel === row.channel && existing.type === row.type && this.sameDocument(existing.value, row.serialized)) continue
          // LangGraph revises diagnostic/error/interrupt slots when a task resumes.
          // Successful ordinary task output is immutable, never INSERT OR IGNORE.
          if (!(row.channel in WRITES_IDX_MAP)) throw new ExecutionConflictError('Task output conflicts with a committed result')
          this.store.db.prepare(`UPDATE writes SET channel = ?, type = ?, value = ?
            WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ? AND task_id = ? AND idx = ?`)
            .run(row.channel, row.type, row.serialized, executionId, namespace, parentId, taskId, row.index)
        } else {
          this.store.db.prepare(`INSERT INTO writes
            (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(executionId, namespace, parentId, taskId, row.index, row.channel, row.type, row.serialized)
        }
      }
    }).immediate()
  }

  override async deleteThread(threadId: string): Promise<void> {
    const state = this.store.get(threadId)
    if (state.status === 'running' || state.status === 'waiting' || state.owner) {
      throw new ExecutionConflictError('Cannot prune an active execution')
    }
    this.store.db.transaction(() => {
      if (this.store.db.prepare(`SELECT 1 FROM execution_outbox WHERE execution_id = ?
        AND status IN ('pending', 'admitted', 'accepted', 'outcome_unknown') LIMIT 1`).get(threadId)) {
        throw new ExecutionConflictError('Cannot prune an unresolved dispatch')
      }
      this.store.db.prepare('DELETE FROM writes WHERE thread_id = ?').run(threadId)
      this.store.db.prepare('INSERT INTO execution_retirements VALUES (?, ?)').run(threadId, Date.now())
      this.store.db.prepare('DELETE FROM checkpoints WHERE thread_id = ?').run(threadId)
      this.store.db.prepare('DELETE FROM executions WHERE execution_id = ?').run(threadId)
      this.store.db.prepare('DELETE FROM execution_blobs WHERE hash NOT IN (SELECT hash FROM execution_blob_refs)').run()
    }).immediate()
  }

  async pruneTerminal(before: number, unfinishedWork = new Set<string>()): Promise<number> {
    const candidates = this.store.list().filter(state =>
      ['completed', 'failed', 'cancelled'].includes(state.status) && !state.owner && state.updatedAt < before
        && !unfinishedWork.has(state.executionId))
    let count = 0
    for (const state of candidates) {
      const unresolved = this.store.db.prepare(`SELECT 1 FROM execution_outbox WHERE execution_id = ?
        AND status IN ('pending', 'admitted', 'accepted', 'outcome_unknown') LIMIT 1`).get(state.executionId)
      if (unresolved) continue
      await this.deleteThread(state.executionId)
      count++
    }
    return count
  }
}
