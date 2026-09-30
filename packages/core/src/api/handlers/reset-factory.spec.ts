import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test, mock } from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-memory-reset-test-'))
process.env.METAHUMAN_ROOT = root
fs.mkdirSync(path.join(root, 'persona'), { recursive: true })
const users = ['reset-owner', 'other-owner', 'busy-owner', 'encrypted-owner', 'external-owner', 'lease-owner', 'idle-owner'].map(username =>
  ({ id: `${username}-id`, username, role: 'owner', metadata: {} }))
function saveUsers() { fs.writeFileSync(path.join(root, 'persona/users.json'), JSON.stringify({ version: 1, users })) }
saveUsers()
const { eventBus } = await import('../../infrastructure/event-bus/client.js')
eventBus.disconnect()
const { handleResetFactory } = await import('./reset-factory.js')
const { UnifiedQueueManager } = await import('../../queue/unified-queue-manager.js')
const { ExecutionStore } = await import('../../durable-execution/store.js')
const { ExecutionCheckpointer } = await import('../../durable-execution/checkpointer.js')
const { createSession, validateSession } = await import('../../sessions.js')
const { loadBufferForUser, writeBufferEntry } = await import('../../conversation-buffer.js')
const { withUserContext } = await import('../../context.js')
const { captureEventWithDetails } = await import('../../memory.js')
const { writeFileSync } = await import('../../storage-client.js')
const { listAllDesires, saveDesire, saveGeneratorScratchpad } = await import('../../agency/storage.js')
const { acquireLock, profileMemoryResetLockName, isLocked } = await import('../../locks.js')
const { persistQueueState, loadQueueState } = await import('../../queue/queue-persister.js')
const { initializeEncryption, lockProfile } = await import('../../encryption.js')
const { createTTSDeliveryQueueStore, getTTSQueuePath, getFallbackTTSQueuePath } = await import('../../tts/delivery-queue.js')

after(() => { mock.restoreAll(); fs.rmSync(root, { recursive: true, force: true }) })
function put(relative: string, content = 'synthetic sentinel') {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}
function request(username = 'reset-owner') {
  return { method: 'POST' as const, path: '/api/reset-factory',
    user: { userId: `${username}-id`, username, role: 'owner' as const, isAuthenticated: true },
    body: { confirmUsername: username, confirmToken: 'CONFIRM_FACTORY_RESET' } }
}
function fixture(username = 'reset-owner') {
  const prefix = `profiles/${username}/`
  const erased = ['memory/episodic/example.json', 'memory/curated/conversations/example.json',
    'memory/index/example.json', 'memory/semantic/example.json', 'memory/audio/transcripts/example.txt',
    'state/recent-tools/example.jsonl', 'state/response-buffers/example.json', 'state/response-buffers/archive/example.json',
    'state/conversation-buffer-inner.json.corrupted-old',
    'logs/audit/example.ndjson', 'out/chat/example.json',
    'persona/desires/folders/old-desire/manifest.json', 'persona/desires/folders/old-desire/plans/v1.json',
    'persona/desires/folders/old-desire/reviews/review.json', 'persona/desires/folders/old-desire/executions/attempt-001.json',
    'persona/desires/folders/old-desire/scratchpad/entry.json', 'persona/desires/pending/legacy.json',
    'persona/desires/desires/pending/nested-legacy.json', 'persona/desires/plans/legacy.json',
    'persona/desires/reviews/legacy.json', 'persona/desires/migration-backups/old/desire.json',
    'persona/desires/generator-scratchpad.json', 'persona/desires/metrics/agency-stats.json']
  const kept = ['memory/tasks/task.json', 'memory/projects/project.json', 'memory/README.md',
    'memory/schema.json', 'persona/core.json', 'persona/desires/config.json', 'persona/desires/config.json.enc', 'etc/models.json', 'etc/training.json',
    'out/adapters/model/adapter_model.safetensors', 'state/robot-status.json']
  for (const relative of [...erased, ...kept]) put(prefix + relative)
  for (const [id, relative] of [['old-desire', 'folders/old-desire/manifest.json'], ['legacy', 'pending/legacy.json'], ['nested-legacy', 'desires/pending/nested-legacy.json']]) {
    put(prefix + 'persona/desires/' + relative, JSON.stringify({ id, status: 'nascent', createdAt: '2026-01-01T00:00:00Z' }))
  }
  for (const mode of ['inner', 'conversation', 'system', 'robot']) {
    put(prefix + `state/conversation-buffer-${mode}.json`, JSON.stringify({ messages: [
      { role: 'user', content: 'synthetic old conversation' }], userMessageCount: 12,
      executionAdmissions: { example: { executionIds: ['old-id'], contentHash: 'hash' } } }))
  }
  return { prefix, erased, kept }
}
function deps(queue = new UnifiedQueueManager()) {
  return { coordinator: async () => queue, trainingProcesses: () => [], clearChatHistory: async (_username: string) => {},
    cancelExecution: (_username: string, _executionId: string, _reason: string) => { throw new Error('Unexpected cancellation in terminal-only fixture') } }
}
const definition = { graphId: 'reset-fixture', graphHash: 'v1', runtimeVersion: 'v1',
  checkpointSchemaVersion: 1, nodeVersions: {} }
function execution(username: string, terminal: boolean) {
  const file = path.join(root, 'profiles', username, 'state/sessions/executions.sqlite')
  const store = new ExecutionStore(file)
  const record = store.enter(username, definition, `fixture-${Date.now()}`, { message: 'old private context' })
  const lease = store.claim(record.executionId, definition)
  new ExecutionCheckpointer(store, lease)
  if (terminal) store.settle(lease, 'completed')
  store.release(lease)
  store.close()
  return { file, id: record.executionId }
}

test('confirmation, authenticated owner and exact account identity precede any deletion', async () => {
  const f = fixture()
  const req = request()
  for (const [candidate, status] of [
    [{ ...req, body: {} }, 400],
    [{ ...req, body: { ...req.body, confirmUsername: 'other-owner' } }, 400],
    [{ ...req, user: { ...req.user, isAuthenticated: false } }, 401],
    [{ ...req, user: { ...req.user, role: 'standard' } }, 403],
    [{ ...req, user: { ...req.user, userId: 'stale-user-id' } }, 403],
  ] as const) {
    assert.equal((await handleResetFactory(candidate as any, deps())).status, status)
    assert.ok(fs.existsSync(path.join(root, f.prefix, f.erased[0])))
  }
})

test('reset clears real buffers, durable SQLite history and only this profile\'s completed work', async () => {
  const f = fixture()
  fixture('other-owner')
  const session = createSession('reset-owner-id', 'owner')
  const otherSession = createSession('other-owner-id', 'owner')
  put('logs/run/training.pid')
  put('logs/audit/other-owner.ndjson')
  put('metahuman-runs/reset-owner/run/dataset.jsonl')
  const saved = execution('reset-owner', true)
  const queue = new UnifiedQueueManager()
  queue.setOnQueueChange(() => persistQueueState(queue.exportState()))
  let clearedView = false
  queue.addEventListener(event => {
    if (event.type === 'task_deleted') {
      assert.equal(queue.getHistory().some(task => task.username === 'reset-owner'), false)
      assert.equal(loadQueueState()?.history?.some(task => task.username === 'reset-owner'), false)
      clearedView = true
    }
  })
  for (const username of ['reset-owner', 'other-owner']) {
    const task = queue.enqueue({ username, type: 'generic', handler: 'test', input: { message: 'old text' } })
    assert.ok(queue.claim(task.id))
    queue.complete(task.id, true, { response: 'old answer' })
  }
  const result = await handleResetFactory(request(), deps(queue))
  assert.equal(result.status, 200, result.error)
  assert.equal(clearedView, true, 'History deletion must update the existing queue stream')
  assert.equal(result.data?.executionsDeleted, 1)
  assert.deepEqual(await listAllDesires('reset-owner'), [])
  for (const relative of f.erased) assert.equal(fs.existsSync(path.join(root, f.prefix, relative)), false, relative)
  for (const relative of f.kept) assert.ok(fs.existsSync(path.join(root, f.prefix, relative)), relative)
  for (const relative of ['logs/run/training.pid', 'logs/audit/other-owner.ndjson',
    'metahuman-runs/reset-owner/run/dataset.jsonl', 'profiles/other-owner/memory/episodic/example.json',
    'profiles/other-owner/persona/desires/folders/old-desire/manifest.json']) {
    assert.ok(fs.existsSync(path.join(root, relative)), relative)
  }
  assert.ok(validateSession(session.id))
  assert.ok(validateSession(otherSession.id))
  for (const mode of ['inner', 'conversation', 'system', 'robot'] as const) {
    const buffer = loadBufferForUser('reset-owner', mode)
    assert.deepEqual(buffer.messages, [])
    assert.equal(buffer.userMessageCount ?? 0, 0)
    assert.equal(Object.keys(buffer.executionAdmissions ?? {}).length, 0)
  }
  const reopened = new ExecutionStore(saved.file)
  assert.equal(reopened.list().length, 0)
  assert.equal(reopened.retirements().length, 0)
  assert.deepEqual(reopened.db.prepare('SELECT COUNT(*) AS count FROM execution_blobs').get(), { count: 0 })
  reopened.close()
  assert.equal(queue.getHistory().some(task => task.username === 'reset-owner'), false)
  assert.equal(queue.getHistory().some(task => task.username === 'other-owner'), true)
  assert.equal(loadQueueState()?.history?.some(task => task.username === 'reset-owner'), false)
  assert.equal((await handleResetFactory(request(), deps(queue))).status, 200)
})

test('queued work, live execution writers and unresolved results block reset before data changes', async () => {
  const f = fixture('busy-owner')
  const queue = new UnifiedQueueManager()
  queue.enqueue({ username: 'busy-owner', type: 'generic', handler: 'test', input: {} })
  assert.equal((await handleResetFactory(request('busy-owner'), deps(queue))).status, 409)
  assert.ok(fs.existsSync(path.join(root, f.prefix, f.erased[0])))
  const saved = execution('busy-owner', false)
  const store = new ExecutionStore(saved.file)
  const inactive = store.create('busy-owner', definition)
  const inactiveLease = store.claim(inactive.executionId, definition)
  store.settle(inactiveLease, 'waiting', 'operator_authorization')
  store.release(inactiveLease)
  const lease = store.claim(saved.id, definition)
  const result = await handleResetFactory(request('busy-owner'), deps())
  assert.equal(result.status, 409)
  assert.match(result.error!, /active worker/)
  assert.ok(fs.existsSync(path.join(root, f.prefix, f.erased[0])))
  assert.equal(store.list().length, 2)
  assert.equal(store.get(inactive.executionId).status, 'waiting', 'Refusal must not cancel inactive siblings')
  await new ExecutionCheckpointer(store, lease).put({ configurable: { thread_id: saved.id } }, {
    v: 4, id: 'pending-effect', ts: new Date().toISOString(), channel_values: {
      executionTransition: { transitionId: 'pending-effect', dispatches: [
        { effectId: 'unresolved-action', kind: 'coordinator_work', payload: {}, actionId: 'unresolved-action' },
      ] },
    }, channel_versions: {}, versions_seen: {},
  }, { source: 'loop', step: 0, parents: {} })
  store.settle(lease, 'failed')
  store.release(lease)
  store.close()
  const unresolved = await handleResetFactory(request('busy-owner'), deps())
  assert.equal(unresolved.status, 409)
  assert.match(unresolved.error!, /pending execution results/)
  assert.ok(fs.existsSync(path.join(root, f.prefix, f.erased[0])))
  const checked = new ExecutionStore(saved.file)
  assert.equal(checked.get(inactive.executionId).status, 'waiting')
  checked.close()
})

test('reset rejects a live cancelled writer but retires it after its lease expires without release', async t => {
  const username = 'lease-owner'
  const f = fixture(username)
  const file = path.join(root, f.prefix, 'state/sessions/executions.sqlite')
  const store = new ExecutionStore(file)
  t.after(() => store.close())
  const record = store.create(username, definition)
  const lease = store.claim(record.executionId, definition)
  store.cancel(record.executionId, { eventId: 'cancel-old-writer', kind: 'user_cancelled', payload: {} })
  const live = await handleResetFactory(request(username), deps())
  assert.equal(live.status, 409)
  assert.ok(fs.existsSync(path.join(root, f.prefix, f.erased[0])))
  const expiredAt = store.get(record.executionId).leaseUntil! + 1
  t.mock.method(Date, 'now', () => expiredAt)
  assert.throws(() => store.assertLease(lease), /Stale execution writer/)
  const expired = await handleResetFactory(request(username), deps())
  assert.equal(expired.status, 200, expired.error)
  assert.equal(expired.data?.executionsDeleted, 1)
  assert.equal(store.list().length, 0)
  assert.equal(fs.existsSync(path.join(root, f.prefix, f.erased[0])), false)
  assert.throws(() => store.renew(lease), /Unknown execution/)
})

test('confirmed reset closes inactive workflows through Work Coordinator even when the work queue is empty', async t => {
  const { beginAuthenticatedRuntime, selectAuthenticatedSession } = await import('../../sessions.js')
  beginAuthenticatedRuntime()
  selectAuthenticatedSession(createSession('idle-owner-id', 'owner').id)
  const { getQueueSystem } = await import('../../queue/queue-system.js')
  const system = getQueueSystem()
  t.after(() => system.dispose())
  const username = 'idle-owner'
  const cancelled: string[] = []
  system.on('queue', event => {
    if (event.type === 'execution_cancelled') cancelled.push(event.details.executionId)
  })
  const f = fixture(username)
  const file = path.join(root, f.prefix, 'state/sessions/executions.sqlite')
  const store = new ExecutionStore(file)
  t.after(() => store.close())
  const ids: string[] = []
  for (const reason of ['operator_authorization', 'user_or_autonomy', 'user_input']) {
    const record = store.create(username, definition)
    const lease = store.claim(record.executionId, definition)
    store.settle(lease, 'waiting', reason)
    store.release(lease)
    ids.push(record.executionId)
  }
  const abandoned = store.create(username, definition)
  ids.push(abandoned.executionId)
  assert.equal(system.queue.getAllTasks().length, 0)
  const dependencies = { ...deps(system.queue), cancelExecution: system.cancelExecution.bind(system) }
  const result = await handleResetFactory(request(username), dependencies)
  assert.equal(result.status, 200, result.error)
  assert.deepEqual(cancelled.sort(), ids.sort(), 'Every inactive workflow must use the existing cancellation owner')
  assert.equal(store.list().length, 0)
  assert.equal(fs.existsSync(path.join(root, f.prefix, f.erased[0])), false)
  const { recoverDurableExecutions } = await import('../../durable-execution/recovery.js')
  await recoverDurableExecutions(system.queue, 30)
  assert.equal(system.queue.getAllTasks().length, 0, 'Recovery must not recreate erased workflows')
  assert.equal((await handleResetFactory(request(username), dependencies)).status, 200)
})

test('reset removes speech text from both stores and advances interruption and generation fences', async () => {
  fixture()
  const speech = createTTSDeliveryQueueStore('reset-owner')
  const item = speech.enqueue('synthetic old speech', 'conversation', undefined, undefined, { id: 'old-speech', createdAt: Date.now() })!
  const claimed = speech.claimNext('fixture-browser').item!
  const previous = speech.readQueue()
  assert.ok(previous.admissions?.[item.id])
  const fallback = getFallbackTTSQueuePath('reset-owner')
  fs.mkdirSync(path.dirname(fallback), { recursive: true })
  fs.writeFileSync(fallback, JSON.stringify({ ...previous, generation: 30, interruptionRevision: 20 }))
  fs.writeFileSync(getTTSQueuePath('reset-owner') + '.corrupted-old', 'synthetic old speech backup')
  assert.equal((await handleResetFactory(request(), deps())).status, 200)
  for (const file of [getTTSQueuePath('reset-owner'), fallback]) {
    const next = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.deepEqual(next.items, [])
    assert.deepEqual(next.failed, [])
    assert.equal(Object.keys(next.admissions ?? {}).length, 0)
    assert.equal(next.generation, 31)
    assert.equal(next.interruptionRevision, 21)
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /synthetic old speech/)
  }
  assert.equal(fs.existsSync(getTTSQueuePath('reset-owner') + '.corrupted-old'), false)
  assert.equal(speech.updateDelivery(item.id, claimed.leaseToken, 'complete').accepted, false)
  assert.equal(speech.enqueue('late old synthesis', 'conversation', undefined, previous.generation), null)
})

test('a tracked worker blocks reset while another profile\'s work does not', async () => {
  fixture()
  const queue = new UnifiedQueueManager()
  queue.enqueue({ username: 'other-owner', type: 'generic', handler: 'test', input: {} })
  const injected = deps(queue)
  const result = await handleResetFactory(request(), { ...injected, trainingProcesses: () => [
    { name: 'full-cycle-local', pid: 12345, username: 'reset-owner' },
  ] })
  assert.equal(result.status, 409)
  assert.equal((await handleResetFactory(request(), injected)).status, 200)
  assert.equal(queue.getAllTasks().length, 1)
})

test('reset exclusion covers repeated requests, memory capture, buffer writes and new queue admission', async t => {
  fixture()
  const queue = new UnifiedQueueManager()
  let release!: () => void
  let entered!: () => void
  const paused = new Promise<void>(resolve => { release = resolve })
  const ready = new Promise<void>(resolve => { entered = resolve })
  t.after(() => release())
  const reset = handleResetFactory(request(), { ...deps(queue), clearChatHistory: async () => { entered(); await paused } })
  await ready
  assert.equal((await handleResetFactory(request(), deps(queue))).status, 409)
  assert.throws(() => queue.enqueue({ username: 'reset-owner', type: 'generic', input: {} }), /resetting/)
  queue.enqueue({ username: 'other-owner', type: 'generic', input: {} })
  assert.equal(writeFileSync({ username: 'reset-owner', category: 'memory', relativePath: 'new.json', data: '{}' }).success, false)
  assert.equal(writeFileSync({ username: 'reset-owner', category: 'config', subcategory: 'desires', relativePath: 'pending/new.json', data: '{}' }).success, false)
  assert.equal(writeFileSync({ username: 'reset-owner', category: 'memory', subcategory: 'agency', relativePath: 'pending/new.json', data: '{}' }).success, false)
  await assert.rejects(saveDesire({ id: 'late-desire', status: 'nascent' } as any, 'reset-owner'), /resetting/)
  await assert.rejects(saveGeneratorScratchpad({ lastRunAt: new Date().toISOString(), totalInputsAnalyzed: 1, analyzedInputTokens: [], maxTrackedIds: 10 }, 'reset-owner'), /resetting/)
  assert.equal(writeFileSync({ username: 'other-owner', category: 'config', subcategory: 'desires', relativePath: 'pending/new.json', data: '{}' }).success, true)
  await assert.rejects(withUserContext({ userId: 'reset-owner-id', username: 'reset-owner', role: 'owner' },
    () => captureEventWithDetails('late conversation')), /resetting/)
  await assert.rejects(writeBufferEntry('reset-owner', 'inner', { role: 'thought', content: 'late thought' }), /resetting/)
  release()
  assert.equal((await reset).status, 200)
  assert.equal(isLocked(profileMemoryResetLockName('reset-owner')), false)
  assert.equal(isLocked('training-admission'), false)
  assert.equal(await writeBufferEntry('reset-owner', 'inner', { role: 'thought', content: 'new thought' }), true)
})

test('a separately held profile lock survives rejection while this request releases its training lock', async () => {
  const f = fixture()
  const lock = acquireLock(profileMemoryResetLockName('reset-owner'), { exitOnSignal: false })
  try {
    assert.equal((await handleResetFactory(request(), deps())).status, 409)
    assert.equal(isLocked(profileMemoryResetLockName('reset-owner')), true)
    assert.equal(isLocked('training-admission'), false)
    assert.ok(fs.existsSync(path.join(root, f.prefix, f.erased[0])))
  } finally {
    lock.release()
  }
  assert.equal((await handleResetFactory(request(), deps())).status, 200)
})

test('custom profile storage is honored and locked encrypted profiles are refused', async () => {
  const external = users.find(user => user.username === 'external-owner')!
  const customRoot = path.join(root, 'custom-storage')
  external.metadata = { profileStorage: { path: customRoot, type: 'external', fallbackBehavior: 'error' } }
  put('custom-storage/memory/episodic/example.json')
  put('custom-storage/persona/desires/folders/custom/manifest.json')
  put('custom-storage/persona/desires/config.json', '{"enabled":false}')
  put('profiles/external-owner/memory/episodic/default-sentinel.json')
  saveUsers()
  assert.equal((await handleResetFactory(request('external-owner'), deps())).status, 200)
  assert.equal(fs.existsSync(path.join(customRoot, 'memory/episodic/example.json')), false)
  assert.equal(fs.existsSync(path.join(customRoot, 'persona/desires/folders/custom/manifest.json')), false)
  assert.equal(fs.readFileSync(path.join(customRoot, 'persona/desires/config.json'), 'utf8'), '{"enabled":false}')
  assert.ok(fs.existsSync(path.join(root, 'profiles/external-owner/memory/episodic/default-sentinel.json')))
  const encrypted = users.find(user => user.username === 'encrypted-owner')!
  encrypted.metadata = { profileStorage: { path: path.join(root, 'profiles/encrypted-owner'), type: 'internal', encryption: { type: 'aes256' } } }
  const f = fixture('encrypted-owner')
  saveUsers()
  const result = await handleResetFactory(request('encrypted-owner'), deps())
  assert.equal(result.status, 500)
  assert.match(result.error!, /locked/)
  assert.ok(fs.existsSync(path.join(root, f.prefix, f.erased[0])))
  const profileRoot = path.join(root, 'profiles/encrypted-owner')
  initializeEncryption(profileRoot, 'synthetic-reset-password')
  const encryptedWrite = writeFileSync({ username: 'encrypted-owner', category: 'memory',
    relativePath: 'encrypted.json', data: '{"content":"synthetic encrypted memory"}' })
  assert.equal(encryptedWrite.success, true)
  assert.ok(encryptedWrite.path?.endsWith('.enc'))
  const agencyWrite = writeFileSync({ username: 'encrypted-owner', category: 'config', subcategory: 'desires',
    relativePath: 'folders/encrypted/manifest.json', data: '{"id":"encrypted","status":"nascent"}' })
  const agencyConfig = writeFileSync({ username: 'encrypted-owner', category: 'config', subcategory: 'desires',
    relativePath: 'config.json', data: '{"enabled":false}' })
  assert.equal(agencyWrite.success, true, agencyWrite.error)
  assert.equal(agencyConfig.success, true, agencyConfig.error)
  const configBytes = fs.readFileSync(agencyConfig.path!)
  assert.equal((await handleResetFactory(request('encrypted-owner'), deps())).status, 200)
  assert.equal(fs.existsSync(encryptedWrite.path!), false)
  assert.equal(fs.existsSync(agencyWrite.path!), false)
  assert.deepEqual(fs.readFileSync(agencyConfig.path!), configBytes)
  lockProfile(profileRoot)
})

test('reset refuses overlapping profile roots and a cancelled request without deleting data', async () => {
  const f = fixture()
  const other = users.find(user => user.username === 'other-owner')!
  other.metadata = { profileStorage: { path: path.join(root, 'profiles/reset-owner'), type: 'external' } }
  saveUsers()
  const shared = await handleResetFactory(request(), deps())
  assert.equal(shared.status, 500)
  assert.match(shared.error!, /shared with another account/)
  assert.ok(fs.existsSync(path.join(root, f.prefix, f.erased[0])))
  other.metadata = {}
  saveUsers()
  const controller = new AbortController()
  controller.abort()
  assert.equal((await handleResetFactory({ ...request(), signal: controller.signal }, deps())).status, 409)
  assert.ok(fs.existsSync(path.join(root, f.prefix, f.erased[0])))
})

test('reset clears the capture deduplication cache without clearing another profile\'s cache', async () => {
  fixture()
  const capture = (username: string) => withUserContext({ userId: `${username}-id`, username, role: 'owner' },
    () => captureEventWithDetails('a new synthetic observation after reset'))
  assert.notEqual((await capture('reset-owner')).deduplicated, true)
  assert.notEqual((await capture('other-owner')).deduplicated, true)
  assert.equal((await capture('reset-owner')).deduplicated, true)
  assert.equal((await handleResetFactory(request(), deps())).status, 200)
  assert.notEqual((await capture('reset-owner')).deduplicated, true)
  assert.equal((await capture('other-owner')).deduplicated, true)
})

test('symlink escape and missing external storage fail preflight without deleting any data', async () => {
  const f = fixture()
  const target = path.join(root, f.prefix, 'memory/linked')
  fs.symlinkSync(path.join(root, 'profiles/other-owner/memory'), target)
  const result = await handleResetFactory(request(), deps())
  assert.equal(result.status, 500)
  assert.match(result.error!, /symbolic link/)
  assert.ok(fs.existsSync(path.join(root, f.prefix, f.erased[0])))
  fs.unlinkSync(target)
  const external = users.find(user => user.username === 'external-owner')!
  external.metadata = { profileStorage: { path: path.join(root, 'missing-volume'), type: 'external', fallbackBehavior: 'readonly' } }
  saveUsers()
  assert.equal((await handleResetFactory(request('external-owner'), deps())).status, 500)
  assert.ok(fs.existsSync(path.join(root, 'profiles/external-owner/memory/episodic/default-sentinel.json')))
})

test('a deletion failure reports incomplete work, preserves shared state and releases exclusion for an explicit retry', async () => {
  fixture()
  const original = fs.promises.rm
  const failure = mock.method(fs.promises, 'rm', async (target: fs.PathLike, options?: fs.RmOptions) => {
    if (String(target).endsWith('/out/chat')) throw new Error('synthetic filesystem failure')
    return original(target, options)
  })
  const result = await handleResetFactory(request(), deps())
  failure.mock.restore()
  assert.equal(result.status, 500)
  assert.match(result.error!, /incomplete.*synthetic filesystem failure/)
  assert.equal(isLocked(profileMemoryResetLockName('reset-owner')), false)
  assert.ok(fs.existsSync(path.join(root, 'logs/run/sessions.sqlite')))
  assert.equal((await handleResetFactory(request(), deps())).status, 200)
})


test('Agency paths are validated before any reset deletion', async () => {
  const f = fixture()
  const escape = path.join(root, f.prefix, 'persona/desires/escaped-history')
  fs.symlinkSync(path.join(root, 'profiles/other-owner/memory'), escape)
  try {
    const result = await handleResetFactory(request(), deps())
    assert.equal(result.status, 500)
    assert.match(result.error!, /symbolic link/)
    assert.ok(fs.existsSync(path.join(root, f.prefix, f.erased[0])))
    assert.ok(fs.existsSync(path.join(root, f.prefix, 'persona/desires/folders/old-desire/manifest.json')))
  } finally { fs.unlinkSync(escape) }
})
