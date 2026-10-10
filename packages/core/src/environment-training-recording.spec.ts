import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'environment-training-recording-'))
process.env.METAHUMAN_ROOT = root
after(() => fs.rmSync(root, { recursive: true, force: true }))

const {
  recordEnvironmentTrainingOutput, readEnvironmentTrainingBank,
  saveEnvironmentTrainingProposal, readEnvironmentTrainingProposal,
  reviewEnvironmentTrainingCandidate, exportReviewedEnvironmentTraining,
} = await import('./environment-training-bank.js')

test('exact task output is recorded once, proposed separately, and exported only after review', () => {
  const input = {
    username: 'training-recording-test', executionId: 'execution-test', occurrenceId: 'occurrence-test',
    nodeId: 'task-model', graphHash: 'graph-test', specialist: 'task' as const,
    messages: [{ role: 'system', content: 'task prompt' },
      { role: 'user', content: '{"currentInstruction":"Plan the action."}' }],
    observedOutput: '{"delegatePlanning":true}',
  }
  const saved = recordEnvironmentTrainingOutput(input)
  assert.equal(recordEnvironmentTrainingOutput(input).id, saved.id)
  assert.equal(readEnvironmentTrainingBank(input.username).candidates.length, 1)
  assert.equal(exportReviewedEnvironmentTraining(input.username).counts.task, 0)
  saveEnvironmentTrainingProposal(input.username, 'decision', {
    candidateId: saved.id, sourceDigest: saved.sourceDigest,
    verdict: 'correct', reason: 'The output matches the request.',
  })
  assert.equal(readEnvironmentTrainingProposal(input.username, 'decision', saved.id)?.verdict, 'correct')
  assert.equal(exportReviewedEnvironmentTraining(input.username).counts.task, 0)
  reviewEnvironmentTrainingCandidate(input.username, {
    candidateId: saved.id, decision: 'accept', reason: 'Approved after review.',
  })
  const exported = exportReviewedEnvironmentTraining(input.username)
  assert.equal(exported.counts.task, 1)
  const [record] = fs.readFileSync(path.join(exported.directory, 'task.jsonl'), 'utf8').trim().split('\n')
    .map(line => JSON.parse(line))
  assert.equal(record.output, input.observedOutput)
  assert.equal(record.metadata.recordId, saved.id)
})
