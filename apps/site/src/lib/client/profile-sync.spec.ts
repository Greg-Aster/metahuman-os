import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { normalizeUrl } from './api-config'
import { configureRemoteSyncServer, runProfileSyncAgent } from './profile-sync'

test('sync source URLs accept the tunnel hostname and preserve explicit LAN HTTP', () => {
  assert.equal(normalizeUrl('example.com'), 'https://example.com')
  assert.equal(normalizeUrl('https:example.com'), 'https://example.com')
  assert.equal(normalizeUrl(' http://192.0.2.1:4321/ '), 'http://192.0.2.1:4321')
})

test('saving a sync source contacts only the local configuration owner', async t => {
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push(url)
    assert.equal(init.method, 'PUT')
    assert.deepEqual(JSON.parse(String(init.body)), {
      serverUrl: 'https://source.example', username: 'alice', password: 'fixture-password',
    })
    return Response.json({ configured: true })
  })
  assert.deepEqual(await configureRemoteSyncServer('source.example', 'alice', 'fixture-password'), { success: true })
  assert.deepEqual(calls, ['/api/profile-sync/config'])
})

function taskEvents(t: TestContext, events: Record<string, unknown>[]) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'EventSource')
  const streams: { url: string; closed: boolean }[] = []
  class FakeEventSource {
    onmessage: ((event: MessageEvent) => void) | null = null
    onerror: (() => void) | null = null
    closed = false
    constructor(public url: string) {
      streams.push(this)
      queueMicrotask(() => {
        for (const event of events) {
          if (this.closed) break
          if (event.connectionLost) this.onerror?.()
          else this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) }))
        }
      })
    }
    close() { this.closed = true }
  }
  Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: FakeEventSource })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'EventSource', original)
    else Reflect.deleteProperty(globalThis, 'EventSource')
  })
  return streams
}

test('authenticated sync waits on queue events without polling task status', async t => {
  const streams = taskEvents(t, [
    { type: 'queued_task_started', data: { taskId: 'fixture-task' } },
    { type: 'queued_task_completed', data: { taskId: 'fixture-task' } },
  ])
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    calls.push(url)
    assert.equal(init?.method, 'POST', 'task status must not be polled')
    return Response.json({ taskId: 'fixture-task' })
  })
  const result = await runProfileSyncAgent(['--full', '--skip-config'])
  assert.equal(result.success, true)
  assert.deepEqual(calls, ['/api/unified-queue/trigger/profile-sync'])
  assert.equal(streams[0].url, '/api/unified-queue/tasks/fixture-task/stream')
  assert.equal(streams[0].closed, true)
})

test('sync reports task failure and stream loss without reconnecting or claiming completion', async t => {
  for (const event of [
    { type: 'error', data: { message: 'Source unavailable' } },
    { connectionLost: true },
  ]) {
    await t.test(JSON.stringify(event), async child => {
      const streams = taskEvents(child, [event])
      child.mock.method(globalThis, 'fetch', async () => Response.json({ taskId: 'fixture-task' }))
      const result = await runProfileSyncAgent()
      assert.equal(result.success, false)
      assert.ok(result.error)
      assert.equal(streams[0].closed, true)
    })
  }
})

test('an already cancelled sync is not submitted', async t => {
  let called = false
  t.mock.method(globalThis, 'fetch', async () => { called = true; return Response.json({}) })
  const result = await runProfileSyncAgent([], undefined, { signal: AbortSignal.abort() })
  assert.equal(result.success, false)
  assert.equal(called, false)
})

test('cancelling the wait closes the stream without cancelling or resubmitting work', async t => {
  const controller = new AbortController()
  const streams = taskEvents(t, [{ type: 'queued_task_started', data: { taskId: 'fixture-task' } }])
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ taskId: 'fixture-task' }) })
  const result = await runProfileSyncAgent([], progress => {
    if (progress.phase === 'running') controller.abort()
  }, { signal: controller.signal })
  assert.equal(result.success, false)
  assert.match(result.error || '', /may still be running/)
  assert.equal(streams[0].closed, true)
  assert.equal(requests, 1)
})
