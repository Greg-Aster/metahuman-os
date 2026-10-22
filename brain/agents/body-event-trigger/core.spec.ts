import assert from 'node:assert/strict'
import { after, mock, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Socket } from 'node:net'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'body-event-agent-'))
process.env.METAHUMAN_ROOT = root
globalThis.fetch = async () => { throw new Error('No network in body event entrypoint tests') }
mock.method(Socket.prototype, 'connect', function (this: Socket) {
  queueMicrotask(() => this.destroy(Object.assign(new Error('Test transport disabled'), { code: 'ECONNREFUSED' })))
  return this
})
const core = await import('@metahuman/core')
core.setAuditEnabled(false)
const loaded: string[] = []
const runs: any[] = []
const source = { sessionId: 'fixture-body', environmentId: 'fixture', adapter: 'ainekio-gateway',
  timestamp: '2026-10-19T15:00:00Z', capabilities: { actions: [] }, state: { body: { robotId: 'fixture-p4' } } }
mock.module('@metahuman/core', { namedExports: { ...core,
  getTargetUser: () => ({ username: 'fixture', userId: 'fixture-id', role: 'owner' }),
  getLatestEnvironmentObservation: () => source,
  loadGraphFile: async (file: string) => { loaded.push(file); return { graph: { name: file } } },
  runGraph: async (params: unknown) => { runs.push(params); return { executionId: 'fixture-execution', status: 'completed' } },
  withUserContext: async (_user: unknown, operation: () => Promise<unknown>) => operation(),
} })
const { runEventTrigger } = await import('./core.js')

test('manual body event invocation uses the same typed routing and preserves complete observation', async () => {
  for (const [kind, graph] of [['tipped', 'fast-body-event'], ['rapid_movement', 'fast-body-event'],
    ['servo_stall', 'fast-body-event'], ['wake', 'body-event-trigger']]) {
    const observation = { ...source, state: { ...source.state, bodyEvent: { name: 'body_event',
      event_id: `manual-${kind}`, data: { kind, reason: 'fixture', measurements: { roll: 71.2, acceleration: [1, 2, 3] } } } } }
    await runEventTrigger('fixture', observation)
    assert.equal(path.basename(loaded.at(-1)!), `${graph}-mode.json`)
    assert.deepEqual(runs.at(-1).context.environmentObservation, observation)
    assert.equal(runs.at(-1).context.userMessage, '')
  }
})

test('an explicit manual request preserves the original Body Event Trigger workflow', async () => {
  const request = 'Review my request about tipping and rapid movement.'
  await runEventTrigger('fixture', undefined, request)
  assert.equal(path.basename(loaded.at(-1)!), 'body-event-trigger-mode.json')
  assert.equal(runs.at(-1).context.environmentObservation.state.bodyEvent.data.request, request)
  assert.equal(runs.at(-1).context.environmentObservation.state.bodyEvent.data.kind, 'request')
})

after(() => { mock.restoreAll(); fs.rmSync(root, { recursive: true, force: true }) })
