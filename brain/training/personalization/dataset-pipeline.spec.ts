import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { CURATOR_POLICY_VERSION, episodicSourceHash, setAuditEnabled, selectReviewedPersonalizationDataset,
  type ReviewedPersonalizationDataset, type CuratedMemory, type EpisodicEvent } from '@metahuman/core'
import { parseTrainingDataSettings } from '@metahuman/core/training-schema'
import { parsePositiveInteger, parseCognitiveMode, preparePersonalizationDataset, type PersonalizationProgram } from './dataset-pipeline.js'

const cutoff = '2026-09-09T00:00:00Z'
setAuditEnabled(false)
const settings = parseTrainingDataSettings({ objective: 'assistant-continuation', includePersona: false })

function reviewedInputs(): ReviewedPersonalizationDataset {
  const sample = (id: string) => ({ id, messages: [
    { role: 'system' as const, content: 'Existing runtime contract ' + id },
    { role: 'user' as const, content: JSON.stringify({ inputSource: 'autonomy', time: cutoff, selectedContext: { observation: id } }) },
    { role: 'assistant' as const, content: JSON.stringify({ program: null, taskDecision: null }) },
  ], metadata: { sourceIds: [id], sourceHashes: { [id]: 'a'.repeat(64) }, curatedRecordIds: [id],
    group: id, timestamp: cutoff, sourceType: 'conversation', mode: 'environment' as const,
    objective: 'assistant-continuation' as const, targetAuthor: 'assistant' as const, synthetic: true } })
  return { review: { reviewer: 'test owner', reviewedAt: cutoff, purpose: 'Exact runtime context regression' },
    train: [sample('train-family')], evaluation: [sample('eval-family')] }
}

test('reviewed runtime messages survive freezing and the real Python manifest consumer', async t => {
  const reviewedDataset = reviewedInputs()
  const opts = { ...options(t), reviewedDataset }
  const result = await preparePersonalizationDataset(opts, { settings, inspection: { records: [], sources: [], cutoff, errors: [] },
    runProgram: async () => { throw new Error('Reviewed examples must not be preprocessed again') } })
  assert.deepEqual(JSON.parse(fs.readFileSync(result.datasetPaths[0]!, 'utf8')).messages, reviewedDataset.train[0]!.messages)
  const script = `import importlib.util,sys
spec=importlib.util.spec_from_file_location('trainer',sys.argv[1]); trainer=importlib.util.module_from_spec(spec); spec.loader.exec_module(trainer)
trainer.verify_manifest(sys.argv[2],sys.argv[3],sys.argv[4],{'base_model':'test-model'})
`
  execFileSync('python3', ['-c', script, path.resolve('docker/runpod-trainer/train_unsloth.py'),
    result.manifestPath, result.datasetPaths[0]!, result.evaluationPaths[0]!])
})

test('reviewed examples retain author and family independence including previous runs', () => {
  const reviewed = reviewedInputs()
  const wrongAuthor = structuredClone(reviewed)
  Object.assign(wrongAuthor.train[0]!.metadata, { targetAuthor: 'human' })
  assert.throws(() => selectReviewedPersonalizationDataset(wrongAuthor, settings, cutoff), /target author/)
  const sameFamily = structuredClone(reviewed)
  sameFamily.evaluation[0]!.metadata.group = sameFamily.train[0]!.metadata.group
  assert.throws(() => selectReviewedPersonalizationDataset(sameFamily, settings, cutoff), /share a family/)
  assert.throws(() => selectReviewedPersonalizationDataset(reviewed, settings, cutoff,
    { assignments: { 'group:eval-family': 'train' }, completedSampleIds: [] }), /previously frozen/)
})
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

test('mixed-mode frozen datasets pass the real Python manifest and native-label consumers', async t => {
  const sources: EpisodicEvent[] = []
  const records: CuratedMemory[] = []
  for (const mode of ['dual', 'environment'] as const) for (let session = 0; session < 20; session++) {
    for (let turn = 0; turn < 2; turn++) {
      const pair = ['user', 'assistant'].map((role, offset) => ({
        id: `${mode}-${session}-${turn}-${role}`, type: 'conversation' as const,
        timestamp: new Date(Date.parse('2026-09-01T00:00:00Z') + turn * 2000 + offset * 1000).toISOString(),
        content: `${role} ${mode} session ${session} turn ${turn}`,
        metadata: { cognitiveMode: mode, role, sessionId: `${mode}-${session}` },
      }))
      sources.push(...pair)
      records.push({ id: `review-${mode}-${session}-${turn}`, originalTimestamp: pair[0]!.timestamp,
        conversationalEssence: 'Reviewed fixture exchange', context: '', userMessage: pair[0]!.content,
        assistantResponse: pair[1]!.content, curatedAt: cutoff, flags: [], suitableForTraining: true,
        cognitiveMode: mode, cognitiveModeSource: 'metadata', memoryType: 'conversation', sourceMemoryIds: pair.map(source => source.id),
        provenance: { policyVersion: CURATOR_POLICY_VERSION, kind: 'recorded-exchange',
          sourceHashes: Object.fromEntries(pair.map(source => [source.id, episodicSourceHash(source)])), sessionId: `${mode}-${session}` },
      })
    }
  }
  const opts = { ...options(t), skipPreprocessing: true }
  const result = await preparePersonalizationDataset(opts, {
    settings: parseTrainingDataSettings({ includePersona: false }), inspection: { sources, records, cutoff, errors: [] },
  })
  const script = `
import importlib.util, json, pathlib, sys
module = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('trainer_tests', module)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
trainer = fixture.trainer
manifest = trainer.verify_manifest(pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3]), pathlib.Path(sys.argv[4]), {'base_model':'test-model'})
counts = {}
for filename in sys.argv[3:5]:
    for row in trainer.read_rows(pathlib.Path(filename)):
        mode = row['metadata']['mode']
        objective = 'human-continuation' if mode == 'dual' else 'assistant-continuation'
        assert row['metadata']['objective'] == objective
        target = row['messages'][-1]['content']
        assert target.startswith('user ' if mode == 'dual' else 'assistant ')
        capacity = len(fixture.TextTokenizer().apply_chat_template(row['messages'], tokenize=False, add_generation_prompt=False, enable_thinking=False))
        tokens = trainer.tokenize_row(fixture.TextTokenizer(), row, capacity)
        assert ''.join(chr(label) for label in tokens['labels'] if label != -100) == target + '~'
        counts[mode] = counts.get(mode, 0) + 1
print(json.dumps(counts))
`
  const response = execFileSync('python3', ['-c', script, path.resolve(import.meta.dirname, '../../../docker/runpod-trainer/test_train_unsloth.py'),
    result.manifestPath, result.datasetPaths[0]!, result.evaluationPaths[0]!], { encoding: 'utf8' })
  assert.deepEqual(JSON.parse(response), { dual: 20, environment: 40 })
})
