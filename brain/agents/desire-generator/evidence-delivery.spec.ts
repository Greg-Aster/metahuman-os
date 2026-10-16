import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import test, { mock } from 'node:test'
import * as core from '@metahuman/core'
import { executeDesireGeneration } from '../../../packages/core/src/nodes/agency/desire-generation.node.js'

const tasks = Array.from({ length: 12 }, (_, index) => ({
  id: `task-${index}`, title: `Task ${index}`, status: 'active', priority: 'P2', tags: [],
  description: 'Context '.repeat(200) + `distinct final condition ${index}`,
}))
let pendingDesires: core.Desire[] = []
let targetStrength = 0.99
let emptyEvidence = false
let archiveRequests: string[] = []
let archivedMetric = 0
let failArchiveAdmission = false
let persistRelevance = false
let archiveKeys: string[] = []
let personaWrites = 0
let reinforcementsApplied = 0
let operationalContext: any = undefined
let memoryFiles: string[] = []
const reviewed = new Set<string>()
let enabledSources = ['task']
let goal = { id: 'goal-mid-0', goal: 'Understand the surroundings', status: 'planning', priority: 'mid' }
let standingGoals: Array<{ id: string; goal: string; status: string }> = []
let capacity = 0
let modelCalls = 0
let failModel = false
let delivered = ''
let deliveredReview = ''
let graphOutput: Record<string, unknown>
mock.module('@metahuman/core', { namedExports: {
  ...core,
  isAgencyEnabled: async () => true,
  loadConfig: async () => ({ limits: { maxActiveDesires: capacity, maxPendingDesires: 0 }, thresholds: { decay: { enabled: false } }, logging: { logToInnerDialogue: false } }),
  initializeAgencyStorage: async () => {},
  incrementMetric: async (name: string, amount: number) => { if (name === 'totalAbandoned') archivedMetric += amount },
  getEnabledSources: async () => enabledSources,
  loadPersonaCore: () => ({ goals: { shortTerm: standingGoals, midTerm: [{ goal: goal.goal, status: goal.status }] } }),
  listAllDesires: async () => pendingDesires,
  submitDesireAgent: async (input: any) => { archiveRequests.push(input.desireId); archiveKeys.push(input.idempotencyKey); if (failArchiveAdmission) throw new Error('Archive admission unavailable'); return {} },
  listActiveTasks: async () => tasks,
  listEpisodicFiles: () => memoryFiles,
  readDesireOperationalContext: async () => operationalContext,
  listActiveDesires: async () => [], listNascentDesires: async () => [],
  listPendingDesires: async () => pendingDesires, listDesiresByStatus: async () => [],
  savePersonaCore: () => { personaWrites++ },
  applyDesireRelevance: async (_id: string, data: any) => {
    reinforcementsApplied++
    const updated = { ...pendingDesires[0], strength: data.targetStrength, status: data.targetStrength === 0 ? 'archived' : pendingDesires[0].status, updatedAt: '2026-10-15T18:00:00.000Z', completedAt: data.targetStrength === 0 ? '2026-10-15T18:00:00.000Z' : undefined, reinforcements: 6, metrics: { ...pendingDesires[0].metrics, reinforcementCount: 6 } } as core.Desire
    if (persistRelevance) pendingDesires = [updated]
    return updated
  },
  loadTrustLevel: () => 'suggest',
  filterUnanalyzedGeneratorInputs: async (tokens: string[]) => tokens.filter(token => !reviewed.has(token)),
  markGeneratorInputsAnalyzed: async (tokens: string[]) => { for (const token of tokens) reviewed.add(token) },
  getTargetUser: () => ({ username: 'test', userId: 'test', role: 'owner' }),
  cognitiveGraphPath: () => 'test-graph',
  loadGraphFile: async () => ({ graph: {} }),
  runGraph: async ({ context }: any) => {
    graphOutput = await executeDesireGeneration(context.desireGeneratorInput, context, {}, {
      callModel: async request => {
        modelCalls++
        delivered = String(request.messages[1]?.content ?? '')
        if (context.desireGeneratorInput.operation === 'reinforce') deliveredReview = delivered
        if (failModel) throw new Error('provider capacity exceeded')
        return { content: context.desireGeneratorInput.operation === 'reinforce' ? JSON.stringify({ ...Object.fromEntries(context.desireGeneratorInput.existingDesires.map((desire: any) => [desire.id, { targetStrength: emptyEvidence ? desire.strength : targetStrength, reason: 'Fresh task evidence', evidenceIds: emptyEvidence ? [] : ['task:strong-desire-evidence'] }])) }) : '[]', model: 'test', modelId: 'test', role: 'persona', provider: 'test' }
      },
    })
    return { status: 'completed' }
  },
  requireGraphNodeOutput: () => graphOutput,
} })
const { generateDesiresForUser, gatherInputs } = await import('./core.js')

test('only successfully delivered evidence is acknowledged, and repeated reviews retain once-only semantics', async () => {
  await generateDesiresForUser('test')
  assert.equal(modelCalls, 0)
  assert.equal(reviewed.size, 0, 'capacity-skipped evidence must remain available')
  capacity = 1
  failModel = true
  await assert.rejects(generateDesiresForUser('test'), /provider capacity exceeded/)
  assert.equal(reviewed.size, 0, 'failed inference must not consume evidence')
  failModel = false
  await generateDesiresForUser('test')
  assert.equal(reviewed.size, tasks.length)
  for (const task of tasks) {
    assert.ok(delivered.includes(`id=${task.id} | ${task.title}: ${task.description}`))
    const hash = createHash('sha256').update(JSON.stringify({ id: task.id, title: task.title, description: task.description, priority: task.priority, status: task.status, tags: task.tags })).digest('hex').slice(0, 20)
    assert.ok(reviewed.has(`task:${task.id}:${hash}`))
  }
  await generateDesiresForUser('test')
  assert.equal(modelCalls, 2, 'already reviewed evidence must not trigger another call')
})


test('unchanged standing goals remain context while fresh evidence alone admits another review', async () => {
  enabledSources = ['persona_goal', 'task']
  const token = () => `persona_goal:${goal.id}:${createHash('sha256').update(JSON.stringify(goal)).digest('hex').slice(0, 20)}`
  reviewed.add(token())
  const before = modelCalls
  await generateDesiresForUser('test')
  assert.equal(modelCalls, before, 'standing goals alone cannot admit a model call')
  tasks.push({ ...tasks[0], id: 'new-task' })
  await generateDesiresForUser('test')
  assert.equal(modelCalls, before + 1)
  assert.ok(delivered.includes('### Standing Persona Goals'))
  assert.ok(delivered.includes(goal.goal))
  assert.ok(delivered.includes('id=new-task |'))
  const count = reviewed.size
  await generateDesiresForUser('test')
  assert.equal(modelCalls, before + 1)
  assert.equal(reviewed.size, count)
  goal = { ...goal, goal: 'Understand a changed situation' }
  await generateDesiresForUser('test')
  assert.equal(modelCalls, before + 2, 'a changed goal remains fresh evidence')
  assert.ok(reviewed.has(token()))
  assert.ok(!delivered.includes('### Standing Persona Goals'))
})


test('proposed and aspirational standing goals are delivered but never acknowledged as fresh evidence', async () => {
  standingGoals = Array.from({ length: 14 }, (_, index) => ({ id: `recorded-${index}`, goal: `Complete standing goal ${index} suffix`, status: index % 2 ? 'aspirational' : 'proposed' }))
  const before = modelCalls
  const previousTokens = new Set(reviewed)
  await generateDesiresForUser('test')
  assert.equal(modelCalls, before)
  tasks.push({ ...tasks[0], id: 'standing-context-review' })
  await generateDesiresForUser('test')
  assert.equal(modelCalls, before + 1)
  for (const item of standingGoals) {
    assert.ok(delivered.includes(`id=${item.id} | priority=short | ${item.goal} (${item.status})`))
    assert.ok(![...reviewed].some(token => token.includes(item.id)))
  }
  assert.equal([...reviewed].filter(token => !previousTokens.has(token)).length, 1)
  await generateDesiresForUser('test')
  assert.equal(modelCalls, before + 1)
})


test('recorded attribution survives the actual memory loader into generation and reinforcement without replaying acknowledged evidence', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'desire-attribution-'))
  const attribution = { role: 'assistant', source: 'conversation', dialogueSource: 'robot-autonomy-controller', cognitiveMode: 'environment', executionId: 'execution-test', correlationId: 'correlation-test' }
  const original = { id: 'memory-attribution', content: 'Recorded thought ' + 'complete content '.repeat(300) + 'final suffix', type: 'conversation', timestamp: new Date().toISOString(), tags: [] }
  const originalToken = `memory_pattern:${original.id}:${createHash('sha256').update(JSON.stringify(original)).digest('hex').slice(0, 20)}`
  try {
    memoryFiles = [path.join(directory, 'memory.json')]
    await fs.writeFile(memoryFiles[0], JSON.stringify({ ...original, metadata: { ...attribution, unrelated: 'not forwarded' } }))
    enabledSources = ['memory_pattern']
    reviewed.add(originalToken)
    const before = modelCalls
    await generateDesiresForUser('test')
    assert.equal(modelCalls, before, 'attribution enrichment must not replay previously reviewed memory')
    const changed = { ...original, content: original.content + ' changed observation' }
    await fs.writeFile(memoryFiles[0], JSON.stringify({ ...changed, metadata: attribution }))
    await generateDesiresForUser('test')
    assert.equal(modelCalls, before + 1, 'changed memory content is still fresh')
    assert.ok(delivered.includes(changed.content))
    assert.ok(delivered.includes(`timestamp=${original.timestamp}`))
    assert.ok(delivered.includes(`attribution=${JSON.stringify(attribution)}`))
    const gathered = await gatherInputs(['memory_pattern'])
    assert.deepEqual(gathered.recentMemories[0].attribution, attribution)
    let reinforcement = ''
    await executeDesireGeneration({ operation: 'reinforce', inputs: gathered, existingDesires: [{ id: 'desire-test', title: 'Recorded desire', description: 'Recorded description', reason: 'Recorded reason', strength: 0.5, source: 'memory_pattern' }] }, { username: 'test' }, {}, {
      callModel: async request => {
        reinforcement = String(request.messages[1]?.content)
        return { content: JSON.stringify({ 'desire-test': { targetStrength: 0.5, reason: 'No relevance change', evidenceIds: [] } }), model: 'test', modelId: 'test', role: 'persona', provider: 'test' }
      },
    })
    const catalogText = reinforcement.split('Current evidence catalog:\n')[1].split('\n\nReturn one JSON object keyed')[0]
    const catalog = JSON.parse(catalogText)
    assert.ok(catalog[0].summary.includes('type=conversation |'))
    assert.ok(catalog[0].summary.includes(changed.content))
    assert.ok(catalog[0].summary.includes(`timestamp=${original.timestamp}`))
    assert.ok(catalog[0].summary.includes(`attribution=${JSON.stringify(attribution)}`))
    await generateDesiresForUser('test')
    assert.equal(modelCalls, before + 1)
    await fs.writeFile(memoryFiles[0], JSON.stringify({ ...original, metadata: { role: 'user', source: 'conversation' } }))
    assert.deepEqual((await gatherInputs(['memory_pattern'])).recentMemories[0].attribution, { role: 'user', source: 'conversation' })
    await fs.writeFile(memoryFiles[0], JSON.stringify(original))
    assert.equal((await gatherInputs(['memory_pattern'])).recentMemories[0].attribution, undefined)
  } finally {
    memoryFiles = []
    await fs.rm(directory, { recursive: true, force: true })
  }
})


test('strong repeatedly reinforced desires remain Desire lifecycle changes without persona goal writes', async () => {
  enabledSources = ['task']
  tasks.push({ ...tasks[0], id: 'strong-desire-evidence' })
  pendingDesires = [{
    id: 'strong-desire', title: 'Recorded finite desire', description: 'Complete the recorded task', reason: 'Recorded evidence',
    status: 'pending', source: 'task', strength: 0.95, reinforcements: 5, threshold: 0.5,
    completionCriteria: 'Recorded task completion',
    evidence: [{ id: 'real-evidence', kind: 'origin', source: 'task', sourceId: 'strong-desire-evidence', summary: 'Recorded evidence', observedAt: new Date().toISOString() }],
    metrics: { reinforcementCount: 5 },
  } as core.Desire]
  try {
    assert.equal(core.isDesireActivationEligible(pendingDesires[0]), true)
    const result = await generateDesiresForUser('test')
    assert.equal(reinforcementsApplied, 1)
    assert.equal(result, 1)
    assert.equal(personaWrites, 0)
    await generateDesiresForUser('test')
    assert.equal(reinforcementsApplied, 1, 'same evidence cannot repeatedly reinforce the desire')
  } finally { pendingDesires = [] }
})


test('all open lifecycle stages receive exact downward targets and unchanged decisions do not fabricate evidence', async () => {
  enabledSources = ['task']
  const fixture = { id: 'stage-desire', title: 'Recorded finite desire', description: 'Finite result', reason: 'Recorded evidence', source: 'task', strength: 0.8, reinforcements: 5, threshold: 0.7, completionCriteria: 'Measured result', metrics: { reinforcementCount: 5 } }
  const evidence = tasks.find(task => task.id === 'strong-desire-evidence')!
  try {
    for (const status of core.OPEN_DESIRE_STATUSES) {
      evidence.description += ` change-${status}`
      pendingDesires = [{ ...fixture, status } as core.Desire]
      targetStrength = 0.2
      const before = reinforcementsApplied
      await generateDesiresForUser('test')
      assert.equal(reinforcementsApplied, before + 1, status)
      assert.ok(deliveredReview.includes(`"status": "${status}"`), status)
    }
    emptyEvidence = true
    evidence.description += ' unchanged evidence'
    const before = reinforcementsApplied
    await generateDesiresForUser('test')
    assert.equal(reinforcementsApplied, before)
    emptyEvidence = false
    targetStrength = 0
    const archivedBefore = archivedMetric
    evidence.description += ' obsolete evidence'
    await generateDesiresForUser('test')
    assert.ok(archiveRequests.includes('stage-desire'))
    assert.equal(archivedMetric, archivedBefore + 1, 'count the persisted archive, not just its cancellation request')
    enabledSources = []
    pendingDesires = [{ ...fixture, status: 'planning', strength: 0 } as core.Desire]
    archiveRequests = []
    await generateDesiresForUser('test')
    assert.deepEqual(archiveRequests, ['stage-desire'])
    assert.equal(archivedMetric, archivedBefore + 1, 'existing-zero recovery request is not a completed archive')
  } finally { pendingDesires = []; emptyEvidence = false }
})


test('a failed archive admission is recovered from the saved zero archive without reopening the desire', async () => {
  enabledSources = ['task']
  tasks.find(task => task.id === 'strong-desire-evidence')!.description += ' archive recovery evidence'
  pendingDesires = [{ id: 'recover-archive', title: 'Recorded desire', status: 'pending', source: 'task', strength: 0.8, updatedAt: '2026-10-15T17:00:00.000Z', metrics: { reinforcementCount: 0 } } as core.Desire]
  targetStrength = 0
  persistRelevance = true
  failArchiveAdmission = true
  archiveKeys = []
  try {
    await assert.rejects(generateDesiresForUser('test'), /Archive admission unavailable/)
    assert.equal(pendingDesires[0].status, 'archived')
    assert.equal(pendingDesires[0].strength, 0)
    const applied = reinforcementsApplied
    failArchiveAdmission = false
    await generateDesiresForUser('test')
    assert.equal(archiveKeys.length, 2)
    assert.equal(archiveKeys[0], archiveKeys[1], 'retry uses the identity of the saved archival transition')
    assert.equal(reinforcementsApplied, applied)
    assert.equal(pendingDesires[0].status, 'archived')
  } finally { pendingDesires = []; persistRelevance = false; failArchiveAdmission = false }
})

test('actual execution receipts become attributed eligible task evidence once while live read timestamps do not', async () => {
  enabledSources = ['task']
  pendingDesires = []
  const event = { eventId: 'receipt-one', kind: 'physical_result', sequence: 1, createdAt: 123, payload: { command: 'stretch', status: 'completed' } }
  operationalContext = { readAt: '2026-10-15T18:00:00Z', robotStatus: {}, capabilities: null, unavailableExecutionIds: [], executions: [{
    executionId: 'execution-one', task: { objectiveId: 'objective-one', instruction: 'Watch the person quietly' },
    admittedInput: { userMessage: 'Watch the person quietly' }, instructions: [], selections: [{ program: { command: 'stretch' } }], events: [event],
  }] }
  const before = modelCalls
  try {
    await generateDesiresForUser('test')
    assert.equal(modelCalls, before + 1)
    assert.ok(delivered.includes('Watch the person quietly'))
    assert.ok(delivered.includes('stretch'))
    assert.ok(delivered.includes('id=objective-one | source=task | reference=operational:execution:execution-one:event:receipt-one'))
    operationalContext.readAt = '2026-10-15T19:00:00Z'
    await generateDesiresForUser('test')
    assert.equal(modelCalls, before + 1)
    operationalContext.executions[0].events.push({ ...event, eventId: 'receipt-two', sequence: 2, payload: { command: 'captureImage', status: 'failed' } })
    await generateDesiresForUser('test')
    assert.equal(modelCalls, before + 2)
    assert.ok(delivered.includes('id=objective-one | source=task | reference=operational:execution:execution-one:event:receipt-two'))
    assert.ok(!delivered.includes('id=objective-one | source=task | reference=operational:execution:execution-one:event:receipt-one'))
    assert.ok(delivered.includes('receipt-one'), 'older evidence remains available as context')
  } finally { operationalContext = undefined }
})
