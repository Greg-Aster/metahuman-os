import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { AGENT_CATALOG_DEFINITIONS } from '../agent-catalog-definitions.js'
import { ROOT } from '../path-builder.js'
import { ExecutionEngine } from '../queue/execution-engine.js'
import { UnifiedQueueManager } from '../queue/unified-queue-manager.js'
import { SLEEP_WORKFLOW_STAGES } from '../queue/sleep-workflow.js'
import { DEFAULT_HANDLERS } from '../queue/types.js'
import { createDesireOutcomeReviewer } from './desire-outcome-service.js'
import type { Desire } from './types.js'

function desire(status: Desire['status'] = 'awaiting_review'): Desire {
  return {
    id: 'desire-1', title: 'Test', description: 'Test review', reason: 'Contract test',
    source: 'user', status, currentStage: 'outcome_review', strength: 1, risk: 'low',
    createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
  } as unknown as Desire
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
    `${ROOT}/etc/cognitive-graphs/outcome-reviewer.json`,
    'utf8',
  ))
  const nodeTypes = graph.nodes.map((node: any) => node.data.nodeType)
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
