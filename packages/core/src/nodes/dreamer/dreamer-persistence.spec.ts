import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { setAuditEnabled } from '../../audit.js'
import { loadBufferForUser } from '../../conversation-buffer.js'
import { registerProfileStorageConfigGetter, systemPaths } from '../../path-builder.js'
import { withUserContext } from '../../context.js'
import { InnerDialogueSaverNode } from '../cognitive/inner-dialogue-saver.node.js'
import { InnerDialogueBufferNode } from '../output/inner-dialogue-buffer.node.js'
import { DreamerDreamSaverNode } from './dreamer-dream-saver.node.js'

function jsonFiles(root: string): string[] {
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(root, entry.name)
    if (entry.isDirectory()) return jsonFiles(target)
    return entry.isFile() && entry.name.endsWith('.json') ? [target] : []
  })
}

test('one saver and one buffer owner persist an ordered dream sequence idempotently', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-dreamer-persistence-'))
  const username = `dreamer-persistence-${Date.now()}`
  const originalRunPath = systemPaths.run
  const originalFetch = globalThis.fetch
  registerProfileStorageConfigGetter(candidate => candidate === username
    ? { path: root, type: 'internal' }
    : undefined)
  systemPaths.run = path.join(root, 'run')
  fs.mkdirSync(path.join(root, 'etc'), { recursive: true })
  fs.copyFileSync(
    path.join(systemPaths.root, 'etc', 'chat-settings.json'),
    path.join(root, 'etc', 'chat-settings.json'),
  )
  setAuditEnabled(false)
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ task: { id: 'dreamer-index-test' } }),
  }) as Response

  try {
    await withUserContext({ userId: username, username, role: 'owner' }, async () => {
      const saver = await DreamerDreamSaverNode.execute!({
        dreamData: 'The first bounded dream crosses a silver bridge.',
        thinkingData: 'The bridge may represent a transition.',
        continuationsData: [{
          dream: 'The bridge folds into a paper bird.',
          thinking: 'The image is becoming lighter.',
          index: 1,
        }],
        sourceIds: ['source-memory-1', 'source-memory-1'],
      }, { userId: username, username }, { type: 'dream' })

      assert.equal(saver.saved, true)
      assert.equal(saver.savedCount, 2)
      assert.equal(saver.sourceCount, 1)
      assert.deepEqual(saver.bufferEntries.map((entry: any) => entry.role), [
        'reasoning',
        'dream',
        'reasoning',
        'dream',
      ])

      const context = {
        userId: username,
        username,
        allowMemoryWrites: false,
      }
      const inputs = { entries: saver.bufferEntries, passthrough: saver.dream }
      const firstAdmission = await InnerDialogueBufferNode.execute!(inputs, context, {})
      assert.equal(firstAdmission.saved, true)
      assert.equal(firstAdmission.savedCount, 4)
      assert.deepEqual(firstAdmission.roleCounts, { reasoning: 2, dream: 2 })
      assert.equal(firstAdmission.passthrough, saver.dream)
      const firstReasoningSave = await InnerDialogueSaverNode.execute!(
        { entries: firstAdmission.entries },
        { userId: username, username, recordPersonaMemory: true },
        { roles: ['reasoning'] },
      )
      assert.equal(firstReasoningSave.saved, true)
      assert.equal(firstReasoningSave.savedCount, 2)

      const replayAdmission = await InnerDialogueBufferNode.execute!(inputs, context, {})
      assert.equal(replayAdmission.saved, true)
      const replayReasoningSave = await InnerDialogueSaverNode.execute!(
        { entries: replayAdmission.entries },
        { userId: username, username, recordPersonaMemory: true },
        { roles: ['reasoning'] },
      )
      assert.equal(replayReasoningSave.saved, true)
      assert.equal(replayReasoningSave.savedCount, 2)
      assert.equal(replayReasoningSave.results.every((result: any) => result.deduplicated === true), true)
      assert.equal(loadBufferForUser(username, 'inner').messages.length, 4)

      const events = jsonFiles(path.join(root, 'memory', 'episodic'))
        .map(file => JSON.parse(fs.readFileSync(file, 'utf8')))
        .sort((left, right) => Number(Boolean(left.metadata?.continuation)) - Number(Boolean(right.metadata?.continuation)))
      assert.equal(events.length, 4)
      const dreams = events.filter(event => event.type === 'dream')
      const reasoning = events.filter(event => event.type === 'inner_dialogue')
      assert.equal(dreams.length, 2)
      assert.equal(reasoning.length, 2)
      assert.equal(reasoning.every(event => event.metadata?.role === 'reasoning'), true)
      assert.deepEqual(dreams[0].metadata.sources, ['source-memory-1'])
      assert.equal(dreams[1].metadata.continuation, true)
      assert.equal(dreams[1].metadata.continuationIndex, 1)
      assert.deepEqual(dreams[1].metadata.sources, ['source-memory-1'])
    })
  } finally {
    globalThis.fetch = originalFetch
    systemPaths.run = originalRunPath
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('coordinator retry identity replays the first durable daydream exactly', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-daydreamer-retry-'))
  const username = `daydreamer-retry-${Date.now()}`
  const originalRunPath = systemPaths.run
  const originalFetch = globalThis.fetch
  registerProfileStorageConfigGetter(candidate => candidate === username
    ? { path: root, type: 'internal' }
    : undefined)
  systemPaths.run = path.join(root, 'run')
  fs.mkdirSync(path.join(root, 'etc'), { recursive: true })
  fs.copyFileSync(
    path.join(systemPaths.root, 'etc', 'chat-settings.json'),
    path.join(root, 'etc', 'chat-settings.json'),
  )
  setAuditEnabled(false)
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ task: { id: 'daydreamer-retry-index-test' } }),
  }) as Response

  const context = {
    userId: username,
    username,
    allowMemoryWrites: true,
    idempotencyKey: `daydreamer:${username}:task-stable`,
    memoryTimestamp: '2026-09-02T12:34:56.000Z',
  }

  try {
    await withUserContext({ userId: username, username, role: 'owner' }, async () => {
      const first = await DreamerDreamSaverNode.execute!({
        dreamData: 'The first durable daydream watches clouds gather into a quiet library.',
        sourceIds: ['source-first'],
      }, context, { type: 'daydream' })
      const retry = await DreamerDreamSaverNode.execute!({
        dreamData: 'A regenerated retry produced different words that must not replace the first result.',
        sourceIds: ['source-retry'],
      }, context, { type: 'daydream' })

      assert.equal(first.saved, true)
      assert.equal(retry.saved, true)
      assert.equal(retry.deduplicated, true)
      assert.equal(retry.eventId, first.eventId)
      assert.equal(retry.dream, first.dream)
      assert.deepEqual(retry.dreams, first.dreams)
      assert.equal(retry.sourceCount, 1)
      assert.equal(retry.bufferEntries[0].content, first.dream)
      assert.equal(retry.bufferEntries[0].meta.idempotencyKey, first.bufferEntries[0].meta.idempotencyKey)

      const firstAdmission = await InnerDialogueBufferNode.execute!({
        entries: first.bufferEntries,
        passthrough: first.dream,
      }, context, {})
      const retryAdmission = await InnerDialogueBufferNode.execute!({
        entries: retry.bufferEntries,
        passthrough: retry.dream,
      }, context, {})
      assert.equal(firstAdmission.text, first.dream)
      assert.equal(retryAdmission.text, first.dream)
      assert.equal(loadBufferForUser(username, 'inner').messages.length, 1)

      const events = jsonFiles(path.join(root, 'memory', 'episodic'))
        .map(file => JSON.parse(fs.readFileSync(file, 'utf8')))
        .filter(event => event.type === 'daydream')
      assert.equal(events.length, 1)
      assert.equal(events[0].content, first.dream)
      assert.deepEqual(events[0].metadata.sources, ['source-first'])
    })
  } finally {
    globalThis.fetch = originalFetch
    systemPaths.run = originalRunPath
    fs.rmSync(root, { recursive: true, force: true })
  }
})
