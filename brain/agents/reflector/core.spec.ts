import assert from 'node:assert/strict'
import test from 'node:test'

import { setAuditEnabled, type GraphExecutionState, type SvelteFlowGraph } from '@metahuman/core'
import {
  evaluateReflectorGraph,
  parseReflectorArgs,
  runReflector,
  type ReflectorDependencies,
} from './core.js'
import agent, { meta } from './index.js'

setAuditEnabled(false)

const NOW = '2026-08-29T18:00:00.000Z'
const nodeIds = {
  reflection_memory_sampler: 'memory-editable-id',
  reflection_prompt: 'prompt-editable-id',
  reflector_llm: 'model-editable-id',
  reflection_buffer: 'reflection-buffer-editable-id',
  reasoning_buffer: 'reasoning-buffer-editable-id',
  tts: 'tts-editable-id',
} as const

const graph = {
  version: '1.0',
  format: 'svelte-flow',
  name: 'Reflector contract fixture',
  cognitiveMode: 'agent',
  nodes: [
    ...Object.entries(nodeIds)
      .filter(([name]) => name !== 'reflection_buffer' && name !== 'reasoning_buffer')
      .map(([nodeType, id]) => ({
        id,
        type: 'cognitiveNode',
        position: { x: 0, y: 0 },
        data: { label: nodeType, nodeType, properties: {} },
      })),
    {
      id: nodeIds.reflection_buffer,
      type: 'cognitiveNode',
      position: { x: 0, y: 0 },
      data: { label: 'reflection', nodeType: 'inner_dialogue_buffer', properties: { role: 'reflection' } },
    },
    {
      id: nodeIds.reasoning_buffer,
      type: 'cognitiveNode',
      position: { x: 0, y: 0 },
      data: { label: 'reasoning', nodeType: 'inner_dialogue_buffer', properties: { role: 'reasoning' } },
    },
  ],
  edges: [],
} as SvelteFlowGraph

const successfulOutputs: Record<string, Record<string, any>> = {
  [nodeIds.reflection_memory_sampler]: {
    ready: true,
    count: 4,
    candidateCount: 20,
    failedCount: 1,
  },
  [nodeIds.reflection_prompt]: { ready: true, personaApplied: true },
  [nodeIds.reflector_llm]: { response: 'A new reflection.' },
  [nodeIds.reflection_buffer]: {
    saved: true,
    persisted: true,
    text: 'A new reflection.',
    eventId: 'evt-reflection',
    eventPath: 'memory/episodic/reflection.json',
  },
  [nodeIds.reasoning_buffer]: { saved: true, persisted: true, text: 'Reasoning.' },
  [nodeIds.tts]: { queued: true, itemId: 'tts-item' },
}

function graphState(
  overrides: Record<string, Record<string, any>> = {},
  status: GraphExecutionState['status'] = 'completed',
): GraphExecutionState {
  const outputs = { ...successfulOutputs, ...overrides }
  return {
    nodes: new Map(Object.values(nodeIds).map(id => [id, {
      nodeId: id,
      status: 'completed',
      startTime: 0,
      endTime: 1,
      outputs: outputs[id],
    }])),
    startTime: 0,
    endTime: 1,
    status,
  } as GraphExecutionState
}

function dependencies(
  overrides: Partial<ReflectorDependencies> = {},
): ReflectorDependencies {
  return {
    resolveTargetUser: () => ({
      userId: 'real-profile-uuid',
      username: 'test-user',
      role: 'owner',
    }),
    loadGraph: async () => graph,
    executeGraph: async () => graphState(),
    runWithUserContext: async (_context, callback) => callback(),
    newExecutionId: () => 'generated-execution',
    now: () => NOW,
    ...overrides,
  }
}

test('Reflector evaluates editable node types and requires durable memory persistence', () => {
  assert.deepEqual(
    evaluateReflectorGraph(graph, graphState(), { username: 'test-user', executionId: 'task-1' }),
    {
      status: 'generated',
      username: 'test-user',
      executionId: 'task-1',
      reflection: 'A new reflection.',
      eventId: 'evt-reflection',
      eventPath: 'memory/episodic/reflection.json',
      memoriesConsidered: 4,
      candidatesConsidered: 20,
      scanFailures: 1,
      ttsQueued: true,
    },
  )

  assert.throws(
    () => evaluateReflectorGraph(graph, graphState({
      [nodeIds.reflection_buffer]: { saved: true, persisted: true, text: 'Not captured.' },
    }), { username: 'test-user', executionId: 'task-1' }),
    /did not confirm long-term memory capture/,
  )
  assert.throws(
    () => evaluateReflectorGraph(graph, graphState({
      [nodeIds.reflection_memory_sampler]: { error: 'encrypted profile is locked' },
    }), { username: 'test-user', executionId: 'task-1' }),
    /encrypted profile is locked/,
  )
})

test('Reflector returns typed skips only for expected no-work conditions', () => {
  const insufficient = evaluateReflectorGraph(graph, graphState({
    [nodeIds.reflection_memory_sampler]: {
      ready: false,
      count: 1,
      candidateCount: 1,
      failedCount: 0,
    },
  }), { username: 'test-user', executionId: 'task-1' })
  assert.equal(insufficient.status, 'skipped')
  if (insufficient.status === 'skipped') assert.equal(insufficient.reason, 'insufficient-memories')

  const noPersona = evaluateReflectorGraph(graph, graphState({
    [nodeIds.reflection_prompt]: {
      ready: false,
      personaApplied: false,
      error: 'No persona context available',
    },
  }), { username: 'test-user', executionId: 'task-1' })
  assert.equal(noPersona.status, 'skipped')
  if (noPersona.status === 'skipped') assert.equal(noPersona.reason, 'persona-unavailable')
})

test('Reflector propagates graph, model, and persistence failures', () => {
  const failed = graphState({}, 'failed')
  failed.nodes.set(nodeIds.reflector_llm, {
    nodeId: nodeIds.reflector_llm,
    status: 'failed',
    error: new Error('model unavailable'),
  })
  assert.throws(
    () => evaluateReflectorGraph(graph, failed, { username: 'test-user', executionId: 'task-1' }),
    /model unavailable/,
  )
  assert.throws(
    () => evaluateReflectorGraph(graph, graphState({
      [nodeIds.reflector_llm]: { error: 'generation rejected' },
    }), { username: 'test-user', executionId: 'task-1' }),
    /generation rejected/,
  )
  assert.throws(
    () => evaluateReflectorGraph(graph, graphState({
      [nodeIds.reflection_buffer]: { saved: false, persisted: false, error: 'disk full' },
    }), { username: 'test-user', executionId: 'task-1' }),
    /disk full/,
  )
})

test('Reflector resolves real identity and forwards stable retry and cancellation context', async () => {
  let requestedUsername: string | undefined
  let authenticatedContext: Record<string, unknown> | undefined
  let executionContext: Record<string, unknown> | undefined
  let executionSignal: AbortSignal | undefined
  const controller = new AbortController()
  const outcome = await runReflector({
    username: 'test-user',
    executionId: 'task-stable',
    executionTimestamp: NOW,
    signal: controller.signal,
  }, dependencies({
    resolveTargetUser: options => {
      requestedUsername = options?.username
      return { userId: 'real-profile-uuid', username: 'test-user', role: 'owner' }
    },
    runWithUserContext: async (context, callback) => {
      authenticatedContext = context
      return callback()
    },
    executeGraph: async params => {
      executionContext = params.context
      executionSignal = params.signal
      return graphState()
    },
  }))

  assert.equal(outcome.status, 'generated')
  assert.equal(requestedUsername, 'test-user')
  assert.equal(authenticatedContext?.userId, 'real-profile-uuid')
  assert.equal(executionContext?.userId, 'real-profile-uuid')
  assert.equal(executionContext?.username, 'test-user')
  assert.equal(executionContext?.idempotencyKey, 'reflector:test-user:task-stable')
  assert.equal(executionContext?.memoryTimestamp, NOW)
  assert.equal(executionContext?.abortSignal, controller.signal)
  assert.equal(executionSignal, controller.signal)

  const cancelled = new AbortController()
  cancelled.abort()
  await assert.rejects(
    runReflector({ signal: cancelled.signal }, dependencies()),
    /cancelled/,
  )
  await assert.rejects(
    runReflector({}, dependencies({ resolveTargetUser: () => null })),
    /No authenticated target user/,
  )
})

test('Reflector exposes one strict adapter contract', () => {
  assert.equal(agent.meta, meta)
  assert.equal(meta.id, 'reflector')
  assert.equal(meta.defaultInterval, undefined)
  assert.deepEqual(parseReflectorArgs([], {
    MH_TRIGGER_USERNAME: 'test-user',
    MH_TASK_ID: 'task-1',
    MH_TASK_CREATED_AT: NOW,
  }), {
    username: 'test-user',
    executionId: 'task-1',
    executionTimestamp: NOW,
  })
  assert.deepEqual(parseReflectorArgs(['--username', 'another-user'], {}), {
    username: 'another-user',
    executionId: undefined,
    executionTimestamp: undefined,
  })
  assert.throws(() => parseReflectorArgs(['--single-user'], {}), /Unknown reflector option/)
})
