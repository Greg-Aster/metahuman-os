import assert from 'node:assert/strict'
import test from 'node:test'
import { projectDesireExecutionEvidence } from './operational-context.js'
import type { ExecutionEvent, ExecutionObjective, ExecutionRecord } from '../durable-execution/types.js'

const record: ExecutionRecord = {
  executionId: 'execution-1', username: 'profile-a', status: 'waiting', waitingReason: 'receipt',
  definition: { graphId: 'Environment', graphHash: 'hash', runtimeVersion: 'v1', checkpointSchemaVersion: 1, nodeVersions: {} },
  checkpointVersion: 1, lastSequence: 2, lastProcessedSequence: 2,
  createdAt: 10, updatedAt: 30, cancelledAt: null, owner: null, ownerGeneration: 0, leaseUntil: null,
}
const event = (kind: string, payload: unknown, sequence = 1): ExecutionEvent => ({
  executionId: record.executionId, eventId: `event-${sequence}`, kind, sequence, createdAt: 20 + sequence, payload,
})

test('execution evidence retains original request separately from wrong selected program and command receipt', () => {
  const events = [event('physical_result', { action: { type: 'robotCommand', command: 'surprised' }, feedback: { type: 'completed', message: 'done', actionId: 'command-1' } })]
  const result = projectDesireExecutionEvidence(record,
    { context: { userMessage: 'Please stretch', userMessageEntry: { role: 'user', content: 'Please stretch', timestamp: 10 } } }, null, events,
    [{ namespace: 'child-1', checkpointId: 'checkpoint-2', nodes: [['task', {
      status: 'completed', definition: { type: 'environment_task_planner' }, startTime: 15, endTime: 18,
      outputs: { program: { steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'surprised' } }] },
        taskDecision: { objective: 'React with surprise', objectiveComplete: false }, valid: true },
    }]] }])
  assert.equal(result.admittedInput.userMessage, 'Please stretch')
  assert.deepEqual(result.selections[0].program, { steps: [{ kind: 'action', action: { type: 'robotCommand', command: 'surprised' } }] })
  assert.equal(result.status, 'waiting')
  assert.equal(result.task, null, 'absent overall objective is not synthesized from command completion')
  assert.deepEqual(result.events, events)
  assert.equal(result.selections[0].checkpointId, 'checkpoint-2')
})

test('autonomous instruction keeps its source while selections retain temporal occurrence order', () => {
  const node = (startTime: number, type: string, outputs: Record<string, unknown>) => ({
    namespace: 'child', checkpointId: `checkpoint-${startTime}`, nodes: [[`node-${startTime}`, {
      status: 'completed', definition: { type }, startTime, outputs,
    }]] as Array<[string, { status: string; definition: { type: string }; startTime: number; outputs: Record<string, unknown> }]>,
  })
  const result = projectDesireExecutionEvidence(record, { context: {} }, null, [], [
    node(40, 'environment_task_planner', { program: null, taskDecision: { outcome: 'wait' } }),
    node(10, 'environment_event_request', { message: 'Inspect the window', plannerDecision: { source: 'autonomy', reason: 'Glare' } }),
    node(20, 'environment_task_planner', { program: { steps: [] }, taskDecision: { outcome: 'act' } }),
  ])
  assert.equal(result.admittedInput.userMessage, undefined)
  assert.equal(result.instructions[0].message, 'Inspect the window')
  assert.deepEqual(result.instructions[0].plannerDecision, { source: 'autonomy', reason: 'Glare' })
  assert.deepEqual(result.selections.map(item => item.startedAt), [20, 40])
})

test('receipt projection preserves uncertain outcomes and frame identity without image bytes', () => {
  const events = [event('physical_result', { feedback: { type: 'outcome_unknown', actionId: 'action-1' },
    frame: { id: 'frame-1', timestamp: '2026-10-15T00:00:00Z', mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,bytes' } })]
  const result = projectDesireExecutionEvidence(record, {}, null, events, [])
  const payload = result.events[0].payload as typeof events[0]['payload'] & { feedback: { type: string }; frame: Record<string, unknown> }
  assert.equal(payload.feedback.type, 'outcome_unknown')
  assert.equal(payload.frame.id, 'frame-1')
  assert.equal(payload.frame.timestamp, '2026-10-15T00:00:00Z')
  assert.equal('dataUrl' in payload.frame, false)
  assert.equal(result.events[0].eventId, 'event-1')
})

test('checkpoint projection retains repeated occurrences without decoding unrelated state or pending writes', async () => {
  const { ExecutionStore } = await import('../durable-execution/store.js')
  const { ExecutionCheckpointer } = await import('../durable-execution/checkpointer.js')
  const store = new ExecutionStore(':memory:')
  try {
    const execution = store.create('profile-a', record.definition)
    const lease = store.claim(execution.executionId, record.definition)
    const saver = new ExecutionCheckpointer(store, lease)
    let config: import('../durable-execution/checkpointer.js').CheckpointConfig = { configurable: { thread_id: execution.executionId } }
    const node = (startTime: number) => ({ definition: { type: 'environment_task_planner' },
      status: 'completed', startTime, endTime: startTime + 1,
      inputs: { frame: 'unrelated image'.repeat(1000) },
      outputs: { program: { steps: [{ command: `move-${startTime}` }] }, modelMessages: 'unneeded prompt'.repeat(1000) } })
    for (const [id, startTime] of [['001', 10], ['002', 10], ['003', 20]] as const) {
      config = await saver.put(config, { v: 4, id, ts: new Date().toISOString(),
        channel_values: { nodeEntries: [['task', node(startTime)], ['vision', {
          definition: { type: 'vision' }, status: 'completed', outputs: { image: 'pixels'.repeat(2000) },
        }]], contextSnapshot: { image: 'context pixels'.repeat(2000) } },
        channel_versions: {}, versions_seen: {},
      }, { source: 'loop', step: 0, parents: {} })
    }
    await saver.putWrites(config, [['pending', { image: 'pending pixels'.repeat(2000) }]], 'worker')
    const decode = store.decodeDocument.bind(store)
    const paths: Array<readonly (string | number)[]> = []
    store.decodeDocument = (value, path = []) => { paths.push(path); return decode(value, path) }
    const snapshots = await saver.completedNodeOccurrences({ environment_task_planner: ['program'] })
    assert.deepEqual(snapshots.map(snapshot => snapshot.checkpointId), ['003', '002'])
    assert.deepEqual(snapshots.map(snapshot => snapshot.nodes[0][1].outputs.program.steps[0].command), ['move-20', 'move-10'])
    assert.equal(paths.filter(path => path.at(-1) === 'program').length, 2, 'unchanged occurrence output decoded once')
    assert.ok(paths.every(path => path.length > 0 && path[2] === 'nodeEntries'))
    assert.ok(paths.every(path => !path.includes('inputs') && !path.includes('modelMessages') && !path.includes('contextSnapshot')))
  } finally { store.close() }
})
