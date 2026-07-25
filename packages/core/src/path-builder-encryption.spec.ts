import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  registerProfileStorageConfigGetter,
  resolveProfileRoot,
} from './path-builder.js'
import { getProfileStorageConfig } from './users.js'

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
