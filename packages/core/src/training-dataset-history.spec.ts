import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { after, test } from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-dataset-history-'))
process.env.METAHUMAN_ROOT = root
const { readTrainingDatasetHistory } = await import('./training-dataset.js')
const { getProfilePaths } = await import('./path-builder.js')
const { eventBus } = await import('./infrastructure/event-bus/client.js')
eventBus.disconnect()
after(() => { eventBus.disconnect(); fs.rmSync(root, { recursive: true, force: true }) })

test('persisted exposure survives failed runs, completed novelty is profile scoped, and tampering fails closed', () => {
  const username = 'history-owner'
  const write = (name: string, status: string, split: 'train' | 'evaluation') => {
    const directory = path.join(getProfilePaths(username).out, 'adapters', '2026-09-09', name)
    fs.mkdirSync(directory, { recursive: true })
    const empty = () => ({ sourceIds: [], groups: [], contentHashes: [], sampleIds: [] })
    const snapshot = { version: 2, train: empty(), evaluation: empty(), [split]: {
      sourceIds: ['shared-source'], groups: ['shared-session'], contentHashes: ['shared-content'], sampleIds: [name],
    } }
    const file = path.join(directory, 'dataset-manifest.json')
    fs.writeFileSync(file, JSON.stringify({ ...snapshot, datasetId: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') }))
    fs.writeFileSync(path.join(directory, 'run.json'), JSON.stringify({ status }))
    return file
  }
  write('failed-run', 'failed', 'train')
  let history = readTrainingDatasetHistory(username)
  assert.equal(history.assignments['group:shared-session'], 'train')
  assert.deepEqual(history.completedSampleIds, [])
  const file = write('completed-run', 'candidate', 'train')
  history = readTrainingDatasetHistory(username)
  assert.deepEqual(history.completedSampleIds, ['completed-run'])
  assert.deepEqual(readTrainingDatasetHistory('another-owner'), { assignments: {}, completedSampleIds: [] })
  write('conflicting-run', 'failed', 'evaluation')
  history = readTrainingDatasetHistory(username)
  assert.equal(history.assignments['source:shared-source'], 'conflict')
  assert.equal(history.assignments['content:shared-content'], 'conflict')
  const valid = fs.readFileSync(file, 'utf8')
  fs.writeFileSync(file, valid.replace('shared-source', 'changed-source'))
  assert.throws(() => readTrainingDatasetHistory(username), /invalid manifest/)
  fs.unlinkSync(file)
  const redirected = path.join(root, 'redirected.json')
  fs.writeFileSync(redirected, valid)
  fs.symlinkSync(redirected, file)
  assert.throws(() => readTrainingDatasetHistory(username), /redirected manifest/)
})
