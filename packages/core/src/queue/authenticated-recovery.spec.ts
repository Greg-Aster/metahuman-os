import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import Database from 'better-sqlite3'
import test from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-authenticated-recovery-'))
process.env.METAHUMAN_ROOT = root
globalThis.fetch = async () => { throw new Error('External effects are forbidden in the authentication/recovery test') }
const { ROOT, systemPaths } = await import('../path-builder.js')
assert.equal(ROOT, root)
const { eventBus } = await import('../infrastructure/event-bus/client.js')
eventBus.disconnect()
const { setAuditEnabled } = await import('../audit.js')
setAuditEnabled(false)
const sessions = await import('../sessions.js')
const { claimWorkCoordinatorOwnership } = await import('./work-coordinator-ownership.js')
const { openExecutionStore } = await import('../durable-execution/storage.js')
const { recoverDurableExecutions } = await import('../durable-execution/recovery.js')
const { UnifiedQueueManager } = await import('./unified-queue-manager.js')
const { handleHttpRequest } = await import('../api/adapters/http.js')
const { createUser, updateUserMetadata } = await import('../users.js')
const { getProfilePaths } = await import('../paths.js')
const { ExecutionCheckpointer } = await import('../durable-execution/checkpointer.js')
const { executionWorkInput, relayExecutionOutbox } = await import('../durable-execution/coordinator-outbox.js')
const { deliverDurableWorkReceipt } = await import('../durable-execution/work-results.js')
const { ExecutionStore } = await import('../durable-execution/store.js')
const { loadBufferForUser } = await import('../conversation-buffer.js')

const definition = { graphId: 'auth-recovery-fixture', graphHash: 'v1', runtimeVersion: 'v1',
  checkpointSchemaVersion: 1, nodeVersions: {} }
const activeUsername = () => {
  const user = sessions.getCurrentlyActiveUser()
  return user && user.role !== 'guest' ? user.username : null
}
const request = (url: string, token?: string, body?: unknown) => handleHttpRequest({
  path: url, method: body === undefined ? 'GET' : 'POST', body,
  ...(token ? { cookieHeader: `mh_session=${token}` } : {}),
})
async function login(username: string): Promise<string> {
  const response = await request('/api/auth/login', undefined, { username, password: 'isolated-fixture-password' })
  assert.equal(response.status, 200, String(response.body))
  return JSON.parse(String(response.body)).sessionId
}

async function waitingWork(username: string, manager: InstanceType<typeof UnifiedQueueManager>) {
  const store = openExecutionStore(username)
  const record = store.create(username, definition)
  const lease = store.claim(record.executionId, definition)
  const effectId = randomUUID()
  try {
    await new ExecutionCheckpointer(store, lease).put({ configurable: { thread_id: record.executionId } }, {
      v: 4, id: randomUUID(), ts: new Date().toISOString(), channel_values: {
        executionTransition: { transitionId: randomUUID(), status: 'waiting', dispatches: [{ effectId,
          kind: 'coordinator_work', payload: { type: 'generic', handler: 'fixture.external',
            resource: 'local-llm', username, input: {} } },
          { effectId: `${effectId}:buffer`, kind: 'buffer_entry', payload: { mode: 'conversation',
            message: { role: 'assistant', content: `Pending output ${effectId}` } } }] },
      }, channel_versions: {}, versions_seen: {},
    }, { source: 'loop', step: 0, parents: {} })
    const task = manager.enqueue(executionWorkInput(store, store.dispatch(effectId)))
    store.acknowledgeAdmission(effectId, task.id)
    assert.ok(manager.claim(task.id))
    store.acceptAction(effectId)
    manager.wait(task.id, 'Awaiting the isolated external result')
    return { record, task, bufferEffectId: `${effectId}:buffer` }
  } finally { store.release(lease); store.close() }
}

test('authentication owns recovery selection across startup, profile switches and logout', async t => {
  const users = ['profile-a', 'profile-b'].map((username, index) =>
    createUser(username, 'isolated-fixture-password', index === 0 ? 'owner' : 'standard'))
  const storedSession = sessions.createSession(users[0].id, 'owner')
  const oldManager = new UnifiedQueueManager()
  const oldWork = users.map(user => oldManager.enqueue({ type: 'generic', handler: 'fixture.old',
    username: user.username, input: {} }))
  const stores = ['profile-a', 'profile-b'].map(username => openExecutionStore(username))
  try {
    const records = stores.map((store, index) => store.create(`profile-${index ? 'b' : 'a'}`, definition))
    claimWorkCoordinatorOwnership()
    const manager = new UnifiedQueueManager()
    manager.configureRecovery(sessions.getAuthenticatedRuntimeId()!, activeUsername)
    manager.importState(JSON.parse(JSON.stringify(oldManager.exportState())))
    let token = ''

    await t.test('persisted cookies and restored jobs cannot recover or claim work before authentication', async () => {
      assert.equal(sessions.validateSession(storedSession.id)?.id, storedSession.id)
      await recoverDurableExecutions(manager, 30)
      assert.deepEqual({ selected: activeUsername(), admitted: manager.getAllTasks().length,
        effects: stores.map((store, index) => store.dispatches(records[index].executionId).length) },
      { selected: null, admitted: 2, effects: [0, 0] })
      assert.equal(manager.getNextExecutable(), null)
      oldWork.forEach(task => assert.equal(manager.claim(task.id), null))
      assert.equal((await request('/api/auth/me')).status, 401)
      assert.equal((await request('/api/auth/me', 'invalid')).status, 401)
      assert.equal(activeUsername(), null)
    })

    await t.test('successful login recovers only that profile and repeated /auth/me is idempotent', async () => {
      token = await login(users[0].username)
      assert.equal(activeUsername(), users[0].username)
      const observer = new Database(systemPaths.sessionsFile)
      try {
        const version = observer.pragma('data_version', { simple: true })
        assert.equal((await request('/api/auth/me', token)).status, 200)
        assert.equal(observer.pragma('data_version', { simple: true }), version)
      } finally { observer.close() }
      await recoverDurableExecutions(manager, 30)
      assert.ok(stores[0].dispatches(records[0].executionId).length > 0)
      assert.equal(stores[1].dispatches(records[1].executionId).length, 0)
      assert.equal(manager.getNextExecutable(work => work.id === oldWork[0].id)?.id, oldWork[0].id)
      assert.equal(manager.claim(oldWork[1].id), null)
    })

    await t.test('Brain workers observe the same selected session without selecting an old user', () => {
      const source = `const {getCurrentlyActiveUser}=await import(${JSON.stringify(new URL('../sessions.ts', import.meta.url).href)}); console.log(JSON.stringify(getCurrentlyActiveUser()))`
      const output = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
        env: { ...process.env, METAHUMAN_ROOT: root }, encoding: 'utf8', timeout: 10_000,
      }).trim().split('\n').at(-1)!
      assert.equal(JSON.parse(output).username, users[0].username)
    })

    await t.test('switching and logout park prior work without cancelling or falling back to another cookie', async () => {
      token = await login(users[1].username)
      assert.equal(activeUsername(), users[1].username)
      await recoverDurableExecutions(manager, 30)
      assert.ok(stores[1].dispatches(records[1].executionId).length > 0)
      assert.equal(manager.claim(oldWork[0].id), null)
      assert.equal(manager.getNextExecutable(work => work.id === oldWork[1].id)?.id, oldWork[1].id)
      assert.equal((await request('/api/auth/logout', token, {})).status, 200)
      assert.equal(activeUsername(), null)
      assert.ok(sessions.getSession(storedSession.id), 'The other persisted cookie still exists but is not selected')
      assert.equal(manager.getNextExecutable(), null)
      assert.equal(manager.getTask(oldWork[0].id)?.state, 'queued')
      assert.equal(manager.getTask(oldWork[1].id)?.state, 'queued')
      const autonomous = manager.enqueue({ type: 'generic', handler: 'graph.signal', username: users[0].username, input: {} })
      assert.equal(manager.claim(autonomous.id), null, 'A newly delivered continuation cannot bypass logout')
    })

    await t.test('a locked profile is not selected; canonical locking and session expiry revoke readiness', async () => {
      assert.equal((await request('/api/auth/me', storedSession.id)).status, 200)
      const profile = getProfilePaths(users[0].username).root
      updateUserMetadata(users[0].id, { profileStorage: {
        path: profile, type: 'encrypted', encryption: { type: 'aes256', unlocked: false },
      } })
      assert.equal((await request('/api/encryption/lock', storedSession.id, {})).status, 200)
      assert.equal(activeUsername(), null)
      assert.equal((await request('/api/auth/me', storedSession.id)).status, 401)
      await recoverDurableExecutions(manager, 30)
      assert.equal(manager.getNextExecutable(), null)
      updateUserMetadata(users[0].id, { profileStorage: { path: profile, type: 'internal', encryption: { type: 'none' } } })
      assert.equal((await request('/api/encryption/unlock', storedSession.id, { password: 'fixture' })).status, 200)
      assert.equal(activeUsername(), users[0].username)
      const session = sessions.getSession(storedSession.id)!
      sessions.updateSession({ ...session, expiresAt: new Date(Date.now() - 1).toISOString() })
      assert.equal(activeUsername(), null)
      assert.equal(manager.claim(oldWork[0].id), null)
      assert.equal((await request('/api/auth/me', storedSession.id)).status, 401)
    })

    await t.test('restart clears selection but does not delete sessions or saved executions', async () => {
      token = await login(users[1].username)
      const before = sessions.getAuthenticatedRuntimeId()
      sessions.beginAuthenticatedRuntime()
      assert.notEqual(sessions.getAuthenticatedRuntimeId(), before)
      assert.equal(activeUsername(), null)
      assert.ok(sessions.getSession(token))
      const restarted = new UnifiedQueueManager()
      restarted.configureRecovery(sessions.getAuthenticatedRuntimeId()!, activeUsername)
      restarted.importState(JSON.parse(JSON.stringify(manager.exportState())))
      await recoverDurableExecutions(restarted, 30)
      assert.equal(restarted.getNextExecutable(), null)
      records.forEach((record, index) => assert.equal(stores[index].get(record.executionId).status, 'running'))
      assert.equal((await request('/api/auth/me', token)).status, 200)
      assert.equal(activeUsername(), users[1].username)
      assert.equal(restarted.getNextExecutable(work => work.id === oldWork[1].id)?.id, oldWork[1].id)
    })
  } finally { stores.forEach(store => store.close()) }
})

test('ordinary authenticated requests restore the current profile after restart without an auth-page round trip', async t => {
  const token = await login('profile-a')
  sessions.beginAuthenticatedRuntime()
  assert.equal(activeUsername(), null)
  assert.ok(sessions.getSession(token), 'The browser cookie remains valid across the server restart')
  const previous = new UnifiedQueueManager()
  const own = previous.enqueue({ type: 'generic', handler: 'fixture.old', username: 'profile-a', input: {} })
  const other = previous.enqueue({ type: 'generic', handler: 'fixture.old', username: 'profile-b', input: {} })
  const manager = new UnifiedQueueManager()
  manager.configureRecovery(sessions.getAuthenticatedRuntimeId()!, activeUsername)
  manager.importState(JSON.parse(JSON.stringify(previous.exportState())))
  assert.equal(manager.getNextExecutable(), null)
  const notifications: unknown[] = []
  t.mock.method(eventBus, 'emit', (...[_source, event, data]: Parameters<typeof eventBus.emit>) => {
    if (event !== 'session.selection_changed') return
    const reader = new Database(systemPaths.sessionsFile, { readonly: true })
    try {
      const row = reader.prepare('SELECT document FROM session_store WHERE id=1').get() as { document: string }
      notifications.push({ selected: JSON.parse(row.document).runtime.sessionId === token, data })
    } finally { reader.close() }
  })

  // This is the ordinary authenticated path used by an already-open chat page,
  // not login, auth/me, a profile scan, or a direct session-selection call.
  const response = await request('/api/active-operator/config', token)
  assert.equal(response.status, 200, String(response.body))
  assert.equal(activeUsername(), 'profile-a')
  assert.deepEqual(notifications, [{ selected: true, data: undefined }],
    'Background owners are notified after commit, without exposing session credentials')
  assert.equal(manager.getNextExecutable()?.id, own.id)
  assert.equal(manager.claim(other.id), null, 'Another stored profile is not activated')

  const observer = new Database(systemPaths.sessionsFile)
  try {
    const before = observer.pragma('data_version', { simple: true })
    assert.equal((await request('/api/active-operator/config', token)).status, 200)
    assert.equal(observer.pragma('data_version', { simple: true }), before,
      'Repeated authenticated requests do not rewrite an unchanged selection')
  } finally { observer.close() }
  assert.equal(notifications.length, 1, 'Unchanged requests do not rearm autonomous schedules')
  assert.equal((await request('/api/auth/logout', token, {})).status, 200)
  assert.equal((await request('/api/active-operator/config', token)).status, 401)
  assert.equal(activeUsername(), null, 'A revoked cookie cannot restore background execution')
  assert.deepEqual(notifications.at(-1), { selected: false, data: undefined })
})

test('request restoration preserves explicit authentication changes across asynchronous storage checks', async t => {
  const tokenA = await login('profile-a')
  const tokenB = await login('profile-b')
  const userA = sessions.getSession(tokenA)!.userId
  const userB = sessions.getSession(tokenB)!.userId

  await t.test('an old tab cannot switch away from the selected login', async () => {
    assert.equal((await request('/api/active-operator/config', tokenA)).status, 200)
    assert.equal(activeUsername(), 'profile-b')
  })

  await t.test('newer login and server restart win over an outstanding readiness check', async () => {
    sessions.beginAuthenticatedRuntime()
    const switching = sessions.restoreAuthenticatedSession(tokenA, userA)
    sessions.selectAuthenticatedSession(tokenB)
    await switching
    assert.equal(activeUsername(), 'profile-b')

    sessions.beginAuthenticatedRuntime()
    const restarting = sessions.restoreAuthenticatedSession(tokenA, userA)
    sessions.beginAuthenticatedRuntime()
    await restarting
    assert.equal(activeUsername(), null)
  })

  await t.test('locking revokes checks already running and new requests during unmount', async () => {
    sessions.beginAuthenticatedRuntime()
    const locking = sessions.restoreAuthenticatedSession(tokenA, userA)
    sessions.clearAuthenticatedUser(userA)
    await locking
    assert.equal(activeUsername(), null)
    // Storage can still report ready while an asynchronous unmount is pending.
    // A new polling request must not reverse the canonical lock's revocation.
    assert.equal((await request('/api/active-operator/config', tokenA)).status, 200)
    assert.equal(activeUsername(), null)
    sessions.selectAuthenticatedSession(null)
    await sessions.restoreAuthenticatedSession(tokenB, userB)
    assert.equal(activeUsername(), null, 'Explicitly clearing selection never falls back to another cookie')
  })

  await t.test('locked storage, guest sessions, identity mismatches and deleted cookies cannot restore', async () => {
    sessions.beginAuthenticatedRuntime()
    const profile = getProfilePaths('profile-a').root
    updateUserMetadata(userA, { profileStorage: {
      path: profile, type: 'encrypted', encryption: { type: 'aes256', unlocked: false },
    } })
    try {
      assert.equal((await request('/api/active-operator/config', tokenA)).status, 200)
      assert.equal(activeUsername(), null)
    } finally {
      updateUserMetadata(userA, { profileStorage: { path: profile, type: 'internal', encryption: { type: 'none' } } })
    }
    const guest = sessions.createSession(userA, 'guest')
    await sessions.restoreAuthenticatedSession(guest.id, userA)
    await sessions.restoreAuthenticatedSession(tokenA, userB)
    assert.equal(activeUsername(), null)

    const loggedOut = sessions.restoreAuthenticatedSession(tokenA, userA)
    sessions.deleteSession(tokenA)
    await loggedOut
    assert.equal(activeUsername(), null)
    assert.equal((await request('/api/active-operator/config', tokenA)).status, 401)
    await sessions.restoreAuthenticatedSession(tokenB, userB)
    assert.equal(activeUsername(), null, 'Logout during restoration does not select a different persisted cookie')
  })
})

test('result evidence is retained while only prior-runtime continuations require login', async () => {
  sessions.beginAuthenticatedRuntime()
  const previous = new UnifiedQueueManager()
  previous.configureRecovery(sessions.getAuthenticatedRuntimeId()!, activeUsername)
  // Explicit work can finish its model/tool cycle without a browser login.
  const old = await waitingWork('profile-a', previous)
  sessions.beginAuthenticatedRuntime()
  const manager = new UnifiedQueueManager()
  manager.configureRecovery(sessions.getAuthenticatedRuntimeId()!, activeUsername)
  manager.importState(JSON.parse(JSON.stringify(previous.exportState())))
  const current = await waitingWork('profile-b', manager)
  for (const entry of [old, current]) {
    manager.complete(entry.task.id, true, { observed: true })
    const task = manager.getTask(entry.task.id)!
    await deliverDurableWorkReceipt(task, async input => manager.enqueue(input))
    const store = openExecutionStore(task.username)
    try {
      assert.equal(store.events(entry.record.executionId).filter(event => event.kind === 'work_result').length, 1)
      const continuation = manager.getAllTasks().find(work => work.handler === 'graph.resume'
        && work.durable?.executionId === entry.record.executionId)
      if (entry === old) {
        assert.equal(continuation, undefined)
        assert.equal(store.dispatch(entry.bufferEffectId).status, 'pending')
        assert.equal(loadBufferForUser(task.username, 'conversation').messages.length, 0)
        const pending = store.dispatches(entry.record.executionId).find(effect => effect.kind === 'graph_resume')!
        assert.equal(pending.status, 'pending')
        // Even direct queue admission of the waiting effect retains the old execution's scope.
        const admitted = manager.enqueue(executionWorkInput(store, pending))
        assert.equal(manager.claim(admitted.id), null)
      } else {
        assert.ok(continuation)
        assert.equal(manager.getNextExecutable(work => work.id === continuation.id)?.id, continuation.id)
        assert.equal(store.dispatch(entry.bufferEffectId).status, 'completed')
      }
    } finally { store.close() }
  }
  await login('profile-a')
  const resumed = openExecutionStore('profile-a')
  try {
    await relayExecutionOutbox(resumed, old.record.executionId, async input => manager.enqueue(input))
    assert.equal(resumed.dispatch(old.bufferEffectId).status, 'completed')
  } finally { resumed.close() }
  assert.ok(manager.getNextExecutable(work => work.durable?.executionId === old.record.executionId))
})

test('parked restored stops do not block fresh work, while explicit stop retains body cancellation', () => {
  const before = new UnifiedQueueManager()
  before.configureRecovery('before-restart', () => null)
  const command = (type: string) => ({ type: 'environment_command' as const, handler: 'environment.command',
    username: 'profile-a', resource: 'body:fixture', input: { id: randomUUID(), sessionId: 'fixture', type } })
  const oldStop = before.enqueue(command('stop'))
  const manager = new UnifiedQueueManager()
  manager.configureRecovery('after-restart', () => null)
  manager.importState(JSON.parse(JSON.stringify(before.exportState())))
  assert.equal(manager.claim(oldStop.id), null)
  const movement = manager.enqueue(command('robotCommand'))
  const stop = manager.enqueue(command('stop'))
  assert.equal(manager.getTask(movement.id)?.state, 'cancelled')
  assert.ok(manager.claim(stop.id))
  manager.complete(stop.id, true)
  const later = manager.enqueue(command('robotCommand'))
  assert.ok(manager.claim(later.id))
  assert.equal(manager.getTask(oldStop.id)?.state, 'queued')
})

test('recovery stops between effects when authentication changes, retaining the pending outbox', async () => {
  sessions.beginAuthenticatedRuntime()
  await login('profile-a')
  const store = openExecutionStore('profile-a')
  const record = store.create('profile-a', definition)
  const lease = store.claim(record.executionId, definition)
  const ids = [randomUUID(), randomUUID()]
  try {
    await new ExecutionCheckpointer(store, lease).put({ configurable: { thread_id: record.executionId } }, {
      v: 4, id: randomUUID(), ts: new Date().toISOString(), channel_values: {
        executionTransition: { transitionId: randomUUID(), dispatches: ids.map(effectId => ({ effectId,
          kind: 'coordinator_work', payload: { type: 'generic', handler: 'fixture.external', username: 'profile-a', input: {} } })) },
      }, channel_versions: {}, versions_seen: {},
    }, { source: 'loop', step: 0, parents: {} })
    const manager = new UnifiedQueueManager()
    await relayExecutionOutbox(store, record.executionId, async input => {
      const task = manager.enqueue(input)
      sessions.selectAuthenticatedSession(null)
      return task
    }, () => activeUsername() === 'profile-a')
    assert.equal(manager.getAllTasks().length, 1)
    assert.equal(store.dispatch(ids[0]).status, 'admitted')
    assert.equal(store.dispatch(ids[1]).status, 'pending')
  } finally { store.release(lease); store.close() }
})

test('opening a pre-upgrade execution preserves its identity and does not mark it as fresh', () => {
  const filename = path.join(root, 'legacy.sqlite')
  let store = new ExecutionStore(filename)
  const saved = store.create('profile-a', definition)
  store.db.exec('ALTER TABLE executions DROP COLUMN origin_runtime_id')
  store.close()
  store = new ExecutionStore(filename, undefined, 'new-runtime')
  try {
    assert.equal(store.get(saved.executionId).originRuntimeId, undefined)
    assert.equal(store.get(saved.executionId).definition.graphId, definition.graphId)
    assert.equal(store.create('profile-a', definition).originRuntimeId, 'new-runtime')
  } finally { store.close() }
})

test('legacy cookies migrate once and a retired JSON snapshot cannot restore deleted sessions', () => {
  const migrationRoot = fs.mkdtempSync(path.join(root, 'legacy-sessions-'))
  const code = `
    import fs from 'node:fs'; import path from 'node:path';
    const {systemPaths}=await import(${JSON.stringify(new URL('../path-builder.ts', import.meta.url).href)});
    const legacy=path.join(systemPaths.run,'sessions.json');
    fs.mkdirSync(systemPaths.run,{recursive:true});
    const session={id:'old-cookie',userId:'fixture-user',role:'owner',createdAt:new Date().toISOString(),
      expiresAt:new Date(Date.now()+3600000).toISOString(),lastActivity:new Date().toISOString()};
    const snapshot=JSON.stringify({version:1,sessions:[session],runtime:{id:'old-runtime',pid:process.pid,sessionId:session.id}});
    fs.writeFileSync(legacy,snapshot,{mode:0o600});
    const {setAuditEnabled}=await import(${JSON.stringify(new URL('../audit.ts', import.meta.url).href)});setAuditEnabled(false);
    const sessions=await import(${JSON.stringify(new URL('../sessions.ts', import.meta.url).href)});
    const imported=sessions.getSession(session.id);
    const selected=sessions.getCurrentlyActiveUser();
    sessions.deleteSession(session.id);
    const backups=fs.readdirSync(systemPaths.run).filter(name=>name.startsWith('sessions.json.migrated-'));
    console.log(JSON.stringify({imported,selected,legacyExists:fs.existsSync(legacy),backups:backups.length,
      backupMatches:fs.readFileSync(path.join(systemPaths.run,backups[0]),'utf8')===snapshot}));`
  const run = (source: string) => execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
    env: { ...process.env, METAHUMAN_ROOT: migrationRoot }, encoding: 'utf8', timeout: 10_000,
  }).trim().split('\n').at(-1)!
  const migrated = JSON.parse(run(code))
  assert.equal(migrated.imported.id, 'old-cookie')
  assert.equal(migrated.selected, null)
  assert.equal(migrated.legacyExists, false)
  assert.equal(migrated.backups, 1)
  assert.equal(migrated.backupMatches, true)
  const deleted = JSON.parse(run(`const sessions=await import(${JSON.stringify(new URL('../sessions.ts', import.meta.url).href)});
    console.log(JSON.stringify(sessions.getSession('old-cookie')));`))
  assert.equal(deleted, null, 'A new process must use SQLite, not the retired snapshot')
})

test('an overlapping activity write cannot overwrite the new server runtime', async () => {
  sessions.beginAuthenticatedRuntime()
  const token = await login('profile-a')
  const originalRuntime = sessions.getAuthenticatedRuntimeId()
  const session = sessions.getSession(token)!
  sessions.updateSession({ ...session, lastActivity: new Date(Date.now() - 120_000).toISOString() })
  const directory = fs.mkdtempSync(path.join(root, 'session-race-'))
  const filename = (name: string) => path.join(directory, name)
  const common = `
    import fs from 'node:fs'; import path from 'node:path';
    const {eventBus}=await import(${JSON.stringify(new URL('../infrastructure/event-bus/client.ts', import.meta.url).href)});eventBus.disconnect();
    const {setAuditEnabled}=await import(${JSON.stringify(new URL('../audit.ts', import.meta.url).href)});setAuditEnabled(false);
    const sessions=await import(${JSON.stringify(new URL('../sessions.ts', import.meta.url).href)});
    const directory=${JSON.stringify(directory)};
    const filename=name=>path.join(directory,name);`
  const activity = common + `
    const {default:Database}=await import(${JSON.stringify(createRequire(import.meta.url).resolve('better-sqlite3'))});
    sessions.getSession(${JSON.stringify(token)});
    const prepare=Database.prototype.prepare;let paused=false;
    Database.prototype.prepare=function(sql,...args) {
      if (!paused && sql.startsWith('UPDATE session_store')) {
        paused=true;fs.writeFileSync(filename('activity-locked'),'ready');
        const deadline=Date.now()+10000;
        while(!fs.existsSync(filename('release'))) {
          if(Date.now()>deadline) throw new Error('Timed out waiting for test release');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
        }
      }
      return prepare.call(this,sql,...args);
    };
    sessions.validateSession(${JSON.stringify(token)});`
  const restart = common + `
    fs.writeFileSync(filename('restart-entering'),'ready');
    sessions.beginAuthenticatedRuntime();
    fs.writeFileSync(filename('restart-result'),JSON.stringify({runtime:sessions.getAuthenticatedRuntimeId(),user:sessions.getCurrentlyActiveUser()}));`
  const launch = (source: string) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], {
      env: { ...process.env, METAHUMAN_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', chunk => { stderr += chunk })
    child.stdout.resume()
    const completion = new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(stderr || `Worker exited ${code}`)))
    })
    return { child, completion }
  }
  const waitFor = async (name: string) => {
    const deadline = Date.now() + 8_000
    while (!fs.existsSync(filename(name))) {
      assert.ok(Date.now() < deadline, `Worker did not reach ${name}`)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  const writer = launch(activity)
  let resetting: ReturnType<typeof launch> | undefined
  try {
    await waitFor('activity-locked')
    resetting = launch(restart)
    await waitFor('restart-entering')
    fs.writeFileSync(filename('release'), 'release')
    await Promise.all([writer.completion, resetting.completion])
    const result = JSON.parse(fs.readFileSync(filename('restart-result'), 'utf8'))
    assert.notEqual(result.runtime, originalRuntime)
    assert.equal(result.user, null)
    const observer = new Database(systemPaths.sessionsFile)
    try {
      const { document } = observer.prepare('SELECT document FROM session_store WHERE id=1').get() as { document: string }
      assert.equal(JSON.parse(document).runtime.id, result.runtime)
      assert.equal(JSON.parse(document).runtime.sessionId, undefined)
    } finally { observer.close() }
    assert.ok(Date.parse(sessions.getSession(token)!.lastActivity) > Date.parse(session.lastActivity) - 1)
    sessions.beginAuthenticatedRuntime()
    sessions.selectAuthenticatedSession(token)
    assert.equal(activeUsername(), 'profile-a')
  } finally {
    // Only these isolated child processes, never installed services.
    if (writer.child.exitCode === null) writer.child.kill()
    if (resetting?.child.exitCode === null) resetting.child.kill()
  }
})
