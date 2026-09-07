import assert from 'node:assert/strict'
import fs from 'node:fs'
import { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test, { mock } from 'node:test'

import type { GraphExecutionState } from '@metahuman/core'
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-mood-spec-'))
assert.equal(fs.realpathSync(testRoot), testRoot)
process.env.METAHUMAN_ROOT = testRoot
globalThis.fetch = async () => { throw new Error('Network access is forbidden in Mood owner tests') }
// Public Core registration may subscribe to telemetry. Keep this process off
// installed transports without importing private Core infrastructure from Brain.
mock.method(Socket.prototype, 'connect', function (this: Socket) {
  queueMicrotask(() => this.destroy(Object.assign(new Error('Test transport disabled'), { code: 'ECONNREFUSED' })))
  return this
})
const { ROOT, setAuditEnabled } = await import('@metahuman/core')
assert.equal(ROOT, testRoot)
setAuditEnabled(false)
const {
  evaluateMoodGraph,
  parseMoodArgs,
  parseMoodTriggerData,
  resolveMoodResultNodeId,
  run,
  runCycle,
} = await import('./core.js')

test('Mood resolves its result by node type instead of an editable graph id', () => {
  assert.deepEqual(parseMoodTriggerData(undefined), {})
  assert.deepEqual(parseMoodTriggerData({ userMessageCount: 10 }), { userMessageCount: 10 })
  assert.throws(() => parseMoodTriggerData([]), /must contain an object/)
  assert.deepEqual(parseMoodArgs([]), { baseline: false })
  assert.deepEqual(parseMoodArgs(['--baseline']), { baseline: true })
  assert.throws(() => parseMoodArgs(['--single-user']), /Unknown Mood option/)
  assert.equal(resolveMoodResultNodeId({
    nodes: [{ id: 'editable-result-id', data: { nodeType: 'mood_persona_switch' } }],
  }), 'editable-result-id')
  assert.throws(
    () => resolveMoodResultNodeId({ nodes: [] }),
    /exactly one mood_persona_switch/,
  )
  assert.throws(
    () => resolveMoodResultNodeId({
      nodes: [
        { id: 'one', data: { nodeType: 'mood_persona_switch' } },
        { id: 'two', data: { nodeType: 'mood_persona_switch' } },
      ],
    }),
    /exactly one mood_persona_switch/,
  )
})

test('Mood requires the editable result node to complete with its narrow output contract', () => {
  const graph = {
    nodes: [{ id: 'editable-result-id', data: { nodeType: 'mood_persona_switch' } }],
  }
  const completed = {
    nodes: new Map([['editable-result-id', {
      nodeId: 'editable-result-id',
      status: 'completed',
      outputs: {
        changed: true,
        activeFacet: 'friend',
        result: { changed: true, activeFacet: 'friend' },
      },
    }]]),
    startTime: 0,
    endTime: 1,
    status: 'completed',
  } as GraphExecutionState
  assert.deepEqual(evaluateMoodGraph(graph, completed), {
    success: true,
    changed: true,
    activeFacet: 'friend',
    result: { changed: true, activeFacet: 'friend' },
  })

  const missingOutput = structuredClone(completed) as GraphExecutionState
  missingOutput.nodes = new Map(completed.nodes)
  missingOutput.nodes.set('editable-result-id', {
    nodeId: 'editable-result-id',
    status: 'completed',
    outputs: { changed: false, activeFacet: 'default' },
  })
  assert.equal(evaluateMoodGraph(graph, missingOutput).success, false)

  const failed = { ...completed, status: 'failed', error: new Error('Output delivery failed') } as GraphExecutionState
  assert.deepEqual(evaluateMoodGraph(graph, failed), {
    success: false, changed: false, error: 'Output delivery failed',
  }, 'Completed node output does not override a graph-level persistence failure')
  assert.equal(evaluateMoodGraph(graph, { ...completed, status: 'waiting' }).success, false,
    'A saved waiting execution has not completed the finite Mood operation')
})

test('Mood treats unresolved profile identity as a failed execution', async () => {
  const username = `_missing-mood-user-${process.pid}-${Date.now()}`
  const previous = process.env.MH_TRIGGER_USERNAME
  process.env.MH_TRIGGER_USERNAME = username
  try {
    const cycle = await runCycle()
    assert.equal(cycle.success, false)
    assert.match(cycle.error || '', /registered target user/)

    const moduleResult = await run({ username, dataDir: '/tmp' }, {})
    assert.equal(moduleResult.success, false)
    assert.match(moduleResult.error || '', /not registered/)

    const invalidInput = await run({ username, dataDir: '/tmp' }, { options: { triggerData: [] } })
    assert.equal(invalidInput.success, false)
    assert.match(invalidInput.error || '', /must contain an object/)
  } finally {
    if (previous === undefined) delete process.env.MH_TRIGGER_USERNAME
    else process.env.MH_TRIGGER_USERNAME = previous
  }
})
