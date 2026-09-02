import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { ROOT } from '../path-builder.js'
import { withUserContext } from '../context.js'
import { AGENT_CATALOG_DEFINITIONS } from '../agent-catalog-definitions.js'
import { getNode } from '../nodes/index.js'
import { ExecutionEngine } from '../queue/execution-engine.js'
import { UnifiedQueueManager } from '../queue/unified-queue-manager.js'
import { DEFAULT_HANDLERS } from '../queue/types.js'
import { SLEEP_WORKFLOW_STAGES } from '../queue/sleep-workflow.js'
import {
  createApprovedDesireExecutor,
  type DesireExecutionDependencies,
} from './desire-execution-service.js'
import {
  buildDesireExecutionGraphContext,
  evaluateDesireExecutionGraph,
} from './executor.js'
import type { Desire, DesireExecution } from './types.js'
import type { GraphExecutionState } from '../graph-executor.js'

function approvedDesire(id = 'desire-1'): Desire {
  return {
    id,
    title: 'Test desire',
    description: 'Exercise the canonical execution path',
    reason: 'Contract test',
    source: 'user',
    status: 'approved',
    currentStage: 'executing',
    strength: 1,
    risk: 'low',
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
    plan: {
      id: 'plan-1',
      version: 1,
      steps: [{
        order: 1,
        action: 'Perform test action',
        expectedOutcome: 'Action completes',
        risk: 'low',
        requiresApproval: false,
      }],
      estimatedRisk: 'low',
      requiredSkills: [],
      requiredTrustLevel: 'suggest',
      operatorGoal: 'Complete the test action',
      createdAt: '2026-08-25T00:00:00.000Z',
    },
  } as unknown as Desire
}

function completedExecution(): DesireExecution {
  return {
    startedAt: '2026-08-25T00:00:00.000Z',
    completedAt: '2026-08-25T00:01:00.000Z',
    status: 'completed',
    stepsCompleted: 1,
    stepsTotal: 1,
    stepResults: [],
  }
}

function completedGraphState(
  overrides: Partial<Record<'desire_executor' | 'inner_dialogue_buffer' | 'inner_dialogue_saver', Record<string, unknown>>> = {},
): GraphExecutionState {
  const outputs = {
    desire_executor: { success: true, execution: completedExecution() },
    inner_dialogue_buffer: { saved: true, persisted: true, savedCount: 1 },
    inner_dialogue_saver: { success: true, saved: true, savedCount: 1 },
    ...overrides,
  }
  return {
    status: 'completed',
    startTime: 0,
    endTime: 1,
    nodes: new Map(Object.entries(outputs).map(([type, nodeOutputs]) => [type, {
      nodeId: type,
      status: 'completed' as const,
      outputs: nodeOutputs,
      definition: { type },
    }])),
  }
}

test('desire graph context preserves authenticated identity and Agent mode', async () => {
  const desire = approvedDesire('desire-context')
  await withUserContext(
    { userId: 'account-id-123', username: 'profile-a', role: 'owner' },
    async () => {
      const context = buildDesireExecutionGraphContext(desire, 'profile-a')
      assert.equal(context.userId, 'account-id-123')
      assert.equal(context.username, 'profile-a')
      assert.equal(context.cognitiveMode, 'agent')
      assert.equal(context.recordPersonaMemory, true)
      assert.equal(context.desire, desire)
      assert.throws(
        () => buildDesireExecutionGraphContext(desire, 'different-profile'),
        /does not own profile different-profile/,
      )
    },
  )
})

test('desire graph completion requires both inner-dialogue persistence owners', () => {
  assert.deepEqual(evaluateDesireExecutionGraph(completedGraphState()), {
    success: true,
    graphCompleted: true,
    execution: completedExecution(),
    error: undefined,
  })
  assert.throws(
    () => evaluateDesireExecutionGraph(completedGraphState({
      inner_dialogue_buffer: { saved: false, persisted: false, reason: 'buffer unavailable' },
    })),
    /inner-dialogue persistence failed: buffer unavailable/,
  )
  assert.throws(
    () => evaluateDesireExecutionGraph(completedGraphState({
      inner_dialogue_saver: { success: true, saved: true, savedCount: 0 },
    })),
    /Persona Memory persistence failed: expected 1 saved entry or entries, received 0/,
  )
})

test('pre-aborted desire work cannot claim or execute an external action', async () => {
  let loadCalls = 0
  let saveCalls = 0
  let graphCalls = 0
  const controller = new AbortController()
  controller.abort(new DOMException('cancelled before admission', 'AbortError'))
  const execute = createApprovedDesireExecutor({
    loadDesire: async () => {
      loadCalls += 1
      return approvedDesire('desire-cancelled')
    },
    listApproved: async () => [approvedDesire('desire-cancelled')],
    saveManifest: async () => {
      saveCalls += 1
    },
    addScratchpadEntry: async () => undefined,
    executeGraph: async () => {
      graphCalls += 1
      return { success: true, graphCompleted: true, execution: completedExecution() }
    },
  })

  await assert.rejects(
    execute({ username: 'profile-a', desireId: 'desire-cancelled', signal: controller.signal }),
    error => error instanceof DOMException
      && error.name === 'AbortError'
      && error.message === 'cancelled before admission',
  )
  assert.equal(loadCalls, 0)
  assert.equal(saveCalls, 0)
  assert.equal(graphCalls, 0)
})

test('approved desire execution claims once and reports the durable graph result', async () => {
  let stored = approvedDesire()
  const savedStatuses: string[] = []
  const deps: Partial<DesireExecutionDependencies> = {
    loadDesire: async () => structuredClone(stored),
    listApproved: async () => [structuredClone(stored)],
    saveManifest: async desire => {
      savedStatuses.push(desire.status)
      stored = structuredClone(desire)
    },
    addScratchpadEntry: async () => undefined,
    executeGraph: async desire => {
      assert.equal(desire.status, 'executing')
      stored = { ...structuredClone(desire), status: 'awaiting_review', execution: completedExecution() }
      return { success: true, graphCompleted: true, execution: completedExecution() }
    },
  }

  const execute = createApprovedDesireExecutor(deps)
  const result = await execute({ username: 'profile-a' })

  assert.deepEqual(result, {
    considered: 1,
    executed: 1,
    succeeded: 1,
    failed: 0,
    skipped: 0,
    desireIds: ['desire-1'],
  })
  assert.deepEqual(savedStatuses, ['executing'])
  assert.equal(stored.status, 'awaiting_review')
})

test('concurrent admission cannot execute the same profile desire twice', async () => {
  let stored = approvedDesire('desire-concurrent')
  let releaseExecution!: () => void
  const executionStarted = new Promise<void>(resolve => {
    releaseExecution = resolve
  })
  let continueExecution!: () => void
  const executionGate = new Promise<void>(resolve => {
    continueExecution = resolve
  })
  let graphCalls = 0
  const execute = createApprovedDesireExecutor({
    loadDesire: async () => structuredClone(stored),
    listApproved: async () => [structuredClone(stored)],
    saveManifest: async desire => {
      stored = structuredClone(desire)
    },
    addScratchpadEntry: async () => undefined,
    executeGraph: async desire => {
      graphCalls += 1
      releaseExecution()
      await executionGate
      stored = { ...structuredClone(desire), status: 'awaiting_review', execution: completedExecution() }
      return { success: true, graphCompleted: true, execution: completedExecution() }
    },
  })

  const first = execute({ username: 'profile-a', desireId: stored.id })
  await executionStarted
  const second = await execute({ username: 'profile-a', desireId: stored.id })
  continueExecution()
  const firstResult = await first

  assert.equal(graphCalls, 1)
  assert.equal(firstResult.executed, 1)
  assert.equal(second.executed, 0)
  assert.equal(second.skipped, 1)
})

test('graph infrastructure failure is durably handed to outcome review and rejects work', async () => {
  let stored = approvedDesire('desire-failure')
  const scratchpadTypes: string[] = []
  const execute = createApprovedDesireExecutor({
    loadDesire: async () => structuredClone(stored),
    listApproved: async () => [structuredClone(stored)],
    saveManifest: async desire => {
      stored = structuredClone(desire)
    },
    addScratchpadEntry: async (_id, entry) => {
      scratchpadTypes.push(entry.type)
    },
    executeGraph: async () => ({
      success: false,
      graphCompleted: false,
      error: 'executor node persistence failed',
    }),
  })

  await assert.rejects(
    execute({ username: 'profile-a', desireId: stored.id }),
    /executor node persistence failed/,
  )
  assert.equal(stored.status, 'awaiting_review')
  assert.equal(stored.execution?.status, 'failed')
  assert.equal(stored.currentStage, 'outcome_review')
  assert.deepEqual(scratchpadTypes, ['execution_failed'])
})

test('desire executor graph and coordinator configuration have one valid finalization path', () => {
  const graph = JSON.parse(fs.readFileSync(`${ROOT}/etc/cognitive-graphs/desire-executor.json`, 'utf8'))
  const executorNodeSource = fs.readFileSync(`${ROOT}/packages/core/src/nodes/agency/desire-executor.node.ts`, 'utf8')
  const nodeTypes = graph.nodes.map((node: any) => node.data.nodeType)
  assert.equal(nodeTypes.filter((type: string) => type === 'desire_executor').length, 1)
  assert.equal(nodeTypes.includes('desire_updater'), false)
  assert.equal(nodeTypes.includes('scratchpad_writer'), false)
  assert.equal(nodeTypes.includes('audit_logger'), false)
  assert.equal(JSON.stringify(graph).includes('"executed"'), false)
  assert.equal(JSON.stringify(graph).includes('slot_0'), false)
  assert.equal(executorNodeSource.match(/await escalate\(/g)?.length, 1)
  assert.match(executorNodeSource, /configured fallback backend is unavailable/)
  assert.doesNotMatch(executorNodeSource, /context\.desire|inputs\['slot_0'\]|inputs\[0\]/)
  assert.ok(graph.edges.some((edge: any) =>
    edge.source === '1'
    && edge.sourceHandle === 'desire'
    && edge.target === '3'
    && edge.targetHandle === 'desire'))
  assert.ok(graph.edges.some((edge: any) =>
    edge.source === '7'
    && edge.sourceHandle === 'entries'
    && edge.target === '9'
    && edge.targetHandle === 'entries'))
  assert.ok(graph.edges.some((edge: any) =>
    edge.source === '9'
    && edge.sourceHandle === 'text'
    && edge.target === '8'
    && edge.targetHandle === 'innerDialogue'))

  const nodeById = new Map(graph.nodes.map((node: any) => [node.id, node]))
  for (const node of graph.nodes) {
    const definition = getNode(node.data.nodeType)
    assert.ok(definition, `registered node ${node.data.nodeType}`)
    for (const property of Object.keys(node.data.properties || {})) {
      assert.ok(definition!.propertySchemas?.[property], `${node.data.nodeType}.${property} property`)
    }
  }
  for (const edge of graph.edges) {
    const sourceNode = nodeById.get(edge.source) as any
    const targetNode = nodeById.get(edge.target) as any
    const sourceDefinition = getNode(sourceNode.data.nodeType)!
    const targetDefinition = getNode(targetNode.data.nodeType)!
    assert.ok(sourceDefinition.outputs.some(output => output.name === edge.sourceHandle), edge.id)
    assert.ok(targetDefinition.inputs.some(input => input.name === edge.targetHandle), edge.id)
  }

  assert.equal(DEFAULT_HANDLERS.desire_execute, 'agency.desire-execute')
  assert.equal(AGENT_CATALOG_DEFINITIONS['desire-executor'].handler, 'agency.desire-execute')
  const sleepStage = SLEEP_WORKFLOW_STAGES.find(stage => stage.type === 'desire_execute')
  assert.equal(sleepStage?.handler, 'agency.desire-execute')
  assert.equal(sleepStage?.maxAttempts, 1)

  const agents = JSON.parse(fs.readFileSync(`${ROOT}/etc/agents.json`, 'utf8'))
  assert.equal(agents.agents['desire-executor'].handler, 'agency.desire-execute')
  assert.equal(agents.agents['desire-executor'].maxRetries, 0)

  const engine = new ExecutionEngine()
  assert.equal(engine.hasHandler('agency.desire-execute'), true)
  assert.equal(engine.hasHandler('agent.desire-executor'), false)

  const queue = new UnifiedQueueManager()
  const queued = queue.enqueue({
    type: 'desire_execute',
    username: 'profile-a',
    input: {},
    maxAttempts: 9,
  })
  assert.equal(queued.maxAttempts, 1)
})
