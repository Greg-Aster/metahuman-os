import assert from 'node:assert/strict'
import test from 'node:test'
import { TerminalController } from './controller.js'

class Source extends EventTarget {
  static all: Source[] = []
  readyState = 1
  onopen?: () => void
  onerror?: () => void
  onmessage?: (event: { data: string }) => void
  constructor(readonly url: string) { super(); Source.all.push(this) }
  close() { this.readyState = 2 }
  send(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
}
const originalFetch = globalThis.fetch
const originalSource = globalThis.EventSource
globalThis.EventSource = Source as unknown as typeof EventSource
const state = { status: 'running', sessions: [{ id: 'one', kind: 'shell', phase: 'running', title: 'Shell', cols: 80, rows: 24 }] }
function reply(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }) }
test.after(() => { globalThis.fetch = originalFetch; globalThis.EventSource = originalSource })

test('late initial response after disposal cannot subscribe or create a session', async () => {
  let resolve!: (value: Response) => void
  const urls: string[] = []
  globalThis.fetch = async url => { urls.push(String(url)); return new Promise<Response>(r => { resolve = r }) }
  const events: unknown[] = []
  const controller = new TerminalController(event => events.push(event), () => {})
  const pending = controller.refresh()
  controller.dispose()
  resolve(reply(state))
  await assert.rejects(pending, /aborted/)
  assert.deepEqual(urls, ['/api/terminal/state'])
  assert.deepEqual(events, [])
  assert.equal(Source.all.filter(source => source.readyState !== 2).length, 0)
})

test('stopped status creates no subscription; hide closes one stream without closing its shell', async () => {
  const calls: string[] = []
  globalThis.fetch = async url => { calls.push(String(url)); return reply({ status: 'stopped', sessions: [] }) }
  const controller = new TerminalController(() => {}, () => {})
  await controller.refresh()
  assert.equal(Source.all.filter(source => source.readyState !== 2).length, 0)
  globalThis.fetch = async url => { calls.push(String(url)); return reply(state) }
  await controller.refresh()
  assert.equal(Source.all.filter(source => source.readyState !== 2).length, 1)
  controller.dispose()
  assert.equal(Source.all.filter(source => source.readyState !== 2).length, 0)
  assert.deepEqual(calls, ['/api/terminal/state', '/api/terminal/state'])
})

test('failed close preserves selection; reconnect replaces the stream and stale events are ignored', async () => {
  globalThis.fetch = async () => reply(state)
  const events: unknown[] = []
  const errors: string[] = []
  const controller = new TerminalController(event => events.push(event), error => errors.push(error))
  try {
    await controller.refresh()
    const first = Source.all.at(-1)!
    globalThis.fetch = async () => reply({ error: 'permission denied' }, 500)
    await assert.rejects(controller.close('one'), /permission denied/)
    assert.equal(controller.selected, 'one')
    assert.equal(first.readyState, 1)
    first.onerror!()
    assert.equal(Source.all.filter(source => source.readyState !== 2).length, 0)
    globalThis.fetch = async () => reply(state)
    await controller.refresh()
    const count = events.length
    first.send({ type: 'error', error: 'stale callback' })
    assert.equal(events.length, count)
    assert.equal(Source.all.filter(source => source.readyState !== 2).length, 1)
    assert.equal(errors.length, 1)
  } finally { controller.dispose() }
})

test('input is ordered and a transport failure is surfaced without replay', async () => {
  const writes: string[] = []
  let release!: (value: Response) => void
  let called!: () => void
  const started = new Promise<void>(resolve => { called = resolve })
  globalThis.fetch = async (_url, init) => {
    const data = init?.body ? JSON.parse(String(init.body)) : null
    if (!data) return reply(state)
    writes.push(data.data)
    called()
    return new Promise<Response>(resolve => { release = resolve })
  }
  const errors: string[] = []
  const controller = new TerminalController(() => {}, message => errors.push(message))
  try {
    await controller.refresh()
    controller.input('first')
    await started
    controller.input('second')
    release(reply({ error: 'input rejected' }, 409))
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.deepEqual(writes, ['first'])
    assert.deepEqual(errors, ['input rejected'])
  } finally { controller.dispose() }
})

test('terminal opens alongside existing streams and disposal closes only its own stream', async () => {
  globalThis.fetch = async () => reply(state)
  const background = Array.from({ length: 12 }, (_, i) => new Source(`/fixture-${i}`))
  const controller = new TerminalController(() => {}, () => {})
  try {
    await controller.refresh()
    const terminal = Source.all.at(-1)!
    assert.equal(terminal.url, '/api/terminal/events?id=one')
    assert.equal(terminal.readyState, 1)
    assert.ok(background.every(source => source.readyState === 1))
    controller.dispose()
    assert.equal(terminal.readyState, 2)
    assert.ok(background.every(source => source.readyState === 1))
  } finally { controller.dispose(); background.forEach(source => source.close()) }
})
