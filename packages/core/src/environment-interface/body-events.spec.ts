import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveBodyEventGraph } from './body-events.js'
import type { EnvironmentObservation } from './types.js'

const observation = (kind?: string): EnvironmentObservation => ({
  sessionId: 'fixture-body', environmentId: 'fixture', adapter: 'ainekio-gateway',
  timestamp: '2026-10-19T15:00:00Z', capabilities: { actions: [] },
  state: { bodyEvent: { name: 'body_event', event_id: 'fixture-event', data: { kind } } },
})

test('body event workflow selection uses only the reported typed event', () => {
  assert.equal(resolveBodyEventGraph(observation('tipped')), 'fast-body-event')
  assert.equal(resolveBodyEventGraph(observation('rapid_movement')), 'fast-body-event')
  assert.equal(resolveBodyEventGraph(observation('servo_stall')), 'fast-body-event')
  for (const kind of ['wake', 'boot', 'request', 'unknown', undefined]) {
    assert.equal(resolveBodyEventGraph(observation(kind)), 'body-event-trigger')
  }
  const request = observation('request')
  request.text = [{ id: 'fixture-request', source: 'player', text: 'I tipped it and shook it.', timestamp: request.timestamp }]
  assert.equal(resolveBodyEventGraph(request), 'body-event-trigger', 'Request wording does not select a typed event route')
})
