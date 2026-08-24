import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'

import { backupFile, listFileBackups, restoreFromBackup } from './safe-file.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('file backups retain a distinct public name and restore the latest valid copy', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-safe-file-'))
  temporaryDirectories.push(directory)
  const filePath = path.join(directory, 'settings.json')

  fs.writeFileSync(filePath, '{"version":1}\n')
  const backupPath = backupFile(filePath)
  assert.ok(backupPath)

  fs.writeFileSync(filePath, '{"version":2}\n')

  const backups = listFileBackups(filePath)
  assert.equal(backups.length, 1)
  assert.equal(backups[0].path, backupPath)
  assert.equal(restoreFromBackup(filePath), true)
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{"version":1}\n')
})
