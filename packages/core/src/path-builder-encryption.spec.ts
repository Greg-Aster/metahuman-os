import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  findRepoRoot,
  registerProfileStorageConfigGetter,
  resolveProfileRoot,
} from './path-builder.js'
import { getProfileStorageConfig } from './users.js'

test('an explicit unavailable runtime root cannot fall through to installation storage', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-root-contract-'))
  const previous = process.env.METAHUMAN_ROOT
  try {
    process.env.METAHUMAN_ROOT = path.join(root, 'missing')
    assert.throws(() => findRepoRoot(), /Refusing to use a different storage root/)
    process.env.METAHUMAN_ROOT = root
    assert.equal(findRepoRoot(), root)
  } finally {
    if (previous === undefined) delete process.env.METAHUMAN_ROOT
    else process.env.METAHUMAN_ROOT = previous
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolveProfileRoot blocks an underlying directory when its LUKS mapper is not mounted', () => {
  const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-locked-luks-'))
  const username = `locked-luks-${process.pid}`

  registerProfileStorageConfigGetter((requestedUsername) => {
    if (requestedUsername !== username) return undefined
    return {
      path: profileRoot,
      type: 'encrypted',
      fallbackBehavior: 'readonly',
      encryption: {
        type: 'luks',
        mapperName: `metahuman-test-${process.pid}`,
        mountPoint: profileRoot,
      },
    }
  })

  try {
    assert.throws(
      () => resolveProfileRoot(username),
      /Encrypted profile is locked.*No unencrypted fallback is allowed/
    )
  } finally {
    registerProfileStorageConfigGetter(getProfileStorageConfig)
    fs.rmSync(profileRoot, { recursive: true, force: true })
  }
})
