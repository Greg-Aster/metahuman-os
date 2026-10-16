import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after, mock } from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-index-attribution-'))
process.env.METAHUMAN_ROOT = root
fs.mkdirSync(path.join(root, 'etc'), { recursive: true })
fs.mkdirSync(path.join(root, 'profile'), { recursive: true })
const username = 'memory-attribution'
const submissions: any[] = []
const router = await import('./model-router.js')
mock.module('./model-router.js', { namedExports: { ...router,
  callEmbeddings: async () => ({ model: 'fixture', provider: 'fixture', dimensions: 2, embeddings: [1, 0] }),
  isEmbeddingServiceAvailable: async () => true,
} })
const users = await import('./users.js')
mock.module('./users.js', { namedExports: { ...users,
  getUserByUsername: () => ({ id: username, username, role: 'owner' }),
} })
const submission = await import('./queue/work-submission.js')
mock.module('./queue/work-submission.js', { namedExports: { ...submission,
  submitCoordinatorWork: async (input: any) => { submissions.push(input); return { id: 'fixture' } },
} })
const { eventBus } = await import('./infrastructure/event-bus/client.js')
eventBus.disconnect()
const { setAuditEnabled } = await import('./audit.js')
setAuditEnabled(false)
const { registerProfileStorageConfigGetter } = await import('./path-builder.js')
registerProfileStorageConfigGetter(name => name === username ? { path: path.join(root, 'profile'), type: 'internal' } : undefined)
const { withUserContext } = await import('./context.js')
const { captureEventWithDetails } = await import('./memory.js')
const { ExecutionEngine } = await import('./queue/execution-engine.js')
const vector = await import('./vector-index.js')
const { MemoryRouterNode } = await import('./nodes/memory/memory-router.node.js')
const { environmentContextBuilderNode } = await import('./nodes/environment/context-builder.node.js')
const { SLEEP_RUNTIME_FILE } = await import('./sleep-runtime.js')
const engine = new ExecutionEngine({}, { addEventListener() {} } as never)
const append = (engine as any).handlers.get('vector.append-event')
after(() => { eventBus.disconnect(); mock.restoreAll(); fs.rmSync(root, { recursive: true, force: true }) })

test('capture, queued append, rebuild and retrieval preserve attribution and content policy', async () => {
  const records = [
    { content: 'User fixture statement', type: 'conversation', metadata: { role: 'user', source: 'conversation', cognitiveMode: 'dual' as const } },
    { content: 'Assistant fixture statement', type: 'conversation', metadata: { role: 'assistant', source: 'autonomy', sleepSessionId: 'fixture-cycle', cognitiveMode: 'dual' as const } },
    { content: 'Unattributed fixture observation', type: 'observation', metadata: { cognitiveMode: 'dual' as const } },
  ]
  for (const [index, record] of records.entries()) {
    await withUserContext({ userId: username, username, role: 'owner' }, () => captureEventWithDetails(record.content, {
      ...record, type: record.type as any, timestamp: '2026-10-14T00:00:00.000Z', idempotencyKey: `fixture-${index}`,
    }))
  }
  assert.equal(submissions.length, 3)
  for (const [index, work] of submissions.entries()) {
    assert.equal(work.input.metadata?.role, records[index].metadata.role, 'capture must retain speaker in index work')
    assert.equal(work.input.metadata?.source, records[index].metadata.source, 'capture must retain source in index work')
  }
  for (const mode of ['user', 'all']) {
    fs.writeFileSync(path.join(root, 'etc/embeddings.json'), JSON.stringify({ indexContentMode: mode }))
    const indexPath = vector.indexFilePath(undefined, username)
    fs.mkdirSync(path.dirname(indexPath), { recursive: true })
    fs.writeFileSync(indexPath, JSON.stringify({ meta: { model: 'fixture', provider: 'fixture', dimensions: 2, items: 0, createdAt: new Date().toISOString() }, data: [] }))
    for (const work of submissions) await append({ ...work, username })
    const incremental = vector.loadIndex(undefined, username)!.data.map(({ id, role, source, sleepSessionId }) => ({ id, role, source, sleepSessionId }))
    assert.equal(incremental.length, mode === 'user' ? 2 : 3)
    await vector.refreshMemoryIndex({ username, force: true })
    const rebuilt = vector.loadIndex(undefined, username)!.data.map(({ id, role, source, sleepSessionId }) => ({ id, role, source, sleepSessionId }))
    assert.deepEqual(rebuilt.sort((a, b) => a.id.localeCompare(b.id)), incremental.sort((a, b) => a.id.localeCompare(b.id)))
    const recalled = await MemoryRouterNode.execute({ userMessage: 'fixture', orchestratorHints: { needsMemory: true } }, { username }, { threshold: 0, topK: 10 })
    assert.equal(recalled.memories.length, rebuilt.length)
    for (const purpose of ['task', 'conversation']) {
      const built = await environmentContextBuilderNode.execute({ userInstruction: 'Recall fixture',
        memories: recalled.memories, selectedTask: { program: null, taskDecision: null },
        routingAnalysis: { needsAction: true, needsResponse: true, taskContext: ['memory'], conversationContext: ['memory'] },
      }, {}, { purpose })
      const delivered = JSON.parse(built.message).memories
      assert.equal(delivered.length, recalled.memories.length)
      for (const item of delivered) {
        const recalledItem = recalled.memories.find((memory: any) => memory.id === item.id)
        assert.equal(item.role, recalledItem.role)
        assert.equal(item.source, recalledItem.source)
      }
    }
    for (const item of recalled.memories) {
      const original = submissions.find(work => work.input.id === item.id)!.input
      assert.equal(item.role, original.metadata.role)
      assert.equal(item.source, original.metadata.source)
      assert.equal(item.sleepSessionId, original.metadata.sleepSessionId)
      if (original.metadata.role === undefined) assert.equal(Object.hasOwn(item, 'role'), false)
      if (original.metadata.source === undefined) assert.equal(Object.hasOwn(item, 'source'), false)
    }
  }
})

test('temporal recall combines exact session, time and type while newest bypasses similarity', async () => {
  const current = { id: 'new-cycle', username, state: 'running', startedAt: '2026-10-14T02:00:00Z', stages: [] }
  fs.mkdirSync(path.dirname(SLEEP_RUNTIME_FILE), { recursive: true })
  fs.writeFileSync(SLEEP_RUNTIME_FILE, JSON.stringify({ version: 1, phase: 'sleeping', currentSession: current,
    recentSessions: [
      { id: 'other-profile', username: 'different-user', state: 'completed', startedAt: '2026-10-14T04:00:00Z', stages: [] },
      { id: 'old-cycle', username, state: 'completed', startedAt: '2026-10-14T00:00:00Z', completedAt: '2026-10-14T01:00:00Z', stages: [] },
    ] }))
  const records = [
    { id: 'prior', sleepSessionId: 'old-cycle', timestamp: '2026-10-14T00:30:00Z', memoryType: 'dream' },
    { id: 'latest-dream', sleepSessionId: 'new-cycle', timestamp: '2026-10-14T02:20:00Z', memoryType: 'dream' },
    { id: 'at-inclusive-start', sleepSessionId: 'new-cycle', timestamp: '2026-10-14T02:10:00Z', memoryType: 'dream' },
    { id: 'at-exclusive-end', sleepSessionId: 'new-cycle', timestamp: '2026-10-14T02:30:00Z', memoryType: 'dream' },
    { id: 'no-session', timestamp: '2026-10-14T02:25:00Z', memoryType: 'dream' },
    { id: 'wrong-type', sleepSessionId: 'new-cycle', timestamp: '2026-10-14T02:29:00Z', memoryType: 'conversation' },
  ].map(item => ({ ...item, type: 'episodic', text: 'Low similarity evidence', vector: [0, 1] }))
  fs.writeFileSync(vector.indexFilePath(undefined, username), JSON.stringify({ meta: { model: 'fixture', provider: 'fixture', dimensions: 2, items: records.length, createdAt: new Date().toISOString() }, data: records }))
  const hints = { needsMemory: true, memoryTypes: ['dream'], memoryOrder: 'newest', memorySleepCycle: 'latest',
    memoryTimeRange: { from: '2026-10-14T02:10:00Z', before: '2026-10-14T02:30:00Z' } }
  const direct = await MemoryRouterNode.execute({ userMessage: 'Unrelated wording', orchestratorHints: hints }, { username }, { topK: 3, threshold: .99 })
  assert.deepEqual(direct.memories.map((x: any) => x.id), ['latest-dream', 'at-inclusive-start'])
  assert.deepEqual(direct.selectedSleepCycle, { id: current.id, startedAt: current.startedAt, state: 'running' })
  let work: any
  const dispatched = await MemoryRouterNode.execute({ userMessage: 'Unrelated wording', orchestratorHints: hints }, {
    username, graphExecution: { dispatch: (request: any) => { work = request.payload; return { effectId: 'temporal' } } },
  }, { dispatch: true, topK: 3, threshold: .99 })
  const receipt = await (engine as any).handlers.get('vector.semantic-search')(work)
  assert.deepEqual(receipt.map((x: any) => x.item.id), ['latest-dream', 'at-inclusive-start'])
  for (const purpose of ['task', 'conversation']) {
    const built = await environmentContextBuilderNode.execute({ userInstruction: 'Recall selected sleep cycle', memoryWork: dispatched.work,
      selectedTask: { program: null, taskDecision: null }, routingAnalysis: { needsAction: true, needsResponse: true, taskContext: ['memory'], conversationContext: ['memory'] },
    }, { graphExecution: { events: () => [{ eventId: 'temporal-receipt', kind: 'work_result', payload: {
      effectId: 'temporal', result: { state: 'completed', result: receipt },
    } }], pendingEvents: () => [] } }, { purpose })
    const delivered = JSON.parse(built.message)
    assert.deepEqual(delivered.selectedSleepCycle, direct.selectedSleepCycle)
    assert.deepEqual(delivered.memories.map((x: any) => x.id), ['latest-dream', 'at-inclusive-start'])
    assert.ok(delivered.memories.every((x: any) => x.sleepSessionId === current.id))
  }
  const empty = await MemoryRouterNode.execute({ userMessage: 'Unrelated wording', orchestratorHints: {
    ...hints, memoryTimeRange: { from: '2026-10-14T03:00:00Z' },
  } }, { username }, { topK: 3, threshold: .99 })
  assert.deepEqual(empty.memories, [])
  fs.writeFileSync(SLEEP_RUNTIME_FILE, JSON.stringify({ version: 1, phase: 'awake', recentSessions: [] }))
  const missing = await MemoryRouterNode.execute({ userMessage: 'Unrelated wording', orchestratorHints: hints }, { username }, { threshold: .99 })
  assert.deepEqual(missing.memories, [])
  assert.equal(missing.selectedSleepCycle, null)
})

const { UserInputNode } = await import('./nodes/input/user-input.node.js')

test('same-turn recall excludes only the saved input identity before ranking', async () => {
  const input = await withUserContext({ userId: username, username, role: 'owner' }, () => UserInputNode.execute({}, {
    username, userId: username, userMessage: 'Identical request', recordPersonaMemory: true,
    memoryTimestamp: '2026-10-14T02:00:00.000Z', idempotencyKey: 'current-request',
  }, { saveToLongTermMemory: true }))
  const captured = submissions.at(-1)!.input
  assert.equal(input.currentMemoryId, captured.id)
  const noSave = await UserInputNode.execute({}, { userMessage: 'Unsaved input' }, {})
  assert.equal(noSave.currentMemoryId, undefined)
  const indexPath = vector.indexFilePath(undefined, username)
  fs.writeFileSync(indexPath, JSON.stringify({ meta: { model: 'fixture', provider: 'fixture', dimensions: 2, items: 3, createdAt: new Date().toISOString() }, data: [
    { id: captured.id, timestamp: '2026-10-14T02:00:00.000Z', type: 'episodic', memoryType: 'conversation', text: 'Identical request', vector: [1, 0] },
    { id: 'earlier-identical', timestamp: '2026-10-14T01:00:00.000Z', type: 'episodic', memoryType: 'conversation', text: 'Identical request', vector: [1, 0] },
    { id: 'different', timestamp: '2026-10-14T00:00:00.000Z', type: 'episodic', memoryType: 'conversation', text: 'Different evidence', vector: [0, 1] },
  ] }))
  const semanticSearch = (engine as any).handlers.get('vector.semantic-search')
  for (const memoryOrder of ['relevance', 'newest']) for (const currentMemoryId of [input.currentMemoryId, undefined, 'unknown-record']) {
    const expected = currentMemoryId === captured.id ? 'earlier-identical' : captured.id
    const direct = await MemoryRouterNode.execute({ userMessage: 'Identical request', currentMemoryId,
      orchestratorHints: { needsMemory: true, memoryOrder },
    }, { username }, { topK: 1, threshold: 0 })
    assert.equal(direct.memories.length, 1)
    assert.equal(direct.memories[0].id, expected)
    let dispatched: any
    await MemoryRouterNode.execute({ userMessage: 'Identical request', currentMemoryId,
      orchestratorHints: { needsMemory: true, memoryOrder },
    }, { username, graphExecution: { dispatch: (work: any) => { dispatched = work.payload; return { effectId: 'fixture' } } } }, { dispatch: true, topK: 1, threshold: 0 })
    const queued = await semanticSearch(dispatched)
    assert.equal(queued.length, 1)
    assert.equal(queued[0].item.id, expected)
  }
})
