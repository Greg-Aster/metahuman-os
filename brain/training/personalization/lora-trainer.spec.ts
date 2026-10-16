import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { mock } from 'node:test'
import * as core from '@metahuman/core'
import * as providers from '@metahuman/core/providers'

let transport: (...args: any[]) => Promise<any>
let cleanup: (...args: any[]) => Promise<any>
mock.module('@metahuman/core', { namedExports: { ...core,
  loadRunpodConfig: () => ({ apiKey: 'test-key', templateId: 'test-template', gpuType: 'NVIDIA RTX A6000' }) } })
mock.module('@metahuman/core/providers', { namedExports: { ...providers,
  callRunpodGraphQL: (...args: any[]) => transport(...args), terminateTrainingPod: (...args: any[]) => cleanup(...args) } })
const { specialistRemoteBudget, specialistRemoteReceipt, runRemoteTraining } = await import('./lora-trainer.js')
const job = { specialist: 'task' as const, gpuType: 'NVIDIA RTX A6000', volumeInGb: 20, containerDiskInGb: 40,
  maxHourlyCost: .65, maxTotalCost: 1.30 }
const hash = 'a'.repeat(64)
const receipt = () => ({ version: 1, status: 'candidate', baseModel: 'test-base', configSha256: hash,
  trainingSamples: 2, datasetId: null, evaluationPolicy: 'development', evaluationSamples: 0,
  qualityGate: 'external-evaluation-required', activation: 'not-activated', servingValidation: 'required',
  supervision: 'final-assistant-only', supervisedTokens: 44, templateSha256: hash,
  artifacts: { 'adapter_model.safetensors': hash, 'adapter_config.json': hash, 'tokenizer_config.json': hash } })

test('specialist receipt accepts only matching unqualified fits with complete artifact identities', () => {
  const expected = { baseModel: 'test-base', configSha256: hash, samples: 2 }
  assert.deepEqual(specialistRemoteReceipt(receipt(), expected), receipt())
  for (const patch of [{ trainingSamples: 3 }, { configSha256: 'b'.repeat(64) }, { evaluationSamples: 1 },
    { activation: 'activated' }, { qualityGate: 'passed' }, { supervisedTokens: 0 }, { artifacts: {} }]) {
    assert.throws(() => specialistRemoteReceipt({ ...receipt(), ...patch }, expected))
  }
  assert.throws(() => specialistRemoteReceipt({ ...receipt(), artifacts: { ...receipt().artifacts, '../outside': hash } }, expected), /inventory/)
})

test('allocated price includes both disks and reserves existing termination time inside the total budget', () => {
  const budget = specialistRemoteBudget(.59, job, 1000)
  assert.equal(budget.hourly, .59 + 60 * .10 / 720)
  assert.equal(budget.deadline, 1000 + 7_200_000 - 90_000)
  assert.throws(() => specialistRemoteBudget(.65, job, 1000), /hourly budget/)
  assert.throws(() => specialistRemoteBudget(NaN, job, 1000), /unavailable/)
  assert.throws(() => specialistRemoteBudget(.33, { ...job, maxTotalCost: 0 }, 1000), /Invalid/)
})

function options(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specialist-remote-'))
  const previous = process.env.RUNPOD_SSH_KEY_PATH
  process.env.RUNPOD_SSH_KEY_PATH = path.join(root, 'test-key')
  fs.writeFileSync(process.env.RUNPOD_SSH_KEY_PATH, 'test-private-key')
  fs.writeFileSync(process.env.RUNPOD_SSH_KEY_PATH + '.pub', 'ssh-ed25519 dGVzdA== test')
  fs.writeFileSync(path.join(root, 'train.jsonl'), '{}\n{}\n')
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ base_model: 'test-base', require_exact_messages: true, specialist: 'task' }))
  fs.writeFileSync(path.join(root, 'provenance.json'), JSON.stringify({ baseModel: 'test-base', owner: 'environment-action-selector',
    specialist: 'task', mode: 'reused-development-settings-training', priorHeldOutUsed: false, trainingRecords: 2 }))
  t.after(() => {
    if (previous === undefined) delete process.env.RUNPOD_SSH_KEY_PATH
    else process.env.RUNPOD_SSH_KEY_PATH = previous
    fs.rmSync(root, { recursive: true, force: true })
  })
  return { DATE_STR: '2026-01-01', RUN_LABEL: 'test-specialist', WORK_LOCAL: root, OUT_ROOT: root,
    FINAL_ADAPTER_DIR: path.join(root, 'candidate'), RAW_DATA_FILE: path.join(root, 'train.jsonl'), CLEAN_DATA_FILE: path.join(root, 'train.jsonl'),
    EVAL_DATA_FILE: '', DATASET_MANIFEST_FILE: path.join(root, 'provenance.json'), CONFIG_FILE: path.join(root, 'config.json'),
    SUMMARY_FILE: path.join(root, 'summary.json'), samples_used: 2, username: 'synthetic-test', specialistJob: job }
}

test('unapproved price triggers cleanup of only the newly allocated pod before SSH or training', async t => {
  const opts = options(t)
  const calls: string[] = []
  transport = async (_key, query, vars) => {
    calls.push(query)
    if (query.includes('CreateTrainingPod')) {
      assert.equal(vars.input.gpuTypeId, job.gpuType)
      assert.equal(vars.input.volumeInGb, 20)
      assert.equal(vars.input.containerDiskInGb, 40)
      assert.equal(vars.input.volumeMountPath, '/workspace/data', 'Job data must not hide the image training environment under /workspace')
      return { podFindAndDeployOnDemand: { id: 'new-pod-only' } }
    }
    assert.ok(query.includes('SpecialistPodPrice'))
    return { pod: { costPerHr: .80 } }
  }
  cleanup = async (_key, identity) => {
    assert.deepEqual(identity, { podId: 'new-pod-only', podName: 'metahuman-training-synthetic-test-test-specialist' })
    return { podId: 'new-pod-only', confirmedAt: '2026-01-01T00:00:00Z' }
  }
  const result = await runRemoteTraining(opts)
  assert.equal(result.training_success, false)
  assert.equal(result.terminated, true)
  assert.match(result.error!, /hourly budget/)
  assert.equal(calls.length, 2)
  assert.equal(fs.readdirSync(opts.FINAL_ADAPTER_DIR).length, 0)
})

test('uncertain creation and failed cleanup preserve the exact recovery identity and report failure', async t => {
  const opts = options(t)
  transport = async () => { throw new Error('create response lost') }
  cleanup = async (_key, identity) => {
    assert.equal(identity.podId, null)
    assert.equal(identity.podName, 'metahuman-training-synthetic-test-test-specialist')
    throw new Error('provider cleanup unavailable')
  }
  const result = await runRemoteTraining(opts)
  assert.equal(result.terminated, false)
  assert.equal(result.training_success, false)
  assert.match(result.termination_error!, /cleanup unavailable/)
  assert.equal(JSON.parse(fs.readFileSync(opts.SUMMARY_FILE, 'utf8')).podName, result.podName)
})

test('specialist transport rejects held-out data and incorrect provenance before allocation', async t => {
  const opts = options(t)
  transport = async () => { throw new Error('must not allocate') }
  await assert.rejects(runRemoteTraining({ ...opts, EVAL_DATA_FILE: opts.CLEAN_DATA_FILE }), /development-only/)
  fs.writeFileSync(opts.DATASET_MANIFEST_FILE, JSON.stringify({ baseModel: 'test-base', owner: 'environment-action-selector',
    specialist: 'task', mode: 'reused-development-settings-training', priorHeldOutUsed: true, trainingRecords: 2 }))
  await assert.rejects(runRemoteTraining(opts), /development-only/)
})
