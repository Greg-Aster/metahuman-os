import assert from 'node:assert/strict'
import test from 'node:test'
import { DesireQuestionTransitionNode } from '../nodes/agency/desire-question-transition.node.js'
import { storageClient } from '../storage-client.js'
import { applyDesireRelevance, saveDesireProgress } from './storage.js'
import { archiveDesireWork } from './desire-outcome-service.js'
import { OPEN_DESIRE_STATUSES } from './lifecycle-policy.js'
import { initializeDesireMetrics, type Desire, type DesireEvidence } from './types.js'
import { buildDesireAgentTaskInput } from '../queue/work-submission.js'
import type { QueuedTask } from '../queue/types.js'

function desire(status: Desire['status'] = 'nascent'): Desire {
  return { id: 'desire-test', status, currentStage: 'strengthening', strength: .4,
    metrics: initializeDesireMetrics(), evidence: [], runCount: 0, reinforcements: 0,
    updatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
    title: 'Test desire', description: 'Test', reason: 'Evidence', source: 'user_request',
    baseWeight: .4, threshold: .7, decayRate: .03, lastReviewedAt: '2026-01-01T00:00:00Z',
    risk: 'low', requiredTrustLevel: 'suggest' }
}
const evidence = (id: string): DesireEvidence => ({ id, kind: 'relevance', source: 'user_request',
  sourceId: id, observedAt: '2026-01-01T00:00:00Z', summary: 'Attributed review' })

test('absolute relevance changes preserve evidence and retries; late progress retains latest strength and archive with actual results', async t => {
  const files = new Map<string, string>([['folders/desire-test/manifest.json', JSON.stringify(desire())]])
  t.mock.method(storageClient, 'read', async (r: { relativePath: string }) => ({ success: files.has(r.relativePath), data: files.get(r.relativePath) }))
  t.mock.method(storageClient, 'write', async (r: { relativePath: string; data: string }) => { files.set(r.relativePath, r.data); return { success: true } })
  const first = await applyDesireRelevance('desire-test', { targetStrength: .8, reason: 'More relevant', evidence: evidence('one') }, 'profile-a')
  assert.equal(first?.strength, .8)
  const replay = await applyDesireRelevance('desire-test', { targetStrength: .2, reason: 'Repeated observation', evidence: evidence('one') }, 'profile-a')
  assert.deepEqual(replay, first)
  const lower = await applyDesireRelevance('desire-test', { targetStrength: .2, reason: 'Less relevant', evidence: evidence('two') }, 'profile-a')
  assert.equal(lower?.strength, .2)
  const unchanged = await applyDesireRelevance('desire-test', { targetStrength: .2, reason: 'Still relevant', evidence: evidence('three') }, 'profile-a')
  assert.equal(unchanged?.evidence?.length, 3)
  assert.equal(unchanged?.strength, .2)
  const archived = await applyDesireRelevance('desire-test', {
    targetStrength: 0, reason: 'No longer relevant', evidence: evidence('four'),
  }, 'profile-a')
  assert.equal(archived?.status, 'archived')
  assert.equal(archived?.currentStage, 'archived')
  assert.equal(JSON.parse(files.get('folders/desire-test/manifest.json')!).status, 'archived',
    'zero strength is terminal before returning, without waiting for cancellation work')
  const late = { ...first!, status: 'awaiting_review', execution: { startedAt: '2026-01-01T00:00:00Z', status: 'outcome_unknown', error: 'Interrupted', stepResults: [] } } as Desire
  await saveDesireProgress(late, 'profile-a', true)
  assert.equal(late.status, 'archived')
  assert.equal(late.strength, 0)
  assert.equal(late.evidence?.length, 4)
  assert.equal(late.execution?.status, 'outcome_unknown')
  assert.equal(late.dispositionReason, archived!.dispositionReason)
  const delayedQuestions: Desire = { ...first!, status: 'questioning', currentStage: 'questioning',
    clarifyingQuestions: { phase: 'before_planning', questions: [{ id: 'q1', text: 'Which target?', type: 'free_text', required: true }], answers: [] } }
  const returned = await DesireQuestionTransitionNode.execute({ desire: delayedQuestions }, { username: 'profile-a' }, {})
  assert.equal(returned.desire.status, 'archived', 'actual delayed question producer cannot reopen archived work')
  assert.equal(returned.desire.strength, 0)
  assert.equal(returned.desire.execution?.status, 'outcome_unknown')
  assert.equal(JSON.parse(files.get('folders/desire-test/manifest.json')!).status, 'archived')
})

test('zero archives every open stage and reconciles exact work without cancelling unrelated batches or fabricating outcomes', async () => {
  for (const status of OPEN_DESIRE_STATUSES) {
    let stored = { ...desire(status), strength: 0, execution: { executionId: 'execution-1', status: 'outcome_unknown' } } as Desire
    const cancelled: string[] = []
    const executionIds: string[] = []
    const tasks = [
      { id: 'exact', username: 'profile-a', state: 'leased', input: { desireId: stored.id } },
      { id: 'planner', username: 'profile-a', state: 'queued', handler: 'agent.desire-planner', input: { args: ['--desire-id', stored.id] } },
      { id: 'batch', username: 'profile-a', state: 'leased', input: {} },
      { id: 'other', username: 'profile-b', state: 'queued', input: { desireId: stored.id } },
      { id: 'self', username: 'profile-a', state: 'leased', input: { desireId: stored.id } },
    ].map(task => ({ type: 'generic' as const, handler: 'agency.desire-execute',
      priority: 'normal' as const, source: 'system' as const, resource: 'remote-llm',
      createdAt: '2026-01-01T00:00:00Z', attempt: 0, maxAttempts: 1, ...task,
      state: task.state as QueuedTask['state'],
    }))
    const coordinator = { getAllTasks: () => tasks, cancelTask: (id: string) => { cancelled.push(id); return null },
      cancelExecution: (_username: string, id: string) => { executionIds.push(id) } }
    const storage = { loadDesire: async () => structuredClone(stored), saveDesireManifest: async (d: Desire) => { stored = structuredClone(d) } }
    const result = await archiveDesireWork('profile-a', stored.id, 'Zero relevance', 'self', coordinator, storage)
    assert.equal(stored.status, 'archived', status)
    assert.equal(stored.execution?.status, 'outcome_unknown')
    assert.equal(stored.outcomeReview, undefined)
    assert.deepEqual(cancelled, ['exact', 'planner'])
    assert.deepEqual(executionIds, ['execution-1'])
    assert.equal(result.operation, 'archive')
    cancelled.length = 0
    await archiveDesireWork('profile-a', stored.id, 'Zero relevance', 'self', coordinator, storage)
    assert.deepEqual(cancelled, ['exact', 'planner'], 'retry reconciles already archived work')
    stored.strength = .6
    cancelled.length = 0
    const newer = await archiveDesireWork('profile-a', stored.id, 'Old request', 'self', coordinator, storage)
    assert.equal(newer.archived, false)
    assert.deepEqual(cancelled, [])
  }
})

test('archive uses the existing outcome handler with an explicit operation', () => {
  const task = buildDesireAgentTaskInput({ operation: 'archive', username: 'profile-a', desireId: 'desire-test', reason: 'Zero relevance', source: 'system' })
  assert.equal(task.handler, 'agency.desire-outcome-review')
  assert.equal(task.input?.operation, 'archive')
  assert.equal(task.input?.reason, 'Zero relevance')
  assert.throws(() => buildDesireAgentTaskInput({ operation: 'archive', username: 'profile-a', source: 'system' }), /requires a desire ID/)
})
