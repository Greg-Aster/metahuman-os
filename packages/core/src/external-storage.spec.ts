import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getMountForDevice,
  isMountWritable,
  parseProcMounts,
} from './external-storage.js'

test('parseProcMounts decodes escaped fields and preserves mount options', () => {
  const mounts = parseProcMounts([
    '/dev/sda1 /media/My\\040Drive ext4 rw,nosuid,nodev 0 0',
    '/dev/mapper/metahuman-test /mnt/profile ext4 ro,relatime 0 0',
  ].join('\n'))

  assert.equal(mounts.length, 2)
  assert.equal(mounts[0].mountPoint, '/media/My Drive')
  assert.equal(mounts[0].device, '/dev/sda1')
  assert.equal(isMountWritable(mounts[0]), true)
  assert.equal(isMountWritable(mounts[1]), false)
})

test('getMountForDevice finds the configured mapper mount', () => {
  const mounts = parseProcMounts(
    '/dev/mapper/metahuman-test /mnt/profile ext4 rw,relatime 0 0\n'
  )

  assert.deepEqual(
    getMountForDevice('/dev/mapper/metahuman-test', mounts),
    mounts[0]
  )
  assert.equal(getMountForDevice('/dev/mapper/metahuman-other', mounts), null)
})
