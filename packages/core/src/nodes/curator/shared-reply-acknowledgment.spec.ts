import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { setAuditEnabled } from '../../audit.js'
import { registerProfileStorageConfigGetter } from '../../path-builder.js'
import { episodicSourceHash, readCapturedEpisodicEvent } from '../../memory.js'
import { UncuratedMemoryLoaderNode } from './uncurated-memory-loader.node.js'
import { sourceCurationStatus } from './curated-store.js'
import { inspectTrainingDataset } from '../../training-dataset.js'
import { assembleCuratorSources } from './source-assembler.js'
import { parseCuratorResponse } from './curator-llm.node.js'
import { saveCuratedResults } from './curated-memory-saver.node.js'
import { markCuratedResults } from './memory-marker.node.js'
import type { CuratorItemResult } from './contracts.js'

setAuditEnabled(false)

test('acknowledging a second genuine reply preserves the first pair and does not acknowledge an unmarked review', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'curator-shared-reply-'))
  const username = `curator-shared-reply-${process.pid}`
  const episodic = path.join(root, 'memory', 'episodic')
  fs.mkdirSync(episodic, { recursive: true })
  registerProfileStorageConfigGetter(candidate => candidate === username ? { path: root, type: 'internal' } : undefined)
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const records = [
    { id: 'user', content: 'Please look at the shelf.', metadata: { role: 'user', idempotencyKey: 'request:user' } },
    { id: 'reply-start', content: 'I will look at the shelf.', metadata: { role: 'assistant', idempotencyKey: 'start:assistant', inReplyTo: 'request:user' } },
    { id: 'reply-result', content: 'The returned image shows two books on the shelf.', metadata: { role: 'assistant', idempotencyKey: 'result:assistant', inReplyTo: 'request:user' } },
  ].map((record, index) => ({
    ...record, type: 'conversation', timestamp: new Date(Date.parse('2026-10-01T12:00:00Z') + index * 1000).toISOString(),
    metadata: { ...record.metadata, cognitiveMode: 'environment', sessionId: 'synthetic-shared-reply' },
    path: path.join(episodic, record.id + '.json'),
  }))
  for (const { path: file, ...record } of records) fs.writeFileSync(file, JSON.stringify(record))
  const assembly = assembleCuratorSources(records)
  assert.equal(assembly.memories.length, 2)
  const results: CuratorItemResult[] = assembly.memories.map(memory => ({
    success: true, disposition: 'accepted', memoryId: memory.id,
    originalMemoryPath: memory.path, originalMemoryPaths: memory.sourcePaths,
    curated: parseCuratorResponse(JSON.stringify({ conversationalEssence: 'A real linked reply', suitableForTraining: true }), memory, '2026-10-01T12:01:00Z'),
  }))
  const first = results.find(result => result.curated!.assistantResponse === records[1]!.content)!
  const second = results.find(result => result.curated!.assistantResponse === records[2]!.content)!
  assert.ok(first)
  assert.ok(second)
  const ids = () => inspectTrainingDataset(username).records.map(record => record.id).sort()
  saveCuratedResults([first], username)
  markCuratedResults([first], username)
  assert.deepEqual(ids(), [first.memoryId])
  // Retain compatibility with a genuinely saved legacy single-reference acknowledgment.
  const firstUser = readCapturedEpisodicEvent(username, records[0]!.path)
  const acknowledgment = (firstUser.metadata!.curatorReviews as any)[first.memoryId]
  const legacyMetadata = { ...firstUser.metadata, curatorReviews: undefined,
    curatorRecordId: first.memoryId, curatorRecordFile: acknowledgment.recordFile,
    curatorSourceHash: acknowledgment.sourceHash, curatorPolicyVersion: acknowledgment.policyVersion,
    curationStatus: acknowledgment.status,
  }
  fs.writeFileSync(records[0]!.path, JSON.stringify({ ...firstUser, metadata: legacyMetadata }))
  assert.equal(sourceCurationStatus(username, readCapturedEpisodicEvent(username, records[0]!.path)).current, true)
  assert.deepEqual(ids(), [first.memoryId])
  saveCuratedResults([second], username)
  assert.deepEqual(ids(), [first.memoryId], 'saved but unmarked second review must remain ineligible')
  markCuratedResults([second], username)
  assert.deepEqual(ids(), [first.memoryId, second.memoryId].sort(), 'both exact acknowledged pairs must remain current')
  assert.equal(markCuratedResults([first, second], username).alreadyMarkedCount, 2)
  const user = readCapturedEpisodicEvent(username, records[0]!.path)
  assert.equal(episodicSourceHash(user), episodicSourceHash(firstUser))
  assert.equal(Object.keys(user.metadata!.curatorReviews as object).length, 2)
  assert.equal((await UncuratedMemoryLoaderNode.execute({}, { userId: username }, {})).count, 0)
  fs.writeFileSync(records[0]!.path, JSON.stringify({ ...user, content: 'Changed user request' }))
  assert.deepEqual(ids(), [], 'a changed shared source invalidates both reviewed pairs')
  assert.equal((await UncuratedMemoryLoaderNode.execute({}, { userId: username }, {})).count, 2)
})
