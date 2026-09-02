import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import type { FormattedSample, SchemaAppliedSample } from '@metahuman/core/schema-manager'

import {
  parsePositiveInteger,
  parseCognitiveMode,
  preparePersonalizationDataset,
  type PersonalizationProgram,
  type ProgramRunner,
} from './dataset-pipeline.js'

const formattedSamples: FormattedSample[] = [{
  mode: 'dual',
  input: 'question',
  output: 'answer',
  metadata: { original_id: 'sample-1', source_type: 'conversation' },
}]

const schemaSamples: SchemaAppliedSample[] = [{
  ...formattedSamples[0],
  input: '<wrapped>question</wrapped>',
  output: '<wrapped>answer</wrapped>',
  raw_input: 'question',
  raw_output: 'answer',
  schema_family: 'test',
}]

function createRunner(
  calls: PersonalizationProgram[],
  capturedArgs?: Partial<Record<PersonalizationProgram, string[]>>,
): ProgramRunner {
  return async (program, args) => {
    calls.push(program)
    if (capturedArgs) capturedArgs[program] = [...args]
    const outputIndex = args.indexOf('--output')
    const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : undefined
    if (program === 'curated-aggregator' && outputPath) {
      fs.writeFileSync(outputPath, '[]')
    }
    if (program === 'mode-formatter' && outputPath) {
      fs.writeFileSync(outputPath, JSON.stringify(formattedSamples))
    }
    if (program === 'training-exporter' && outputPath) {
      fs.writeFileSync(outputPath, `${JSON.stringify({ input: schemaSamples[0]!.input, output: schemaSamples[0]!.output })}\n`)
    }
    return 0
  }
}

test('prepares one instruction dataset through the canonical stages', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-personalization-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const calls: PersonalizationProgram[] = []
  const primaryPath = path.join(root, 'work', 'dataset.jsonl')
  const archivePath = path.join(root, 'output', 'dataset.jsonl')

  const result = await preparePersonalizationDataset({
    actor: 'test',
    baseModel: 'test-model',
    datasetPaths: [primaryPath, archivePath],
    format: 'instruction',
    logPrefix: 'test',
    maxSamples: 12,
    modeFilter: 'dual',
    outputRoot: path.join(root, 'stages'),
    username: 'test-user',
  }, {
    applySchema: () => schemaSamples,
    runProgram: createRunner(calls),
  })

  assert.deepEqual(calls, ['organizer', 'curator', 'curated-aggregator', 'mode-formatter'])
  assert.equal(result.sampleCount, 1)
  assert.equal(fs.readFileSync(primaryPath, 'utf8'), fs.readFileSync(archivePath, 'utf8'))
  assert.deepEqual(JSON.parse(fs.readFileSync(primaryPath, 'utf8')), {
    instruction: '<wrapped>question</wrapped>',
    input: '',
    output: '<wrapped>answer</wrapped>',
  })
})

test('uses the validated exporter and can skip pre-curation', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-personalization-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const calls: PersonalizationProgram[] = []
  const datasetPath = path.join(root, 'dataset.jsonl')

  const result = await preparePersonalizationDataset({
    actor: 'test',
    baseModel: 'test-model',
    datasetPaths: [datasetPath],
    format: 'input-output',
    logPrefix: 'test',
    outputRoot: path.join(root, 'stages'),
    skipPreprocessing: true,
    username: 'test-user',
  }, {
    applySchema: () => schemaSamples,
    runProgram: createRunner(calls),
  })

  assert.deepEqual(calls, ['curated-aggregator', 'mode-formatter', 'training-exporter'])
  assert.equal(result.sampleCount, 1)
})

test('passes rolling-window controls to the canonical curated aggregator', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-personalization-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const calls: PersonalizationProgram[] = []
  const capturedArgs: Partial<Record<PersonalizationProgram, string[]>> = {}

  await preparePersonalizationDataset({
    actor: 'test',
    baseModel: 'test-model',
    datasetPaths: [path.join(root, 'dataset.jsonl')],
    format: 'instruction',
    logPrefix: 'test',
    olderSamples: 777,
    outputRoot: path.join(root, 'stages'),
    recentDays: 45,
    skipPreprocessing: true,
    username: 'test-user',
  }, {
    applySchema: () => schemaSamples,
    runProgram: createRunner(calls, capturedArgs),
  })

  assert.deepEqual(capturedArgs['curated-aggregator']?.slice(-4), [
    '--days-recent', '45', '--old-samples', '777',
  ])
})

test('stops immediately when a canonical preparation stage fails', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-personalization-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const calls: PersonalizationProgram[] = []

  await assert.rejects(
    preparePersonalizationDataset({
      actor: 'test',
      baseModel: 'test-model',
      datasetPaths: [path.join(root, 'dataset.jsonl')],
      format: 'instruction',
      logPrefix: 'test',
      outputRoot: path.join(root, 'stages'),
      username: 'test-user',
    }, {
      applySchema: () => schemaSamples,
      runProgram: async program => {
        calls.push(program)
        return 7
      },
    }),
    /organizer failed with exit code 7/,
  )
  assert.deepEqual(calls, ['organizer'])
})

test('stops after Organizer when Curator fails', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-personalization-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const calls: PersonalizationProgram[] = []

  await assert.rejects(
    preparePersonalizationDataset({
      actor: 'test',
      baseModel: 'test-model',
      datasetPaths: [path.join(root, 'dataset.jsonl')],
      format: 'instruction',
      logPrefix: 'test',
      outputRoot: path.join(root, 'stages'),
      username: 'test-user',
    }, {
      applySchema: () => schemaSamples,
      runProgram: async program => {
        calls.push(program)
        return program === 'curator' ? 7 : 0
      },
    }),
    /curator failed with exit code 7/,
  )
  assert.deepEqual(calls, ['organizer', 'curator'])
})

test('rejects invalid positive integer limits', () => {
  assert.equal(parsePositiveInteger('12', 'limit'), 12)
  assert.throws(() => parsePositiveInteger('0', 'limit'), /positive integer/)
  assert.throws(() => parsePositiveInteger('2.5', 'limit'), /positive integer/)
})

test('rejects unsupported cognitive mode filters', () => {
  assert.equal(parseCognitiveMode('dual', 'mode'), 'dual')
  assert.equal(parseCognitiveMode('environment', 'mode'), 'environment')
  assert.throws(() => parseCognitiveMode('all', 'mode'), /dual, emulation, agent, or environment/)
})
