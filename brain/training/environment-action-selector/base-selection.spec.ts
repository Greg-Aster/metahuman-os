import assert from 'node:assert/strict'
import { after, test, mock } from 'node:test'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { REPOSITORY_ROOT, sha256 } from './corpus.js'
const childProcess = await import('node:child_process')
mock.module('node:child_process', { namedExports: { ...childProcess, spawn: () => {
  const child = new EventEmitter()
  process.nextTick(() => child.emit('exit', 0))
  return child
} } })
const { main: train } = await import('./train.js')
import { main as exportAdapter } from './export-merged.js'

const directory = await mkdtemp(resolve(REPOSITORY_ROOT, 'out/environment-action-selector/training/base-contract-test-'))
after(() => rm(directory, { recursive: true, force: true }))
const save = (name: string, value: unknown) => writeFile(name, JSON.stringify(value))

test('2B recipe transfer keeps archived base evidence and measures complete data anew', async () => {
  const source = resolve(directory, 'source')
  await mkdir(source)
  const report = { owner: 'environment-action-selector', specialist: 'intent', split: 'development-cross-validation', priorHeldOutUsed: false, checkpointPolicy: 'epoch-1' }
  const reportPath = resolve(directory, 'selection.json')
  await save(reportPath, report)
  const config = { owner: 'environment-action-selector', specialist: 'intent', base_model: 'unsloth/Qwen3.5-0.8B', require_exact_messages: true, train_on_responses_only: true, num_train_epochs: 1, max_seq_length: 1234, base_model_revision: 'source-base-commit' }
  await save(resolve(source, 'training-config.json'), config)
  await save(resolve(source, 'run-provenance.json'), { owner: config.owner, specialist: 'intent', mode: 'final-development-training', baseModel: config.base_model,
    epochs: 1, archivedDatasetDigest: 'fixture-development-digest', priorHeldOutUsed: false,
    selectionEvidence: { path: relative(REPOSITORY_ROOT, reportPath), digest: sha256(report) } })
  const lines: string[] = []
  const original = console.log
  console.log = (...args) => { lines.push(args.join(' ')) }
  try { await train(['--specialist', 'intent', '--base-model', 'unsloth/Qwen3.5-2B', '--reuse-settings-from', source, '--output', resolve(directory, 'target')]) }
  finally { console.log = original }
  assert.ok(lines.some(line => line.includes('source base: unsloth/Qwen3.5-0.8B; fit target base: unsloth/Qwen3.5-2B')))
  assert.deepEqual(JSON.parse(await readFile(resolve(source, 'training-config.json'), 'utf8')), config)
  const targetConfig = JSON.parse(await readFile(resolve(directory, 'target/final/training-config.json'), 'utf8'))
  const { max_seq_length: _oldCapacity, base_model_revision: _sourceRevision, ...expectedRecipe } = config
  assert.deepEqual(targetConfig, { ...expectedRecipe, base_model: 'unsloth/Qwen3.5-2B' })
  const targetProvenance = JSON.parse(await readFile(resolve(directory, 'target/final/run-provenance.json'), 'utf8'))
  assert.equal(targetProvenance.baseModel, 'unsloth/Qwen3.5-2B')
  assert.equal(targetProvenance.settingsSource.baseModel, 'unsloth/Qwen3.5-0.8B')
  assert.equal(targetProvenance.settingsSource.selectionEvidence.digest, sha256(report))
  await train(['--specialist', 'intent', '--reuse-settings-from', source, '--output', resolve(directory, 'same-base')])
  const sameBase = JSON.parse(await readFile(resolve(directory, 'same-base/final/training-config.json'), 'utf8'))
  assert.equal(sameBase.base_model_revision, config.base_model_revision)
  assert.equal(sameBase.base_model, config.base_model)
  await assert.rejects(train(['--base-model', 'unsupported']), /Unknown or incomplete argument/)
})

for (const base of ['unsloth/Qwen3.5-0.8B', 'unsloth/Qwen3.5-2B']) {
  for (const stage of ['reviewed', 'final']) test(`adapter-only export accepts recorded ${base} ${stage} through existing owner`, async () => {
    const root = resolve(directory, base.endsWith('2B') ? 'two' : 'small', stage)
    const folder = resolve(root, stage)
    await mkdir(folder, { recursive: true })
    await save(resolve(folder, 'training-config.json'), { base_model: base })
    await save(resolve(folder, 'run-provenance.json'), { owner: 'environment-action-selector', specialist: 'intent', baseModel: base, priorHeldOutUsed: false,
      mode: stage === 'reviewed' ? 'reviewed-training' : 'reused-development-settings-training',
      ...(stage === 'reviewed' ? { reviewedDataDigest: 'reviewed-digest' } : { settingsSource: { baseModel: 'unsloth/Qwen3.5-0.8B', selectionEvidence: { digest: 'source-selection-digest' } } }) })
    const args = ['--root', root, '--lora-only', ...(stage === 'final' ? ['--stage', 'final'] : [])]
    // Missing weights stop before launching Python; reaching this read proves the
    // recorded base/stage passed the real export provenance boundary.
    await assert.rejects(exportAdapter(args), error => (error as NodeJS.ErrnoException).code === 'ENOENT' && String(error).includes('adapter_model.safetensors'))
    await save(resolve(folder, 'training-config.json'), { base_model: 'different-base' })
    await assert.rejects(exportAdapter(args), /provenance is invalid/)
  })
}
