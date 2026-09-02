import assert from 'node:assert/strict'
import test from 'node:test'

import type { GraphExecutionState } from '@metahuman/core'
import {
  evaluateMoodGraph,
  parseMoodArgs,
  parseMoodTriggerData,
  resolveMoodResultNodeId,
  run,
  runCycle,
} from './core.js'

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
