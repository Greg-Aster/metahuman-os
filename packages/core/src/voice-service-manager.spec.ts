import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeVoiceServiceConfig } from './voice-service-manager.js'

test('normalizes Kokoro configuration through defaults, file values, and environment overrides', () => {
  assert.deepEqual(normalizeVoiceServiceConfig('kokoro', {
    enabled: false,
    startOnSystemBoot: false,
    port: 9000,
    device: 'cuda',
    langCode: 'b',
  }, {
    MH_KOKORO_PORT: '9001',
    MH_KOKORO_DEVICE: 'cpu',
  }), {
    enabled: false,
    startOnSystemBoot: false,
    port: 9001,
    device: 'cpu',
    langCode: 'b',
  })
})

test('uses safe Whisper fallbacks and its CUDA compute policy', () => {
  assert.deepEqual(normalizeVoiceServiceConfig('whisper', {
    port: 'invalid',
    device: 'invalid',
  }, {}), {
    enabled: true,
    startOnSystemBoot: true,
    port: 9883,
    device: 'cpu',
    model: 'base.en',
    computeType: 'int8',
  })

  assert.equal(normalizeVoiceServiceConfig('whisper', {}, {
    MH_WHISPER_DEVICE: 'cuda',
    MH_WHISPER_COMPUTE_TYPE: 'int8',
  }).computeType, 'float16')
})
