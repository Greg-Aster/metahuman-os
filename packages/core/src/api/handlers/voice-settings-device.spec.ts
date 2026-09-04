import assert from 'node:assert/strict'
import test from 'node:test'
import { getVoiceServiceConfig } from '../../voice-service-manager.js'
import { handleSaveVoiceSettings } from './voice-settings.js'

const request = (role: 'owner' | 'standard', body: unknown) => ({
  path: '/api/voice-settings',
  method: 'POST' as const,
  body,
  user: {
    userId: `${role}-test`,
    username: `${role}-test`,
    role,
    isAuthenticated: true,
  },
})

test('rejects invalid system device values before resolving or writing a profile', async () => {
  const response = await handleSaveVoiceSettings(request('owner', {
    kokoro: { device: 'metal' },
  }))

  assert.equal(response.status, 400)
  assert.equal(response.error, 'Kokoro device must be cpu or cuda')
})

test('prevents a standard profile user from changing the shared Kokoro device', async () => {
  const current = getVoiceServiceConfig('kokoro').device
  const response = await handleSaveVoiceSettings(request('standard', {
    kokoro: { device: current === 'cpu' ? 'cuda' : 'cpu' },
  }))

  assert.equal(response.status, 403)
  assert.equal(response.error, 'Only the installation owner can change voice service processing devices')
})

test('prevents a standard profile user from changing the shared Whisper device', async () => {
  const current = getVoiceServiceConfig('whisper').device
  const response = await handleSaveVoiceSettings(request('standard', {
    stt: { device: current === 'cpu' ? 'cuda' : 'cpu' },
  }))

  assert.equal(response.status, 403)
  assert.equal(response.error, 'Only the installation owner can change voice service processing devices')
})
