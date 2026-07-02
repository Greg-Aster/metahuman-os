import type { AppConfig } from './types'

export const FALLBACK_CONFIG: AppConfig = {
  configExists: false,
  server: {
    url: 'http://127.0.0.1:4321',
    configured: false,
    requestTimeoutMs: 30000,
  },
  app: {
    host: '127.0.0.1',
    port: 4377,
    autoListen: true,
    showDebugUi: false,
  },
  voice: {
    language: 'en-US',
    vadThreshold: 12,
    silenceMs: 1400,
    minSpeechMs: 500,
    ttsEnabled: true,
  },
  robot: {
    motionEnabled: false,
    status: 'disabled',
  },
}
