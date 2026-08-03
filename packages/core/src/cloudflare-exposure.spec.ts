import assert from 'node:assert/strict'
import {
  activateTunnelExposure,
  deactivateTunnelExposure,
} from './cloudflare-exposure.js'

const EXPOSURE_KEYS = [
  'HOST',
  'MH_EXPOSURE_MODE',
  'MH_EXPOSURE_SOURCE',
  'MH_ALLOWED_HOSTS',
  'MH_ALLOWED_ORIGINS',
] as const

const original = Object.fromEntries(EXPOSURE_KEYS.map(key => [key, process.env[key]]))

function resetEnvironment(): void {
  for (const key of EXPOSURE_KEYS) delete process.env[key]
}

try {
  resetEnvironment()
  const activated = activateTunnelExposure('mh.example.com')
  assert.equal(activated.mode, 'shared')
  assert.equal(activated.source, 'cloudflare-tunnel')
  assert.equal(activated.hostname, 'mh.example.com')
  assert.equal(activated.origin, 'https://mh.example.com')
  assert.equal(process.env.HOST, '127.0.0.1')
  assert.equal(process.env.MH_ALLOWED_HOSTS, 'mh.example.com')
  assert.equal(process.env.MH_ALLOWED_ORIGINS, 'https://mh.example.com')

  activateTunnelExposure('https://mh.example.com')
  assert.equal(process.env.MH_ALLOWED_HOSTS, 'mh.example.com')
  assert.equal(process.env.MH_ALLOWED_ORIGINS, 'https://mh.example.com')

  const deactivated = deactivateTunnelExposure()
  assert.equal(deactivated.mode, 'local')
  assert.equal(deactivated.source, null)

  resetEnvironment()
  process.env.MH_EXPOSURE_MODE = 'shared'
  process.env.HOST = '0.0.0.0'
  activateTunnelExposure('mh.example.com')
  deactivateTunnelExposure()
  assert.equal(process.env.MH_EXPOSURE_MODE, 'shared')
  assert.equal(process.env.HOST, '0.0.0.0')

  assert.throws(
    () => activateTunnelExposure('https://mh.example.com/not-allowed'),
    /Invalid Cloudflare tunnel hostname/,
  )

  console.log('cloudflare exposure contract passed')
} finally {
  resetEnvironment()
  for (const key of EXPOSURE_KEYS) {
    const value = original[key]
    if (value !== undefined) process.env[key] = value
  }
}
