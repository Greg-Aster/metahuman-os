import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { AGENT_CATALOG_DEFINITIONS } from '../agent-catalog-definitions.js'
import type { GraphExecutionState } from '../graph-executor.js'
import { ROOT } from '../path-builder.js'
import { ExecutionEngine } from '../queue/execution-engine.js'
import { UnifiedQueueManager } from '../queue/unified-queue-manager.js'
import { SLEEP_WORKFLOW_STAGES } from '../queue/sleep-workflow.js'
import { DEFAULT_HANDLERS } from '../queue/types.js'
import { createDesireOutcomeReviewer } from './desire-outcome-service.js'
import { evaluateDesireOutcomeReviewGraph } from './executor.js'
import type { Desire } from './types.js'

function desire(status: Desire['status'] = 'awaiting_review'): Desire {
  return {
    id: 'desire-1', title: 'Test', description: 'Test review', reason: 'Contract test',
    source: 'user', status, currentStage: 'outcome_review', strength: 1, risk: 'low',
    createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
  } as unknown as Desire
}

function completedOutcomeGraphState(
  overrides: Partial<Record<
    'desire_outcome_reviewer' | 'desire_updater' | 'inner_dialogue_buffer' | 'inner_dialogue_saver',
    Record<string, unknown>
  >> = {},
): GraphExecutionState {
  const outputs = {
    desire_outcome_reviewer: {
      success: true,
      outcomeReview: { id: 'review-1', verdict: 'completed' },
      verdict: 'completed',
    },
    desire_updater: {
      success: true,
      desire: desire('completed'),
      action: 'completed',
      summary: 'Reviewed "Test" as completed.',
    },
    inner_dialogue_buffer: { saved: true, persisted: true, savedCount: 1 },
    inner_dialogue_saver: { success: true, saved: true, savedCount: 1 },
    ...overrides,
  }
  return {
    nodes: new Map(Object.entries(outputs).map(([type, nodeOutputs]) => [type, {
      nodeId: type,
      status: 'completed' as const,
      definition: { type },
      outputs: nodeOutputs,
    }])),
    startTime: 0,
    endTime: 1,
    status: 'completed',
  }
}

test('outcome service delegates one review and requires its durable transition', async () => {
  const stored = desire()
  let calls = 0
  const review = createDesireOutcomeReviewer({
    loadDesire: async () => structuredClone(stored),
    listReviewable: async () => [structuredClone(stored)],
    reviewGraph: async candidate => {
      calls += 1
      return {
        success: true,
        desire: { ...candidate, status: 'completed' },
        outcomeReview: { verdict: 'completed' } as any,
        verdict: 'completed',
        action: 'completed',
      }
    },
  })
  assert.deepEqual(await review({ username: 'profile-a' }), {
    considered: 1,
    reviewed: 1,
    skipped: 0,
    desireIds: ['desire-1'],
    actions: { completed: 1 },
  })
  assert.equal(calls, 1)
})

test('outcome service rejects graph results without a durable transition', async () => {
  const stored = desire()
  const review = createDesireOutcomeReviewer({
    loadDesire: async () => structuredClone(stored),
    listReviewable: async () => [structuredClone(stored)],
    reviewGraph: async () => ({ success: false, error: 'transition failed' }),
  })
  await assert.rejects(review({ username: 'profile-a' }), /transition failed/)
})

test('desire outcome graph requires confirmed buffer and Persona Memory persistence', () => {
  const result = evaluateDesireOutcomeReviewGraph(completedOutcomeGraphState())
  assert.equal(result.success, true)
  assert.equal(result.desire?.status, 'completed')

  assert.throws(
    () => evaluateDesireOutcomeReviewGraph(completedOutcomeGraphState({
      inner_dialogue_buffer: { saved: false, persisted: false, savedCount: 0, reason: 'buffer unavailable' },
    })),
    /Inner Dialogue Buffer persistence failed: buffer unavailable/,
  )
  assert.throws(
    () => evaluateDesireOutcomeReviewGraph(completedOutcomeGraphState({
      inner_dialogue_saver: { success: true, saved: true, savedCount: 0 },
    })),
    /Persona Memory persistence failed/,
  )
})

test('outcome review has one Core handler and one canonical graph transition', () => {
  assert.equal(DEFAULT_HANDLERS.desire_review, 'agency.desire-outcome-review')
  assert.equal(
    AGENT_CATALOG_DEFINITIONS['desire-outcome-reviewer'].handler,
    'agency.desire-outcome-review',
  )
  const stage = SLEEP_WORKFLOW_STAGES.find(item => item.id === 'review-outcomes')
  assert.equal(stage?.handler, 'agency.desire-outcome-review')
  assert.equal(stage?.maxAttempts, 1)
  const engine = new ExecutionEngine()
  assert.equal(engine.hasHandler('agency.desire-outcome-review'), true)
  assert.equal(engine.hasHandler('agent.desire-outcome-reviewer'), false)
  const queue = new UnifiedQueueManager()
  assert.equal(queue.enqueue({
    type: 'desire_review', username: 'profile-a', input: {}, maxAttempts: 9,
  }).maxAttempts, 1)

  const graph = JSON.parse(fs.readFileSync(
    `${ROOT}/etc/cognitive-graphs/desire-outcome-reviewer.json`,
    'utf8',
  ))
  assert.equal(graph.name, 'Desire Outcome Reviewer')
  assert.equal(graph.cognitiveMode, 'agent')
  const nodeTypes = graph.nodes.map((node: any) => node.data.nodeType)
  assert.equal(nodeTypes.filter((type: string) => type === 'desire_outcome_reviewer').length, 1)
  assert.equal(nodeTypes.includes('outcome_reviewer'), false)
  assert.equal(nodeTypes.filter((type: string) => type === 'desire_updater').length, 1)
  assert.equal(nodeTypes.includes('verdict_router'), false)
  assert.equal(nodeTypes.includes('approval_queue'), false)
  assert.equal(nodeTypes.includes('scratchpad_writer'), false)
  assert.equal(graph.nodes.find((node: any) => node.data.nodeType === 'desire_updater')
    .data.properties.applyOutcomePolicy, true)

  const agents = JSON.parse(fs.readFileSync(`${ROOT}/etc/agents.json`, 'utf8'))
  assert.equal(agents.agents['desire-outcome-reviewer'].handler, 'agency.desire-outcome-review')
  assert.equal(agents.agents['desire-outcome-reviewer'].maxRetries, 0)

  const apiSource = fs.readFileSync(
    `${ROOT}/packages/core/src/api/handlers/agency-workflows.ts`,
    'utf8',
  )
  assert.match(apiSource, /submitDesireOutcomeReview\(/)
  assert.doesNotMatch(apiSource, /runOutcomeReviewLlm/)
  assert.doesNotMatch(apiSource, /applyOutcomeReview\(/)
  assert.doesNotMatch(apiSource, /verifyOutcomeWithOperator/)
})
