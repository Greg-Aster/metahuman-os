import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-locks-'))
process.env.METAHUMAN_ROOT = root
const { acquireLock, isLocked, cleanupStaleLocks } = await import('./locks.js')
after(() => fs.rmSync(root, { recursive: true, force: true }))

test('partial writes cannot be reclaimed and repeated release cannot delete a later owner', () => {
  const first = acquireLock('fixture', { exitOnSignal: false })
  assert.equal(isLocked('fixture'), true)
  assert.throws(() => acquireLock('fixture', { exitOnSignal: false }))
  first.release()
  const second = acquireLock('fixture', { exitOnSignal: false })
  first.release()
  assert.equal(isLocked('fixture'), true)
  fs.writeFileSync(second.path, '{')
  assert.equal(isLocked('fixture'), true)
  assert.equal(cleanupStaleLocks(), 0)
  assert.throws(() => acquireLock('fixture', { exitOnSignal: false }))
  second.release()
  assert.equal(isLocked('fixture'), false)
  assert.throws(() => acquireLock('../escape', { exitOnSignal: false }), /Invalid lock/)
})
