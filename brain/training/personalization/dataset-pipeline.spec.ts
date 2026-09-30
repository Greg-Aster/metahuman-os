import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CURATOR_POLICY_VERSION, episodicSourceHash, setAuditEnabled, type CuratedMemory, type EpisodicEvent } from '@metahuman/core'
import { parseTrainingDataSettings } from '@metahuman/core/training-schema'
import { parsePositiveInteger, parseCognitiveMode, preparePersonalizationDataset, type PersonalizationProgram } from './dataset-pipeline.js'

const cutoff = '2026-09-09T00:00:00Z'
setAuditEnabled(false)
const settings = parseTrainingDataSettings({ objective: 'assistant-continuation', includePersona: false })
function inputs() {
  const sources: EpisodicEvent[] = Array.from({ length: 40 }, (_, i) => ({
    id: 'source-' + i, timestamp: '2026-09-01T00:00:00Z', type: 'conversation',
    content: 'Question ' + i, response: 'Answer ' + i, metadata: { cognitiveMode: 'emulation' },
  }))
  const records: CuratedMemory[] = sources.map(source => ({
    id: source.id, originalTimestamp: source.timestamp, conversationalEssence: 'Synthetic test example',
    context: '', userMessage: source.content, assistantResponse: source.response,
    curatedAt: cutoff, flags: [], suitableForTraining: true, cognitiveMode: 'emulation',
    cognitiveModeSource: 'metadata', memoryType: 'conversation', sourceMemoryIds: [source.id],
    provenance: { policyVersion: CURATOR_POLICY_VERSION, kind: 'recorded-exchange',
      sourceHashes: { [source.id]: episodicSourceHash(source) }, sessionId: source.id },
  }))
  return { records, sources, cutoff, errors: [] }
}
function options(t: test.TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-personalization-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { actor: 'test', baseModel: 'test-model', username: 'test-user', logPrefix: 'test',
    outputRoot: root, datasetPaths: [path.join(root, 'train.jsonl')], cutoff }
}

test('the canonical pipeline writes exact messages, independent evaluation and a frozen manifest', async t => {
  const opts = options(t)
  opts.datasetPaths.push(path.join(opts.outputRoot, 'archive', 'dataset.jsonl'))
  const calls: PersonalizationProgram[] = []
  const args: string[][] = []
  const result = await preparePersonalizationDataset(opts, {
    settings, inspection: inputs(),
    runProgram: async (program, arguments_) => { calls.push(program); args.push(arguments_); return 0 },
  })
  assert.deepEqual(calls, ['organizer', 'curator'])
  assert.deepEqual(args[1]!.slice(-2), ['--cutoff', cutoff])
  assert.ok(result.sampleCount > 0 && result.evaluationCount > 0)
  const text = fs.readFileSync(opts.datasetPaths[0]!, 'utf8')
  assert.equal(text, fs.readFileSync(opts.datasetPaths[1]!, 'utf8'))
  const rows = text.trim().split('\n').map(line => JSON.parse(line))
  assert.equal(rows.length, result.sampleCount)
  for (const row of rows) {
    assert.deepEqual(row.messages, [
      { role: 'user', content: 'Question ' + row.metadata.sourceIds[0].split('-').at(-1) },
      { role: 'assistant', content: 'Answer ' + row.metadata.sourceIds[0].split('-').at(-1) },
    ])
    assert.equal(row.input, undefined)
    assert.equal(row.instruction, undefined)
  }
  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'))
  assert.equal(manifest.datasetId, result.datasetId)
  assert.equal(manifest.supervision, 'final-assistant-only')
  assert.equal(manifest.settings.includePersona, false)
  assert.equal(manifest.baseModel, 'test-model')
  assert.ok(manifest.train.sourceIds.every((id: string) => !manifest.evaluation.sourceIds.includes(id)))
  await assert.rejects(() => preparePersonalizationDataset(opts, { settings, inspection: inputs() }), /already has a frozen dataset/)
})

test('identical frozen data and controls produce identical manifests across run directories', async t => {
  const first = await preparePersonalizationDataset({ ...options(t), skipPreprocessing: true }, { settings, inspection: inputs() })
  const second = await preparePersonalizationDataset({ ...options(t), skipPreprocessing: true }, { settings, inspection: inputs() })
  assert.equal(first.datasetId, second.datasetId)
  assert.equal(fs.readFileSync(first.manifestPath, 'utf8'), fs.readFileSync(second.manifestPath, 'utf8'))
})

test('no dataset is committed if either required preprocessing stage fails', async t => {
  for (const failed of ['organizer', 'curator'] as const) {
    const opts = options(t)
    const calls: PersonalizationProgram[] = []
    await assert.rejects(preparePersonalizationDataset(opts, {
      settings, inspection: inputs(),
      runProgram: async program => { calls.push(program); return program === failed ? 7 : 0 },
    }), new RegExp(failed + ' failed with exit code 7'))
    assert.deepEqual(calls, failed === 'organizer' ? ['organizer'] : ['organizer', 'curator'])
    assert.equal(fs.existsSync(path.join(opts.outputRoot, 'dataset-manifest.json')), false)
  }
})

test('preparation rejects absent evaluation groups, zero-weight data and changed cutoffs', async t => {
  const inspection = inputs()
  const common = { ...options(t), skipPreprocessing: true }
  await assert.rejects(preparePersonalizationDataset(common, {
    settings, inspection: { ...inspection, cutoff: '2025-01-01T00:00:00Z' },
  }), /does not match/)
  await assert.rejects(preparePersonalizationDataset(common, {
    settings: parseTrainingDataSettings({ ...settings, memoryTypes: { percentages: { conversation: 0 } } }), inspection,
  }), /No eligible training examples/)
  const oneGroup = { ...inspection, records: inspection.records.map(record => ({
    ...record, provenance: { ...record.provenance!, sessionId: 'one-session' },
  })) }
  await assert.rejects(preparePersonalizationDataset(common, { settings, inspection: oneGroup }), /No independent evaluation group|No eligible training examples/)
  assert.equal(fs.existsSync(common.datasetPaths[0]!), false)
})

test('limits and mode filters are strict', () => {
  assert.equal(parsePositiveInteger('12', 'limit'), 12)
  assert.throws(() => parsePositiveInteger('0', 'limit'), /positive integer/)
  assert.throws(() => parsePositiveInteger('2.5', 'limit'), /positive integer/)
  assert.equal(parseCognitiveMode('environment', 'mode'), 'environment')
  assert.throws(() => parseCognitiveMode('all', 'mode'), /dual, emulation, agent, or environment/)
})
