import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createDefaultSleepConfig,
  loadSleepConfigFile,
  normalizeSleepConfig,
} from './sleep-config.js'

const maintainedTemplate = JSON.parse(
  fs.readFileSync(path.resolve('etc/sleep.json.template'), 'utf8'),
)
assert.deepEqual(maintainedTemplate, createDefaultSleepConfig())

const legacy = normalizeSleepConfig({
  sleepHour: 2,
  wakeHour: 8,
  timezone: 'America/New_York',
  enabled: true,
})

assert.deepEqual(legacy, {
  ...createDefaultSleepConfig(),
  window: { start: '02:00', end: '08:00' },
})

const customized = normalizeSleepConfig({
  enabled: false,
  window: { start: '21:15', end: '05:45' },
  minIdleMins: 30,
  maxDreamsPerNight: 1,
  showInUI: false,
  evaluate: false,
  adapters: { prompt: false, rag: true, lora: false },
})
assert.deepEqual(customized, {
  enabled: false,
  window: { start: '21:15', end: '05:45' },
  minIdleMins: 30,
  maxDreamsPerNight: 1,
  showInUI: false,
  evaluate: false,
  adapters: { prompt: false, rag: true, lora: false },
})

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-sleep-config-'))
const configPath = path.join(tempDir, 'sleep.json')
try {
  fs.writeFileSync(configPath, JSON.stringify({ sleepHour: 1, wakeHour: 7, enabled: true }))
  const migrated = loadSleepConfigFile(configPath)
  assert.equal(migrated.window.start, '01:00')
  assert.equal(migrated.window.end, '07:00')
  const persisted = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  assert.equal('sleepHour' in persisted, false)
  assert.deepEqual(persisted, migrated)
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true })
}

console.log('sleep config contract passed')
