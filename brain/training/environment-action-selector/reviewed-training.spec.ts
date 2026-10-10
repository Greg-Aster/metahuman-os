import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'environment-reviewed-training-'))
process.env.METAHUMAN_ROOT = root
after(() => fs.rmSync(root, { recursive: true, force: true }))

const { createUser } = await import('@metahuman/core')
const {
  recordEnvironmentTrainingOutput, reviewEnvironmentTrainingCandidate,
  exportReviewedEnvironmentTraining,
} = await import('../../../packages/core/src/environment-training-bank.js')
const { DEVELOPMENT_CASES, EVALUATION_CASES, buildDevelopmentRecords } = await import('./generate-training-data.js')
const { main } = await import('./train.js')

test('reviewed-data training checks the human review and excludes frozen evaluation sources', async () => {
  const username = 'reviewed-training-fixture'
  createUser(username, 'fixture-only-password', 'owner')
  const source = DEVELOPMENT_CASES.find(item => item.specialist === 'intent')!
  const [example] = await buildDevelopmentRecords([source])
  const input = {
    username, executionId: 'runtime-training-fixture', occurrenceId: 'first',
    nodeId: 'intent-orchestrator', graphHash: 'graph-test', specialist: 'intent' as const,
    messages: [{ role: 'system', content: example.system }, { role: 'user', content: example.user }],
    observedOutput: example.output,
  }
  const candidate = recordEnvironmentTrainingOutput(input)
  reviewEnvironmentTrainingCandidate(username, {
    candidateId: candidate.id, decision: 'accept', reason: 'Approved fixture output.',
  })
  const file = path.join(exportReviewedEnvironmentTraining(username).directory, 'intent.jsonl')
  await main(['--specialist', 'intent', '--reviewed-data', file, '--dry-run'])

  const tampered = JSON.parse(fs.readFileSync(file, 'utf8').trim())
  tampered.output = '{"needsAction":false}'
  fs.writeFileSync(file, `${JSON.stringify(tampered)}\n`)
  await assert.rejects(main(['--specialist', 'intent', '--reviewed-data', file, '--dry-run']),
    /does not match its saved candidate and human review/)

  const frozen = recordEnvironmentTrainingOutput({ ...input,
    executionId: EVALUATION_CASES[0].id, occurrenceId: 'second' })
  reviewEnvironmentTrainingCandidate(username, {
    candidateId: frozen.id, decision: 'accept', reason: 'Approved fixture output.',
  })
  exportReviewedEnvironmentTraining(username)
  await assert.rejects(main(['--specialist', 'intent', '--reviewed-data', file, '--dry-run']),
    /frozen evaluation source/)
})
