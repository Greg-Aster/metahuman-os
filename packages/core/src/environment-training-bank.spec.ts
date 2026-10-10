import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { validateSvelteFlowGraph } from './cognitive-graph-schema.js'
import { ExecutionCheckpointer } from './durable-execution/checkpointer.js'
import { executionDefinition } from './durable-execution/graph-contract.js'
import { ExecutionStore } from './durable-execution/store.js'
import { collectEnvironmentTrainingCandidates } from './environment-training-bank.js'
import { systemPaths } from './path-builder.js'

test('rolling bank reads each committed intent and task decision once without accepting precomputed outputs', async () => {
  const graph = validateSvelteFlowGraph(JSON.parse(fs.readFileSync(
    path.join(systemPaths.etc, 'cognitive-graphs', 'environment-mode.json'), 'utf8')))
  const definition = executionDefinition(graph)
  const store = new ExecutionStore(':memory:')
  try {
    const execution = store.create('training-test', definition)
    const lease = store.claim(execution.executionId, definition)
    const saver = new ExecutionCheckpointer(store, lease)
    const now = Date.now()
    const entries = [
      ['intent-orchestrator', { nodeId: 'intent-orchestrator', status: 'completed', startTime: now,
        endTime: now + 1, inputs: { message: 'Please bow.' },
        outputs: { raw: '{"needsResponse":false,"needsAction":true,"taskContext":[],"conversationContext":[]}' } }],
      ['4', { nodeId: '4', status: 'completed', startTime: now + 2, endTime: now + 3,
        inputs: { messages: [{ role: 'system', content: 'task instructions' }, { role: 'user', content: '{"currentInstruction":"Please bow."}' }] },
        outputs: { response: '{"taskDecision":null,"program":null}' } }],
    ]
    let config = await saver.put({ configurable: { thread_id: execution.executionId } }, {
      v: 4, id: randomUUID(), ts: new Date(now).toISOString(),
      channel_values: { nodeEntries: entries }, channel_versions: {}, versions_seen: {},
    }, { source: 'loop', step: 0, parents: {} })
    await saver.putWrites(config, [['nodeEntries', entries], ['counts', { 'intent-orchestrator': 1, '4': 1 }]], 'first')
    config = await saver.put(config, {
      v: 4, id: randomUUID(), ts: new Date(now + 4).toISOString(),
      channel_values: { nodeEntries: entries }, channel_versions: {}, versions_seen: {},
    }, { source: 'loop', step: 1, parents: {} })
    await saver.putWrites(config, [['nodeEntries', entries], ['counts', { 'intent-orchestrator': 1, '4': 1 }]], 'second')
    const found = await collectEnvironmentTrainingCandidates(store, 'training-test', graph)
    assert.equal(found.matchingExecutions, 1)
    assert.equal(found.candidates.length, 2)
    const intent = found.candidates.find(candidate => candidate.specialist === 'intent')!
    assert.equal(intent.user, 'Current user message: Please bow.')
    assert.match(intent.system, /Environment Intent Orchestrator/)
    const task = found.candidates.find(candidate => candidate.specialist === 'task')!
    assert.equal(task.system, 'task instructions')
    assert.equal(task.user, '{"currentInstruction":"Please bow."}')
    assert.equal(task.observedOutput, '{"taskDecision":null,"program":null}')
  } finally { store.close() }
})
