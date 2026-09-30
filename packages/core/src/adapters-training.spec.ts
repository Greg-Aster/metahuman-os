import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parseTrainingCandidateResult, verifyTrainingCandidate } from './adapters.js'
import type { TrainingCandidateResult } from './training-schema.js'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const result: TrainingCandidateResult = {
  version: 1, status: 'candidate', datasetId: 'a'.repeat(64), baseModel: 'fixture/model',
  configSha256: hash('{}'), templateSha256: 'b'.repeat(64), trainingMode: 'lora',
  trainingSamples: 10, evaluationSamples: 2, supervisedTokens: 100,
  baselineLoss: 2, candidateLoss: 1, qualityGate: 'passed', evaluationPolicy: 'independent',
  supervision: 'final-assistant-only', servingValidation: 'required', activation: 'not-activated',
  artifacts: { 'adapter_model.safetensors': hash('weights'), 'tokenizer_config.json': hash('{}'), 'artifact-evaluation.json': 'c'.repeat(64) },
}

test('candidate receipt rejects failed, mismatched, unverifiable or unsafe artifacts', () => {
  assert.deepEqual(parseTrainingCandidateResult(result, result.datasetId, result.baseModel), result)
  for (const update of [
    { status: 'failed' }, { datasetId: 'wrong' }, { baseModel: 'different' }, { trainingSamples: 0 },
    { evaluationSamples: 0 }, { supervisedTokens: 0 }, { candidateLoss: NaN }, { qualityGate: 'failed' },
    { activation: 'active' }, { evaluationPolicy: 'development' }, { configSha256: 'missing' },
    { artifacts: { '../weights': 'c'.repeat(64) } }, { artifacts: {} },
  ]) assert.throws(() => parseTrainingCandidateResult({ ...result, ...update }, result.datasetId, result.baseModel))
  assert.equal(parseTrainingCandidateResult({ ...result, candidateLoss: 3, qualityGate: 'failed' }, result.datasetId, result.baseModel).qualityGate, 'failed')
})

test('candidate acceptance verifies saved weights, config, evaluation binding and requested output', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-candidate-'))
  try {
    const directory = path.join(root, 'candidate')
    fs.mkdirSync(directory)
    const configPath = path.join(root, 'config.json')
    fs.writeFileSync(configPath, '{}')
    fs.writeFileSync(path.join(directory, 'adapter_model.safetensors'), 'weights')
    fs.writeFileSync(path.join(directory, 'tokenizer_config.json'), '{}')
    const evaluatedArtifacts = { 'adapter_model.safetensors': hash('weights'), 'tokenizer_config.json': hash('{}') }
    const evaluation = { version: 1, loss: 1, count: 2, evaluationSha256: 'd'.repeat(64), artifacts: evaluatedArtifacts }
    const evaluationText = JSON.stringify(evaluation)
    fs.writeFileSync(path.join(directory, 'artifact-evaluation.json'), evaluationText)
    const receipt = { ...result, artifacts: { ...evaluatedArtifacts, 'artifact-evaluation.json': hash(evaluationText) } }
    fs.writeFileSync(path.join(directory, 'training-result.json'), JSON.stringify(receipt))
    const expected = { datasetId: result.datasetId, baseModel: result.baseModel, configPath, evaluationSha256: evaluation.evaluationSha256, requireGguf: false }
    assert.deepEqual(await verifyTrainingCandidate(directory, expected), receipt)
    await assert.rejects(verifyTrainingCandidate(directory, { ...expected, evaluationSha256: 'e'.repeat(64) }), /evaluation differs/)
    await assert.rejects(verifyTrainingCandidate(directory, { ...expected, requireGguf: true }), /GGUF/)
    fs.writeFileSync(configPath, '{"changed":true}')
    await assert.rejects(verifyTrainingCandidate(directory, expected), /configuration checksum/)
    fs.writeFileSync(configPath, '{}')
    fs.writeFileSync(path.join(directory, 'adapter_model.safetensors'), 'tampered')
    await assert.rejects(verifyTrainingCandidate(directory, expected), /checksum mismatch/)
    fs.unlinkSync(path.join(directory, 'adapter_model.safetensors'))
    const foreign = path.join(root, 'foreign.safetensors')
    fs.writeFileSync(foreign, 'weights')
    fs.symlinkSync(foreign, path.join(directory, 'adapter_model.safetensors'))
    await assert.rejects(verifyTrainingCandidate(directory, expected), /escapes/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
