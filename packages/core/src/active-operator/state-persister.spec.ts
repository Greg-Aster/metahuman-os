import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-semi-config-'))
process.env.METAHUMAN_ROOT = root
globalThis.fetch = async () => { throw new Error('Configuration tests prohibit network') }
const { loadConfig, updateConfig } = await import('./state-persister.js')
const { handleGetActiveOperatorConfig, handleUpdateActiveOperatorConfig } = await import('../api/handlers/active-operator.js')
const { eventBus } = await import('../infrastructure/event-bus/client.js')
eventBus.disconnect()
after(() => fs.rmSync(root, { recursive: true, force: true }))

test('five-minute default and interval edits persist without changing the selected mode', async () => {
  assert.deepEqual(loadConfig(), { autonomyMode: 'reactive', semiInactivityMinutes: 5 })
  fs.mkdirSync(path.join(root, 'etc'), { recursive: true })
  fs.writeFileSync(path.join(root, 'etc/active-operator.json'), JSON.stringify({ autonomyMode: 'semi' }))
  assert.deepEqual(loadConfig(), { autonomyMode: 'semi', semiInactivityMinutes: 5 })
  const request = (value: unknown) => ({ user: { isAuthenticated: true, role: 'owner', username: 'fixture' },
    body: { semiInactivityMinutes: value } }) as any
  const result = await handleUpdateActiveOperatorConfig(request(2.5))
  assert.equal(result.status, 200)
  assert.deepEqual(loadConfig(), { autonomyMode: 'semi', semiInactivityMinutes: 2.5 })
  const response = await handleGetActiveOperatorConfig()
  assert.equal((response.data as any).semiInactivityMinutes, 2.5)
  for (const invalid of [0, -1, NaN, Infinity, '5']) {
    assert.equal((await handleUpdateActiveOperatorConfig(request(invalid))).status, 400)
    assert.equal(loadConfig().semiInactivityMinutes, 2.5)
  }
  assert.deepEqual(updateConfig({ autonomyMode: 'full' }), { autonomyMode: 'full', semiInactivityMinutes: 2.5 })
})
