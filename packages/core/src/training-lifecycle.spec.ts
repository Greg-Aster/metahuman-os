import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-training-lifecycle-'))
process.env.METAHUMAN_ROOT = root
const { readTrainingLogForUser, readTrainingOperations, listUnconfirmedTrainingCleanup, recoverTrainingCleanup } = await import('./training-process.js')
const { launchTrainingJob } = await import('./training-launch.js')
const { handleGetTrainingLogFile } = await import('./api/handlers/training-log-file.js')
const { handleGetTrainingConsoleLogs } = await import('./api/handlers/training-console-logs.js')
after(() => fs.rmSync(root, { recursive: true, force: true }))

test('console and monitor resolve the profile and require terminal evidence', async () => {
  const logs = path.join(root, 'logs/run')
  fs.mkdirSync(logs, { recursive: true })
  const names: Record<string, string> = {}
  for (const [index, username] of ['alice', 'bob'].entries()) {
    const label = '2026-09-09T01-00-0' + index + '-000Z'
    const name = 'full-cycle-local-' + label + '.log'
    names[username] = name
    fs.writeFileSync(path.join(logs, name), username + ' synthetic output\n[training-lifecycle] ' + JSON.stringify({
      username, runLabel: label, status: 'failed', endedAt: '2026-09-09T01:01:00Z', error: 'Synthetic failed run',
    }) + '\n')
  }
  assert.equal(readTrainingLogForUser('alice')?.fileName, names.alice)
  assert.throws(() => readTrainingLogForUser('alice', names.bob), /not owned/)
  assert.throws(() => readTrainingLogForUser('alice', '../' + names.alice), /not owned/)
  assert.equal(readTrainingLogForUser('empty'), null)
  const operations = readTrainingOperations('alice')
  assert.equal(operations.length, 1)
  assert.equal(operations[0].overallStatus, 'failed')
  assert.equal(operations[0].metadata?.username, 'alice')
  assert.equal(operations[0].overallProgress, 0)
  const user = { username: 'alice', isAuthenticated: true }
  assert.equal((await handleGetTrainingLogFile({ user, query: { file: names.bob } } as any)).status, 400)
  assert.equal((await handleGetTrainingConsoleLogs({ user, query: { maxLines: '0' } } as any)).status, 400)
  assert.equal((await handleGetTrainingConsoleLogs({ user: { isAuthenticated: false } } as any)).status, 401)
})

test('unconfirmed remote cleanup survives restart, blocks admission and is explicitly recoverable', async t => {
  const username = 'cleanup-owner'
  const label = '2026-09-09T02-00-00-000Z'
  const pod = { id: 'fixture-pod', name: 'metahuman-training-' + username + '-' + label }
  const work = path.join(root, 'metahuman-runs', username, label.slice(0, 10), label)
  const etc = path.join(root, 'profiles', username, 'etc')
  fs.mkdirSync(work, { recursive: true })
  fs.mkdirSync(etc, { recursive: true })
  fs.writeFileSync(path.join(etc, 'runpod.json'), JSON.stringify({ apiKey: 'fixture-key', templateId: 'fixture', gpuType: 'fixture' }))
  const file = path.join(work, 'run-summary.json')
  fs.writeFileSync(file, JSON.stringify({ username, runLabel: label, podName: pod.name, pod_id: pod.id,
    creationRequestedAt: '2026-09-09T02:00:00Z', terminated: false, termination_error: 'Fixture network interruption' }))
  assert.equal(listUnconfirmedTrainingCleanup().length, 1)
  assert.deepEqual(listUnconfirmedTrainingCleanup('another-owner'), [])
  await assert.rejects(recoverTrainingCleanup('another-owner', label), /No unconfirmed/)
  const request = { method: 'local-lora' as const, trainingTarget: 'vllm' as const, trainingConfig: {
    base_model: 'fixture/model', num_train_epochs: 1, max_samples: 20, lora_rank: 16, lora_alpha: 32,
    learning_rate: 0.0001, per_device_train_batch_size: 1, gradient_accumulation_steps: 4, max_seq_length: 2048, quantization: 'Q8_0',
  } }
  const blocked = launchTrainingJob(username, request)
  assert.equal(blocked.status, 409)
  const responses = [{ pod }, { podTerminate: null }, { pod: null }]
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: responses.shift() }))
  const recovered = await recoverTrainingCleanup(username, label)
  assert.ok(Number.isFinite(Date.parse(recovered.confirmedAt)))
  assert.deepEqual(listUnconfirmedTrainingCleanup(), [])
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(saved.terminated, true)
  assert.equal(saved.pod_id, pod.id)
  assert.equal(launchTrainingJob(username, request).status, 500) // Fixture deliberately has no runnable worker.
})
