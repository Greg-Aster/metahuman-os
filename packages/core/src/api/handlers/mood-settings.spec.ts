import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

import { setAuditEnabled } from '../../audit.js'
import { getProfilePaths } from '../../path-builder.js'
import type { UnifiedRequest, UnifiedUser } from '../types.js'
import { handleUpdateMoodSettings } from './mood-settings.js'

function request(user: UnifiedUser, body: Record<string, unknown>): UnifiedRequest {
  return {
    path: '/api/mood-settings',
    method: 'PUT',
    user,
    body,
  }
}

test('Mood settings reject unauthorized or invalid trigger updates before writing profile settings', async () => {
  const username = `_mood-api-spec-${process.pid}-${Date.now()}`
  const paths = getProfilePaths(username)
  const moodPath = `${paths.etc}/mood.json`
  const settings = { minimumConfidence: 0.75 }
  setAuditEnabled(false)
  try {
    const guest = await handleUpdateMoodSettings(request({
      userId: username,
      username,
      role: 'guest',
      isAuthenticated: true,
    }, { settings }))
    assert.equal(guest.status, 403)
    assert.equal(fs.existsSync(moodPath), false)

    const standard = await handleUpdateMoodSettings(request({
      userId: username,
      username,
      role: 'standard',
      isAuthenticated: true,
    }, {
      settings,
      trigger: { enabled: true },
    }))
    assert.equal(standard.status, 403)
    assert.equal(fs.existsSync(moodPath), false)

    const owner: UnifiedUser = {
      userId: username,
      username,
      role: 'owner',
      isAuthenticated: true,
    }
    const invalidTrigger = await handleUpdateMoodSettings(request(owner, {
      settings,
      trigger: { eventCountThreshold: 0 },
    }))
    assert.equal(invalidTrigger.status, 400)
    assert.equal(fs.existsSync(moodPath), false)

    const unknownTriggerField = await handleUpdateMoodSettings(request(owner, {
      settings,
      trigger: { parallelMoodTimer: true },
    }))
    assert.equal(unknownTriggerField.status, 400)
    assert.equal(fs.existsSync(moodPath), false)

    fs.mkdirSync(paths.persona, { recursive: true })
    fs.writeFileSync(paths.personaCore, '{"identity":{"name":"Default"}}\n', 'utf8')
    fs.writeFileSync(paths.personaFacets, `${JSON.stringify({
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      activeFacet: 'default',
      facets: {
        default: { name: 'Default', enabled: true, personaFile: 'core.json' },
        inactive: { name: 'Persona Off', enabled: true, personaFile: null },
      },
    }, null, 2)}\n`, 'utf8')
    fs.mkdirSync(paths.state, { recursive: true })
    const statePath = `${paths.state}/mood-state.json`
    fs.writeFileSync(statePath, '{invalid', 'utf8')

    const failedPreflight = await handleUpdateMoodSettings(request(owner, { settings }))
    assert.equal(failedPreflight.status, 400)
    assert.equal(fs.existsSync(moodPath), false)

    fs.rmSync(statePath)
    const saved = await handleUpdateMoodSettings(request(owner, { settings }))
    assert.equal(saved.status, 200)
    assert.equal(saved.data?.settings.minimumConfidence, 0.75)
    assert.equal(JSON.parse(fs.readFileSync(moodPath, 'utf8')).settings.minimumConfidence, 0.75)
  } finally {
    setAuditEnabled(true)
    fs.rmSync(paths.root, { recursive: true, force: true })
  }
})
