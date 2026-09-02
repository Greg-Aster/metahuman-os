import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { setAuditEnabled } from './audit.js'
import { withUserContext } from './context.js'
import { captureEventWithDetails } from './memory.js'
import { registerProfileStorageConfigGetter } from './path-builder.js'

setAuditEnabled(false)

test('captureEventWithDetails persists producer idempotency across repeated calls', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-memory-idempotency-'))
  const username = `memory-idempotency-${process.pid}`
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  registerProfileStorageConfigGetter(candidate => candidate === username
    ? { path: root, type: 'internal' }
    : undefined)

  const first = await withUserContext(
    { userId: 'user-idempotency', username, role: 'owner' },
    () => captureEventWithDetails('Stable imported content', {
      type: 'observation',
      timestamp: '2026-08-27T10:00:00.000Z',
      idempotencyKey: 'ingestor:stable-test-key',
      tags: ['ingested', 'inbox'],
      metadata: { cognitiveMode: 'emulation' },
    }),
  )
  const second = await withUserContext(
    { userId: 'user-idempotency', username, role: 'owner' },
    () => captureEventWithDetails('Stable imported content', {
      type: 'observation',
      timestamp: '2026-08-27T10:00:00.000Z',
      idempotencyKey: 'ingestor:stable-test-key',
      tags: ['ingested', 'inbox'],
      metadata: { cognitiveMode: 'emulation' },
    }),
  )

  assert.equal(first.deduplicated, undefined)
  assert.equal(second.deduplicated, true)
  assert.equal(second.eventId, first.eventId)
  assert.equal(second.filePath, first.filePath)
  assert.equal(fs.existsSync(first.filePath), true)
  assert.match(first.eventId, /^evt-idempotent-[a-f0-9]{24}$/)

  const changedContent = await withUserContext(
    { userId: 'user-idempotency', username, role: 'owner' },
    () => captureEventWithDetails('Changed content cannot replace the stable capture', {
      type: 'observation',
      timestamp: '2026-08-27T10:00:00.000Z',
      idempotencyKey: 'ingestor:stable-test-key',
      metadata: { cognitiveMode: 'emulation' },
    }),
  )
  assert.equal(changedContent.deduplicated, true)
  assert.equal(changedContent.eventId, first.eventId)
  assert.equal(changedContent.filePath, first.filePath)
})

test('idempotent memory capture rejects unstable identity inputs', () => {
  assert.throws(
    () => captureEventWithDetails('content', { idempotencyKey: '   ' }),
    /non-empty string/,
  )
  assert.throws(
    () => captureEventWithDetails('content', { idempotencyKey: 'stable', timestamp: 'not-a-date' }),
    /valid stable timestamp/,
  )
  assert.throws(
    () => captureEventWithDetails('content', { idempotencyKey: 'stable' }),
    /valid stable timestamp/,
  )
})
