import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-auth-sync-'))
process.env.METAHUMAN_ROOT = root
const { setAuditEnabled } = await import('../../audit.js')
const { handleCreateSyncUser } = await import('./auth.js')
const { getUserByUsername, createUser } = await import('../../users.js')
const { loadProfileSyncConfig } = await import('../../profile-sync.js')
const { storageClient } = await import('../../storage-client.js')
const { eventBus } = await import('../../infrastructure/event-bus/client.js')
setAuditEnabled(false)
eventBus.disconnect()
after(() => {
  eventBus.disconnect()
  fs.rmSync(root, { recursive: true, force: true })
})

async function remoteFixture(
  username: string,
  run: (serverUrl: string, calls: string[]) => Promise<void>,
  options: { loginStatus?: number; exportStatus?: number; files?: unknown[]; bundleUsername?: string } = {},
) {
  const calls: string[] = []
  const server = http.createServer(async (req, res) => {
    calls.push(req.url!)
    assert.equal(req.headers.origin, undefined, 'remote requests must come from Node, without browser Origin')
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { username, password: 'fixture-password' })
    res.setHeader('Content-Type', 'application/json')
    // Deliberately no CORS headers: the original browser bootstrap cannot use this source.
    if (req.url === '/api/auth/login') {
      res.statusCode = options.loginStatus ?? 200
      res.end(JSON.stringify({ success: res.statusCode === 200, sessionId: 'remote-session', user: { username, metadata: { displayName: 'Remote fixture' }, role: 'owner' } }))
    } else {
      res.statusCode = options.exportStatus ?? 200
      res.end(JSON.stringify({ version: '1.0.0', exportedAt: '2026-09-29T12:00:00.000Z', username: options.bundleUsername ?? username,
        files: options.files ?? [{ path: 'persona/core.json', content: '{"identity":{"name":"Remote fixture"}}' }] }))
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    await run(`http://127.0.0.1:${(server.address() as any).port}`, calls)
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
}

function request(username: string, serverUrl?: string) {
  return { method: 'POST', path: '/api/auth/sync-user', body: { username, password: 'fixture-password', serverUrl },
    user: { id: '', username: '', role: 'guest', isAuthenticated: false } } as any
}

test('sync bootstrap imports and saves the source through Node before creating a session, including retry', async () => {
  const username = 'bootstrap-success'
  await remoteFixture(username, async (serverUrl, calls) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await handleCreateSyncUser(request(username, serverUrl))
      assert.equal(result.status, 200, result.error)
      assert.ok(result.data.sessionId)
      assert.equal(getUserByUsername(username)?.metadata?.displayName, 'Remote fixture')
      const config = await loadProfileSyncConfig(username)
      assert.equal(config?.serverUrl, serverUrl)
      assert.equal(config?.lastMemorySyncAt, undefined, 'bootstrap cannot claim the agent memory phase completed')
      const persona = await storageClient.read({ username, category: 'config', subcategory: 'persona', relativePath: 'core.json' })
      assert.equal(String(persona.data), '{"identity":{"name":"Remote fixture"}}')
    }
    assert.deepEqual(calls, ['/api/auth/login', '/api/profile-sync/export-priority', '/api/auth/login', '/api/profile-sync/export-priority'])
  })
})

test('sync bootstrap requires a source and rejects remote failures before creating an account', async () => {
  const missing = await handleCreateSyncUser(request('bootstrap-missing'))
  assert.equal(missing.status, 400)
  assert.equal(getUserByUsername('bootstrap-missing'), null)
  for (const [suffix, options] of [
    ['auth', { loginStatus: 401 }],
    ['download', { exportStatus: 500 }],
    ['identity', { bundleUsername: 'different-user' }],
    ['empty', { files: [] }],
    ['invalid', { files: [{ path: 'persona/core.json', content: '{invalid' }] }],
  ] as const) {
    const username = `bootstrap-${suffix}`
    await remoteFixture(username, async serverUrl => {
      const result = await handleCreateSyncUser(request(username, serverUrl))
      assert.ok(result.status >= 400, `${suffix} unexpectedly succeeded`)
      assert.equal(result.cookies, undefined)
      assert.equal(getUserByUsername(username), null)
    }, options as any)
  }
})

test('sync bootstrap checks existing local credentials before remote requests or writes', async () => {
  const username = 'bootstrap-existing'
  createUser(username, 'different-password', 'standard')
  await remoteFixture(username, async (serverUrl, calls) => {
    const result = await handleCreateSyncUser(request(username, serverUrl))
    assert.equal(result.status, 409)
    assert.deepEqual(calls, [])
  })
})

test('sync bootstrap reports a local storage failure without issuing a session', async () => {
  const username = 'bootstrap-storage-failure'
  fs.mkdirSync(path.join(root, 'profiles'), { recursive: true })
  fs.writeFileSync(path.join(root, 'profiles', username), 'Not a directory')
  await remoteFixture(username, async serverUrl => {
    const result = await handleCreateSyncUser(request(username, serverUrl))
    assert.equal(result.status, 500)
    assert.match(result.error || '', /setup incomplete/)
    assert.equal(result.cookies, undefined)
  })
})

test('bootstrap failures are logged to the terminal and audit with a stage and no credentials', async t => {
  const messages: unknown[][] = []
  t.mock.method(console, 'log', (...args: unknown[]) => messages.push(args))
  t.mock.method(console, 'error', (...args: unknown[]) => messages.push(args))
  setAuditEnabled(true)
  try {
    await remoteFixture('bootstrap-logged-failure', async serverUrl => {
      const result = await handleCreateSyncUser(request('bootstrap-logged-failure', `${serverUrl}/?token=private-query-token`))
      assert.equal(result.status, 502)
      const terminal = JSON.stringify(messages)
      assert.match(terminal, /profile_sync_bootstrap_started/)
      assert.match(terminal, /profile_sync_bootstrap_failed/)
      assert.match(terminal, /remote-login/)
      assert.match(terminal, /HTTP_401/)
      const logPath = path.join(root, 'logs', 'audit', `${new Date().toISOString().slice(0, 10)}.ndjson`)
      const auditText = fs.readFileSync(logPath, 'utf8')
      const entries = auditText.trim().split('\n').map(line => JSON.parse(line))
      const started = entries.find(entry => entry.event === 'profile_sync_bootstrap_started')
      const failed = entries.find(entry => entry.event === 'profile_sync_bootstrap_failed')
      assert.ok(started.details.requestId)
      assert.equal(failed.details.requestId, started.details.requestId)
      assert.equal(failed.details.stage, 'remote-login')
      assert.equal(failed.details.source, serverUrl)
      for (const text of [terminal, auditText]) {
        assert.equal(text.includes('fixture-password'), false)
        assert.equal(text.includes('private-query-token'), false)
        assert.equal(text.includes('remote-session'), false)
      }
    }, { loginStatus: 401 })
  } finally {
    setAuditEnabled(false)
  }
})

test('bootstrap transport exceptions log a safe cause code without leaking the error payload', async t => {
  const messages: unknown[][] = []
  t.mock.method(console, 'log', (...args: unknown[]) => messages.push(args))
  t.mock.method(console, 'error', (...args: unknown[]) => messages.push(args))
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed with fixture-password and private-query-token', {
      cause: Object.assign(new Error('remote-session'), { code: 'ECONNREFUSED' }),
    })
  })
  const result = await handleCreateSyncUser(request('bootstrap-network-failure', 'http://127.0.0.1:9'))
  assert.equal(result.status, 502)
  assert.equal(result.cookies, undefined)
  const terminal = JSON.stringify(messages)
  assert.match(terminal, /profile_sync_bootstrap_failed/)
  assert.match(terminal, /remote-login/)
  assert.match(terminal, /ECONNREFUSED/)
  for (const secret of ['fixture-password', 'private-query-token', 'remote-session']) {
    assert.equal(terminal.includes(secret), false)
  }
})

test('bootstrap completion logs file count without recording the issued session', async t => {
  const messages: unknown[][] = []
  t.mock.method(console, 'log', (...args: unknown[]) => messages.push(args))
  await remoteFixture('bootstrap-logged-success', async serverUrl => {
    const result = await handleCreateSyncUser(request('bootstrap-logged-success', serverUrl))
    assert.equal(result.status, 200)
    const completed = messages.find(args => args[1] === 'profile_sync_bootstrap_completed')
    assert.ok(completed)
    assert.equal((completed[2] as any).importedFiles, 1)
    assert.equal((completed[2] as any).source, serverUrl)
    const terminal = JSON.stringify(messages)
    assert.equal(terminal.includes(result.data.sessionId), false)
    assert.equal(terminal.includes('fixture-password'), false)
  })
})
