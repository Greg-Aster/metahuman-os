import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

import {
  cognitiveGraphPath,
  loadGraphFile,
  setAuditEnabled,
  registerProfileStorageConfigGetter,
  runGraph,
  scanEpisodicMemoryRecords,
  type EpisodicMemoryScanOutcome,
  type GraphExecutionState,
  type SvelteFlowGraph,
} from '@metahuman/core'
import {
  parseOrganizerArgs,
  runOrganizer,
  runOrganizerToCompletion,
  type OrganizerDependencies,
} from './core.js'

setAuditEnabled(false)
const TEST_USERNAME = `organizer-test-${process.pid}`
const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-organizer-agent-'))
registerProfileStorageConfigGetter(username => username === TEST_USERNAME
  ? { path: profileRoot, type: 'internal' }
  : undefined)
after(() => fs.rmSync(profileRoot, { recursive: true, force: true }))

const graph = {
  version: '2.0',
  format: 'svelte-flow',
  name: 'Organizer Agent',
  nodes: [],
  edges: [],
} as SvelteFlowGraph

function completedState(relativePath: string, outcome: 'updated' | 'skipped' = 'updated'): GraphExecutionState {
  return {
    nodes: new Map([['editable-saver-id', {
      nodeId: 'editable-saver-id',
      status: 'completed',
      definition: { type: 'memory_saver' },
      outputs: { success: true, relativePath, encrypted: false, outcome },
    }]]),
    startTime: 0,
    endTime: 1,
    status: 'completed',
  }
}

function memory(relativePath = '2026/08/memory.json'): EpisodicMemoryScanOutcome {
  return {
    status: 'record',
    record: {
      relativePath,
      encrypted: false,
      sizeBytes: 100,
      event: {
        id: `evt-${relativePath}`,
        timestamp: '2026-08-29T12:00:00.000Z',
        content: 'The user discussed a garden project.',
      },
    },
  }
}

function dependencies(
  outcomes: EpisodicMemoryScanOutcome[],
  overrides: Partial<OrganizerDependencies> = {},
): OrganizerDependencies {
  return {
    resolveUser: username => ({
      id: 'real-user-id',
      username,
      role: 'owner',
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
    scanMemories: () => outcomes,
    loadGraph: async () => ({ graph, source: '/graphs/organizer-agent.json' }),
    executeGraph: async params => {
      const selected = params.context.organizerMemory as { relativePath: string }
      return completedState(selected.relativePath)
    },
    now: () => '2026-08-29T12:00:00.000Z',
    ...overrides,
  }
}

test('Organizer arguments reject legacy, conflicting, and invalid options', async () => {
  assert.deepEqual(
    parseOrganizerArgs(['--limit', '3', '--reprocess', '--all', '--max-batches=4', `--username=${TEST_USERNAME}`]),
    { limit: 3, reprocess: true, all: true, maxBatches: 4, username: TEST_USERNAME },
  )
  assert.throws(() => parseOrganizerArgs(['--single-user']), /Unknown Organizer argument/)
  assert.throws(() => parseOrganizerArgs(['--limit=0']), /between 1 and 500/)
  assert.throws(() => parseOrganizerArgs(['--limit=501']), /between 1 and 500/)
  assert.throws(() => parseOrganizerArgs(['--max-batches=1001']), /between 1 and 1000/)
  await assert.rejects(
    () => runOrganizerToCompletion({ username: TEST_USERNAME, reprocess: true }),
    /cannot combine --all with --reprocess/,
  )
  assert.throws(
    () => parseOrganizerArgs(['--username=one'], 'two'),
    /conflicts with the triggering user/,
  )
})

test('Organizer can drain bounded batches through the same finite owner', async () => {
  const remaining = [memory('one.json'), memory('two.json'), memory('three.json')]
  const deps = dependencies([], {
    scanMemories: () => remaining,
    executeGraph: async params => {
      const selected = params.context.organizerMemory as { relativePath: string }
      const index = remaining.findIndex(outcome => (
        outcome.status === 'record' && outcome.record.relativePath === selected.relativePath
      ))
      if (index >= 0) remaining.splice(index, 1)
      return completedState(selected.relativePath)
    },
  })

  const result = await runOrganizerToCompletion({
    username: TEST_USERNAME,
    limit: 2,
    maxBatches: 4,
  }, deps)
  assert.equal(result.success, true)
  assert.equal(result.totalProcessed, 3)
  assert.equal(remaining.length, 0)
})

test('Organizer graph is a single-memory enrichment contract without a competing loop', () => {
  const configured = JSON.parse(fs.readFileSync(
    path.resolve('etc/cognitive-graphs/organizer-agent.json'),
    'utf8',
  )) as { nodes: Array<{ data: { nodeType: string; properties?: Record<string, unknown> } }> }
  assert.deepEqual(
    configured.nodes.map(node => node.data.nodeType),
    ['memory_loader', 'llm_enricher', 'memory_saver'],
  )
  const enricher = configured.nodes.find(node => node.data.nodeType === 'llm_enricher')
  assert.match(String(enricher?.data.properties?.promptTemplate), /\{\{content\}\}/)
  assert.equal(configured.nodes.some(node => node.data.nodeType === 'for_each'), false)
})

test('Organizer returns explicit per-memory and scan failures', async () => {
  const result = await runOrganizer({ username: TEST_USERNAME, limit: 2 }, dependencies([
    { status: 'failed', relativePath: 'bad.json', error: 'Malformed JSON' },
    memory(),
  ]))

  assert.equal(result.success, false)
  assert.equal(result.totalConsidered, 1)
  assert.equal(result.totalProcessed, 1)
  assert.equal(result.totalFailed, 1)
  assert.deepEqual(result.outcomes.map(outcome => outcome.status), ['failed', 'updated'])
  assert.match(result.errors[0], /Malformed JSON/)
})

test('Organizer fails graph errors without hiding a successful-looking cycle', async () => {
  const result = await runOrganizer({ username: TEST_USERNAME }, dependencies([memory()], {
    executeGraph: async () => ({
      nodes: new Map([['enrich-memory', {
        nodeId: 'enrich-memory',
        status: 'failed',
        definition: { type: 'llm_enricher' },
        error: new Error('model unavailable'),
      }]]),
      startTime: 0,
      endTime: 1,
      status: 'failed',
    }),
  }))

  assert.equal(result.success, false)
  assert.equal(result.totalProcessed, 0)
  assert.equal(result.totalFailed, 1)
  assert.match(result.errors[0], /model unavailable/)
})

test('Organizer reports graph loading failure as a job error, not a fabricated file outcome', async () => {
  const result = await runOrganizer({ username: TEST_USERNAME }, dependencies([memory()], {
    loadGraph: async () => { throw new Error('graph unavailable') },
  }))
  assert.equal(result.success, false)
  assert.equal(result.totalFailed, 0)
  assert.deepEqual(result.outcomes, [])
  assert.deepEqual(result.errors, ['graph unavailable'])
})

test('Organizer skips already-processed records on repeated invocation', async () => {
  let executions = 0
  const alreadyProcessed = memory()
  if (alreadyProcessed.status === 'record') {
    alreadyProcessed.record.event.metadata = { processed: true }
  }
  const deps = dependencies([alreadyProcessed], {
    executeGraph: async () => {
      executions += 1
      return completedState('unused.json')
    },
  })

  const first = await runOrganizer({ username: TEST_USERNAME }, deps)
  const second = await runOrganizer({ username: TEST_USERNAME }, deps)
  assert.equal(first.success, true)
  assert.equal(second.success, true)
  assert.equal(first.totalConsidered, 0)
  assert.equal(executions, 0)
})

test('Organizer admits saved inner dialogue even when producer tags already exist', async () => {
  let selectedType = ''
  const inner = memory('2026/08/inner.json')
  if (inner.status === 'record') {
    inner.record.event.type = 'inner_dialogue'
    inner.record.event.tags = ['inner', 'reflection']
    inner.record.event.metadata = { role: 'reflection' }
  }
  const result = await runOrganizer({ username: TEST_USERNAME }, dependencies([inner], {
    executeGraph: async params => {
      const selected = params.context.organizerMemory as { type: string; relativePath: string }
      selectedType = selected.type
      return completedState(selected.relativePath)
    },
  }))

  assert.equal(result.success, true)
  assert.equal(result.totalConsidered, 1)
  assert.equal(result.totalProcessed, 1)
  assert.equal(selectedType, 'inner_dialogue')
})

test('Organizer honors cancellation before graph execution', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    () => runOrganizer({ username: TEST_USERNAME, signal: controller.signal }, dependencies([memory()])),
    error => error instanceof DOMException && error.name === 'AbortError',
  )
})

test('Organizer rejects unresolved profile identity', async () => {
  await assert.rejects(
    () => runOrganizer({ username: 'missing' }, dependencies([], { resolveUser: () => null })),
    /user does not exist/,
  )
})

test('Organizer executes the real graph and Core persistence contract for unsupported content', async t => {
  const memoryRoot = path.join(profileRoot, 'memory')
  const episodic = path.join(memoryRoot, 'episodic')
  const recordPath = path.join(episodic, 'reflection.json')
  fs.mkdirSync(episodic, { recursive: true })
  fs.writeFileSync(recordPath, JSON.stringify({
    id: 'evt-reflection',
    timestamp: '2026-08-29T12:00:00.000Z',
    content: 'Operator-only record',
    type: 'operator',
  }))
  t.after(() => fs.rmSync(memoryRoot, { recursive: true, force: true }))

  const result = await runOrganizer({ username: TEST_USERNAME, limit: 1 }, {
    resolveUser: username => ({
      id: 'real-user-id',
      username,
      role: 'owner',
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
    scanMemories: username => scanEpisodicMemoryRecords(username),
    async loadGraph() {
      const loaded = await loadGraphFile(cognitiveGraphPath('organizer-agent.json'))
      if (!loaded) throw new Error('Expected Organizer graph')
      return loaded
    },
    executeGraph: runGraph,
    now: () => '2026-08-29T12:01:00.000Z',
  })

  assert.equal(result.success, true)
  assert.equal(result.totalSkipped, 1)
  const durable = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
  assert.equal(durable.metadata.processed, true)
  assert.equal(durable.metadata.organizerStatus, 'no-content')
})
