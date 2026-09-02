import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import type { CaptureResult } from '@metahuman/core'
import {
  MAX_CHUNKS_PER_FILE,
  MAX_FILE_BYTES,
  chunkText,
  parseIngestorOptions,
  processInbox,
  runIngestor,
  type IngestorDependencies,
} from './core.js'

const NOW = new Date('2026-08-27T12:00:00.000Z')

function temporaryInbox(): { root: string; inbox: string; archive: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-ingestor-'))
  const inbox = path.join(root, 'inbox')
  const archive = path.join(inbox, '_archive')
  fs.mkdirSync(inbox, { recursive: true })
  return { root, inbox, archive }
}

function captureResult(content: string, eventId: string, deduplicated = false): CaptureResult {
  return {
    eventId,
    filePath: deduplicated ? `/memory/${eventId}.json` : `/memory/${eventId}-${content.length}.json`,
    encrypted: false,
    timestamp: NOW.toISOString(),
    eventType: 'observation',
    bytesWritten: deduplicated ? 0 : Buffer.byteLength(content),
    deduplicated,
  }
}

function dependencies(
  paths: { inbox: string; archive: string },
  overrides: Partial<IngestorDependencies> = {},
): IngestorDependencies {
  let sequence = 0
  return {
    captureEvent: content => captureResult(content, `evt-${++sequence}`),
    archiveFile: (source, destination) => fs.renameSync(source, destination),
    resolveInboxPaths: () => paths,
    recordAction: () => {},
    now: () => NOW,
    ...overrides,
  }
}

test('ingestor options reject legacy, unknown, non-positive, and excessive values', () => {
  assert.deepEqual(parseIngestorOptions(['--limit=3', '--max-chars=4000']), { limit: 3, maxChars: 4000 })
  assert.throws(() => parseIngestorOptions(['--single-user']), /Unknown ingestor option/)
  assert.throws(() => parseIngestorOptions(['--limit=0']), /positive integer/)
  assert.throws(() => parseIngestorOptions(['--max-chars=-1']), /positive integer/)
  assert.throws(() => parseIngestorOptions([], { limit: Number.NaN }), /positive integer/)
})

test('chunkText is bounded and cannot loop for invalid sizes', () => {
  assert.deepEqual(chunkText('abcdef', 3), ['abc', 'def'])
  assert.throws(() => chunkText('abc', 0), /positive integer/)
  assert.throws(() => chunkText('abc', -1), /positive integer/)
  assert.throws(() => chunkText('x'.repeat(MAX_CHUNKS_PER_FILE + 1), 1), /maximum/)
})

test('a valid text file returns explicit chunks and is archived once', async t => {
  const paths = temporaryInbox()
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }))
  const source = path.join(paths.inbox, 'notes.txt')
  fs.writeFileSync(source, 'abcdef')

  const first = await processInbox({ maxChars: 3 }, dependencies(paths))
  assert.equal(first.success, true)
  assert.equal(first.filesDiscovered, 1)
  assert.equal(first.filesProcessed, 1)
  assert.equal(first.filesFailed, 0)
  assert.equal(first.chunksCreated, 2)
  assert.deepEqual(first.outcomes[0].chunks.map(chunk => chunk.status), ['created', 'created'])
  assert.equal(fs.existsSync(source), false)
  assert.match(first.outcomes[0].archivePath || '', /^_archive\/2026-08-27\/notes\.[a-f0-9]{12}\.txt$/)

  const repeated = await processInbox({}, dependencies(paths))
  assert.equal(repeated.success, true)
  assert.equal(repeated.filesDiscovered, 0)
  assert.equal(repeated.filesProcessed, 0)
})

test('malformed, binary, unsupported, and oversized files fail without capture or archive', async t => {
  const paths = temporaryInbox()
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }))
  fs.writeFileSync(path.join(paths.inbox, 'bad.json'), '{broken')
  fs.writeFileSync(path.join(paths.inbox, 'binary.txt'), Buffer.from([0, 1, 2, 3]))
  fs.writeFileSync(path.join(paths.inbox, 'document.pdf'), 'not a parsed PDF')
  fs.writeFileSync(path.join(paths.inbox, 'large.txt'), Buffer.alloc(MAX_FILE_BYTES + 1, 97))
  let captures = 0

  const result = await processInbox({}, dependencies(paths, {
    captureEvent: content => {
      captures++
      return captureResult(content, `evt-${captures}`)
    },
  }))

  assert.equal(result.success, false)
  assert.equal(result.filesDiscovered, 4)
  assert.equal(result.filesProcessed, 0)
  assert.equal(result.filesFailed, 4)
  assert.equal(captures, 0)
  assert.match(result.errors.join('\n'), /malformed JSON/)
  assert.match(result.errors.join('\n'), /binary data/)
  assert.match(result.errors.join('\n'), /unsupported extension \.pdf/)
  assert.match(result.errors.join('\n'), /exceeds the 1000000-byte ingestion limit/)
})

test('a partial capture fails the job and preserves completed chunk outcomes for retry', async t => {
  const paths = temporaryInbox()
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }))
  const source = path.join(paths.inbox, 'partial.txt')
  fs.writeFileSync(source, 'abcdef')
  let calls = 0

  const result = await processInbox({ maxChars: 3 }, dependencies(paths, {
    captureEvent: content => {
      calls++
      if (calls === 2) throw new Error('capture unavailable')
      return captureResult(content, 'evt-first')
    },
  }))

  assert.equal(result.success, false)
  assert.equal(result.filesProcessed, 0)
  assert.equal(result.filesFailed, 1)
  assert.deepEqual(result.outcomes[0].chunks.map(chunk => chunk.status), ['created', 'failed'])
  assert.match(result.errors[0], /capture unavailable/)
  assert.equal(fs.existsSync(source), true)
})

test('archive failure retries stable chunk identities without creating duplicate memories', async t => {
  const paths = temporaryInbox()
  t.after(() => fs.rmSync(paths.root, { recursive: true, force: true }))
  const source = path.join(paths.inbox, 'retry.md')
  fs.writeFileSync(source, 'abcdef')
  const captured = new Map<string, string>()
  let created = 0
  const capture: IngestorDependencies['captureEvent'] = (content, options) => {
    const key = options?.idempotencyKey
    if (!key) throw new Error('Expected an idempotency key')
    const existing = captured.get(key)
    if (existing) return captureResult(content, existing, true)
    const eventId = `evt-stable-${++created}`
    captured.set(key, eventId)
    return captureResult(content, eventId)
  }

  const first = await processInbox({ maxChars: 3 }, dependencies(paths, {
    captureEvent: capture,
    archiveFile: () => { throw new Error('archive unavailable') },
  }))
  assert.equal(first.success, false)
  assert.equal(first.chunksCreated, 2)
  assert.match(first.errors[0], /archive unavailable/)
  assert.equal(fs.existsSync(source), true)

  const second = await processInbox({ maxChars: 3 }, dependencies(paths, { captureEvent: capture }))
  assert.equal(second.success, true)
  assert.equal(second.chunksCreated, 0)
  assert.equal(second.chunksDeduplicated, 2)
  assert.equal(created, 2)
  assert.equal(fs.existsSync(source), false)
})

test('invalid run limits fail before inbox discovery', async () => {
  const paths = temporaryInbox()
  try {
    await assert.rejects(() => processInbox({ limit: 0 }, dependencies(paths)), /positive integer/)
    await assert.rejects(() => processInbox({ maxChars: -1 }, dependencies(paths)), /positive integer/)
  } finally {
    fs.rmSync(paths.root, { recursive: true, force: true })
  }
})

test('runIngestor rejects an unknown profile instead of fabricating owner identity', async () => {
  const result = await runIngestor({ username: 'definitely-missing-ingestor-profile' })
  assert.equal(result.success, false)
  assert.equal(result.filesProcessed, 0)
  assert.match(result.errors.join('\n'), /authenticated profile/)
})
