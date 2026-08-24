import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { CuratedMemorySaverNode, saveCuratedResults } from './curated-memory-saver.node.js'
import { CuratorLLMNode, parseCuratorResponse } from './curator-llm.node.js'
import { markCuratedResults, MemoryMarkerNode } from './memory-marker.node.js'
import { parseStoredCuratedMemory, type CuratedMemory, type CuratorItemResult, type EpisodicMemory } from './contracts.js'

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

  assert.throws(
    () => parseCuratorResponse('{"conversationalEssence":"Missing decision"}', source),
    /suitableForTraining must be a boolean/,
  )
  assert.throws(
    () => parseCuratorResponse(JSON.stringify({
      conversationalEssence: 'Accepted but incomplete',
      suitableForTraining: true,
    }), source),
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

test('durable Curator records fail closed while legacy mode provenance stays visible', () => {
  const stored = curated('stored', true)
  const parsed = parseStoredCuratedMemory(stored, 'test record')
  assert.equal(parsed.cognitiveMode, 'dual')
  assert.equal(parsed.cognitiveModeSource, 'metadata')

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
    'audit_logger',
  ])
  assert.ok(graph.edges.some((edge: any) => edge.source === '5' && edge.target === '8'))
  assert.equal(nodeTypes.includes('training_pair_generator'), false)
  assert.equal(nodeTypes.includes('training_pair_appender'), false)
})
