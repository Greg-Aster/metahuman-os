import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { CuratedMemorySaverNode, saveCuratedResults } from './curated-memory-saver.node.js'
import { CuratorLLMNode, parseCuratorResponse } from './curator-llm.node.js'
import { markCuratedResults, MemoryMarkerNode } from './memory-marker.node.js'
import { buildCuratorPersonaSummary } from './persona-summary-loader.node.js'
import { parseStoredCuratedMemory, type CuratedMemory, type CuratorItemResult, type EpisodicMemory } from './contracts.js'
import { assembleCuratorSources } from './source-assembler.js'
import { getDefaultPersonaCore } from '../../identity.js'

const ROOT = path.resolve(import.meta.dirname, '../../../../..')
const CURATED_AT = '2026-08-24T20:00:00.000Z'

function memory(id = 'memory-1'): EpisodicMemory {
  return {
    id,
    timestamp: '2026-08-24T19:00:00.000Z',
    content: 'The user asked a substantive question.',
    response: 'The assistant answered it clearly.',
    metadata: { cognitiveMode: 'dual' },
  }
}

function curated(id: string, suitableForTraining: boolean): CuratedMemory {
  return {
    id,
    originalTimestamp: '2026-08-24T19:00:00.000Z',
    conversationalEssence: suitableForTraining ? 'A useful exchange' : 'A rejected exchange',
    context: '',
    userMessage: suitableForTraining ? 'What should I do?' : undefined,
    assistantResponse: suitableForTraining ? 'Here is a clear answer.' : undefined,
    curatedAt: CURATED_AT,
    flags: suitableForTraining ? [] : ['low-quality'],
    suitableForTraining,
    rejectionReason: suitableForTraining ? undefined : 'The exchange was too short to train on.',
    cognitiveMode: 'dual',
    cognitiveModeSource: 'metadata',
    memoryType: 'conversation',
    sourceMemoryIds: [id],
  }
}

test('Curator accepts only an explicit, structurally valid LLM decision', () => {
  const source = memory()
  const accepted = parseCuratorResponse(JSON.stringify({
    conversationalEssence: 'A useful exchange',
    userMessage: 'What should I do?',
    assistantResponse: 'Here is a clear answer.',
    suitableForTraining: true,
    flags: [],
  }), source, CURATED_AT)

  assert.equal(accepted.suitableForTraining, true)
  assert.equal(accepted.cognitiveMode, 'dual')
  assert.equal(accepted.cognitiveModeSource, 'metadata')
  assert.equal(accepted.curatedAt, CURATED_AT)

  const legacySource = { ...source, metadata: undefined }
  const legacy = parseCuratorResponse(JSON.stringify({
    conversationalEssence: 'A legacy exchange',
    userMessage: 'What should I do?',
    assistantResponse: 'Here is a clear answer.',
    suitableForTraining: true,
  }), legacySource, CURATED_AT)
  assert.equal(legacy.cognitiveMode, 'dual')
  assert.equal(legacy.cognitiveModeSource, 'legacy-default')

  const environment = parseCuratorResponse(JSON.stringify({
    conversationalEssence: 'An embodied conversation',
    userMessage: 'ignored rewrite',
    assistantResponse: 'ignored rewrite',
    suitableForTraining: true,
  }), {
    ...source,
    content: 'Please look to your left.',
    response: 'I can see the doorway.',
    metadata: { cognitiveMode: 'environment' },
  }, CURATED_AT)
  assert.equal(environment.cognitiveMode, 'environment')
  assert.equal(environment.userMessage, 'Please look to your left.')
  assert.equal(environment.assistantResponse, 'I can see the doorway.')

  assert.throws(
    () => parseCuratorResponse('{"conversationalEssence":"Missing decision"}', source),
    /suitableForTraining must be a boolean/,
  )
  assert.throws(
    () => parseCuratorResponse(JSON.stringify({
      conversationalEssence: 'Accepted but incomplete',
      suitableForTraining: true,
    }), { ...source, response: undefined }),
    /userMessage/,
  )
  assert.throws(
    () => parseCuratorResponse(JSON.stringify({
      conversationalEssence: 'Rejected without a reason',
      suitableForTraining: false,
    }), source),
    /rejectionReason/,
  )
  assert.throws(() => parseCuratorResponse('not-json', source), /not valid JSON/)
  assert.throws(
    () => parseCuratorResponse(JSON.stringify({
      conversationalEssence: 'Bad source mode',
      userMessage: 'What should I do?',
      assistantResponse: 'Here is a clear answer.',
      suitableForTraining: true,
    }), { ...source, metadata: { cognitiveMode: 'invalid' } }),
    /invalid cognitive mode/,
  )
})

test('Curator nodes preserve complete zero-work output contracts', async () => {
  const llm = await CuratorLLMNode.execute(
    { memories: { memories: [] }, personaSummary: 'Name: Test User' },
    { userId: 'test-user' },
    {},
  )
  assert.deepEqual(
    { count: llm.count, accepted: llm.acceptedCount, rejected: llm.rejectedCount, failed: llm.failedCount },
    { count: 0, accepted: 0, rejected: 0, failed: 0 },
  )

  const saver = await CuratedMemorySaverNode.execute(
    { curatedMemories: { curatedMemories: [] } },
    { userId: 'test-user' },
    {},
  )
  assert.deepEqual(saver.curatedMemories, [])
  assert.equal(saver.savedCount, 0)

  const marker = await MemoryMarkerNode.execute(
    { curatedMemories: { curatedMemories: saver.curatedMemories } },
    { userId: 'test-user' },
    {},
  )
  assert.deepEqual(
    { marked: marker.markedCount, alreadyMarked: marker.alreadyMarkedCount },
    { marked: 0, alreadyMarked: 0 },
  )
})

test('Curator persona context uses the canonical persona shape without fabricated fallback text', () => {
  const summary = buildCuratorPersonaSummary(getDefaultPersonaCore())

  assert.match(summary, /Name: MetaHuman/)
  assert.match(summary, /Core Values: autonomy, transparency, growth/)
  assert.doesNotMatch(summary, /\[object Object\]/)
  assert.doesNotMatch(summary, /Not specified|Various topics|Natural and conversational/)
})

test('durable Curator records fail closed while legacy mode provenance stays visible', () => {
  const stored = curated('stored', true)
  const parsed = parseStoredCuratedMemory(stored, 'test record')
  assert.equal(parsed.cognitiveMode, 'dual')
  assert.equal(parsed.cognitiveModeSource, 'metadata')
  assert.deepEqual(parsed.sourceMemoryIds, ['stored'])

  const environment = parseStoredCuratedMemory({ ...stored, cognitiveMode: 'environment' }, 'environment record')
  assert.equal(environment.cognitiveMode, 'environment')

  const { cognitiveMode, cognitiveModeSource, ...legacy } = stored
  const normalizedLegacy = parseStoredCuratedMemory(legacy, 'legacy record')
  assert.equal(normalizedLegacy.cognitiveMode, 'dual')
  assert.equal(normalizedLegacy.cognitiveModeSource, 'legacy-default')
  assert.throws(
    () => parseStoredCuratedMemory({ ...stored, cognitiveMode: 'unknown' }, 'bad record'),
    /invalid cognitiveMode/,
  )
  assert.throws(
    () => parseStoredCuratedMemory({ ...stored, assistantResponse: '' }, 'bad record'),
    /assistantResponse/,
  )
})

test('Curator assembles role-tagged conversation records into one exact exchange', () => {
  const userPath = '/tmp/user.json'
  const assistantPath = '/tmp/assistant.json'
  const assembly = assembleCuratorSources([
    {
      id: 'user-entry',
      timestamp: '2026-08-24T19:00:00.000Z',
      type: 'conversation',
      content: 'User: Please describe what you see.',
      path: userPath,
      metadata: { role: 'user', sessionId: 'robot-session', cognitiveMode: 'environment' },
    },
    {
      id: 'assistant-entry',
      timestamp: '2026-08-24T19:00:01.000Z',
      type: 'conversation',
      content: 'Assistant: I see a blue chair.',
      path: assistantPath,
      metadata: { role: 'assistant', sessionId: 'robot-session', cognitiveMode: 'environment' },
    },
  ])

  assert.equal(assembly.deferredPaths.length, 0)
  assert.equal(assembly.memories.length, 1)
  assert.equal(assembly.memories[0]?.content, 'Please describe what you see.')
  assert.equal(assembly.memories[0]?.response, 'I see a blue chair.')
  assert.deepEqual(assembly.memories[0]?.sourcePaths, [userPath, assistantPath])
  assert.deepEqual(assembly.memories[0]?.sourceMemoryIds, ['user-entry', 'assistant-entry'])
  assert.equal(assembly.memories[0]?.metadata?.cognitiveMode, 'environment')
})

test('Curator defers incomplete role-tagged conversations instead of synthesizing the missing side', () => {
  const assembly = assembleCuratorSources([{
    id: 'waiting-user',
    timestamp: '2026-08-24T19:00:00.000Z',
    type: 'conversation',
    content: 'Please wait for the answer.',
    path: '/tmp/waiting-user.json',
    metadata: { role: 'user', sessionId: 'waiting-session', cognitiveMode: 'environment' },
  }])

  assert.deepEqual(assembly.memories, [])
  assert.deepEqual(assembly.deferredPaths, ['/tmp/waiting-user.json'])
})

test('Curator pairs interleaved turns by their durable idempotency identity', () => {
  const common = {
    timestamp: '2026-08-24T19:00:00.000Z',
    type: 'conversation',
    metadata: { sessionId: 'shared-session', cognitiveMode: 'environment' },
  }
  const assembly = assembleCuratorSources([
    { ...common, id: 'u1', content: 'first question', path: '/tmp/u1.json', metadata: { ...common.metadata, role: 'user', idempotencyKey: 'turn-1:user' } },
    { ...common, id: 'u2', content: 'second question', path: '/tmp/u2.json', metadata: { ...common.metadata, role: 'user', idempotencyKey: 'turn-2:user' } },
    { ...common, id: 'a2', content: 'second answer', path: '/tmp/a2.json', metadata: { ...common.metadata, role: 'assistant', idempotencyKey: 'turn-2:assistant' } },
    { ...common, id: 'a1', content: 'first answer', path: '/tmp/a1.json', metadata: { ...common.metadata, role: 'assistant', idempotencyKey: 'turn-1:assistant' } },
  ])

  assert.equal(assembly.memories.length, 2)
  assert.deepEqual(
    assembly.memories.map(memory => [memory.content, memory.response]),
    [['first question', 'first answer'], ['second question', 'second answer']],
  )
})

test('Curator commits every source record in a reviewed conversation pair', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-curator-pair-'))
  try {
    const sourcePaths = ['user', 'assistant'].map(id => {
      const sourcePath = path.join(temporaryRoot, `${id}.json`)
      fs.writeFileSync(sourcePath, `${JSON.stringify(memory(id), null, 2)}\n`)
      return sourcePath
    })
    const pair = curated('pair-record', true)
    pair.sourceMemoryIds = ['user', 'assistant']
    const result: CuratorItemResult = {
      success: true,
      disposition: 'accepted',
      curated: pair,
      originalMemoryPath: sourcePaths[0],
      originalMemoryPaths: sourcePaths,
      memoryId: pair.id,
    }

    const marked = markCuratedResults([result])
    assert.equal(marked.markedCount, 1)
    assert.equal(marked.sourceMarkedCount, 2)
    assert.equal(marked.markedPaths.length, 2)
    for (const sourcePath of sourcePaths) {
      const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
      assert.equal(source.metadata.curatorRecordId, pair.id)
      assert.match(source.metadata.curatorRecordFile, /pair-record\.json$/)
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('Curator saves before marking, is idempotent, and leaves failed items retryable', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-curator-'))
  const episodicDir = path.join(temporaryRoot, 'episodic')
  const curatedDir = path.join(temporaryRoot, 'curated')
  fs.mkdirSync(episodicDir, { recursive: true })

  try {
    const sourcePaths = ['accepted', 'rejected', 'failed'].map(id => {
      const sourcePath = path.join(episodicDir, `${id}.json`)
      fs.writeFileSync(sourcePath, `${JSON.stringify(memory(id), null, 2)}\n`)
      return sourcePath
    })
    const results: CuratorItemResult[] = [
      {
        success: true,
        disposition: 'accepted',
        curated: curated('accepted', true),
        originalMemoryPath: sourcePaths[0],
        memoryId: 'accepted',
      },
      {
        success: true,
        disposition: 'rejected',
        curated: curated('rejected', false),
        originalMemoryPath: sourcePaths[1],
        memoryId: 'rejected',
      },
      {
        success: false,
        originalMemoryPath: sourcePaths[2],
        memoryId: 'failed',
        error: 'The model returned malformed JSON',
      },
    ]

    const firstSave = saveCuratedResults(results, curatedDir)
    const secondSave = saveCuratedResults(results, curatedDir)
    assert.equal(firstSave.savedCount, 2)
    assert.equal(secondSave.savedCount, 2)
    assert.equal(fs.readdirSync(curatedDir).filter(name => name.endsWith('.json')).length, 2)
    assert.equal(fs.readdirSync(curatedDir).some(name => name.endsWith('.tmp')), false)

    assert.throws(() => markCuratedResults(results), /left 1 memory record\(s\) retryable/)
    const acceptedSource = JSON.parse(fs.readFileSync(sourcePaths[0], 'utf8'))
    const rejectedSource = JSON.parse(fs.readFileSync(sourcePaths[1], 'utf8'))
    const failedSource = JSON.parse(fs.readFileSync(sourcePaths[2], 'utf8'))
    assert.equal(acceptedSource.metadata.curated, true)
    assert.equal(acceptedSource.metadata.curationStatus, 'accepted')
    assert.equal(rejectedSource.metadata.curated, true)
    assert.equal(rejectedSource.metadata.curationStatus, 'rejected')
    assert.equal(failedSource.metadata.curated, undefined)

    const retry = markCuratedResults(results.slice(0, 2))
    assert.equal(retry.markedCount, 0)
    assert.equal(retry.alreadyMarkedCount, 2)
    assert.equal(JSON.parse(fs.readFileSync(sourcePaths[0], 'utf8')).metadata.curatedAt, CURATED_AT)
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('canonical and mobile Curator graphs use one save-then-mark path', () => {
  const canonicalPath = path.join(ROOT, 'etc', 'cognitive-graphs', 'curator-mode.json')
  const mobilePath = path.join(
    ROOT,
    'apps',
    'react-native',
    'nodejs-assets',
    'nodejs-project',
    'etc',
    'cognitive-graphs',
    'curator-mode.json',
  )
  const canonicalText = fs.readFileSync(canonicalPath, 'utf8')
  assert.equal(fs.readFileSync(mobilePath, 'utf8'), canonicalText)

  const graph = JSON.parse(canonicalText)
  const nodeTypes = graph.nodes.map((node: any) => node.data.nodeType)
  assert.deepEqual(nodeTypes, [
    'uncurated_memory_loader',
    'persona_summary_loader',
    'curator_llm',
    'curated_memory_saver',
    'memory_marker',
  ])
  assert.ok(graph.edges.some((edge: any) => edge.source === '5' && edge.target === '8'))
  assert.equal(graph.edges.some((edge: any) => edge.target === '9'), false)
  assert.equal(nodeTypes.includes('training_pair_generator'), false)
  assert.equal(nodeTypes.includes('training_pair_appender'), false)
  assert.equal(nodeTypes.includes('audit_logger'), false)
})
