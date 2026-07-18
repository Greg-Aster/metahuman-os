/**
 * Canonical sleep and dreaming configuration.
 *
 * Profiles historically used sleepHour/wakeHour/timezone while the maintained
 * sleep workflow uses window/minIdleMins. Keep normalization here so profile
 * creation, coordinator admission, and the Dreamer agent share one schema.
 */

import fs from 'node:fs'
import { safeReadJSON, safeWriteJSON } from './safe-file.js'
import { storageClient } from './storage-client.js'
import { systemPaths } from './path-builder.js'

export interface SleepConfig {
  enabled: boolean
  window: {
    start: string
    end: string
  }
  minIdleMins: number
  maxDreamsPerNight: number
  showInUI: boolean
  evaluate: boolean
  adapters: {
    prompt: boolean
    rag: boolean
    lora: boolean
  }
}

export const DEFAULT_SLEEP_CONFIG: Readonly<SleepConfig> = Object.freeze({
  enabled: true,
  window: Object.freeze({ start: '23:00', end: '06:30' }),
  minIdleMins: 15,
  maxDreamsPerNight: 3,
  showInUI: true,
  evaluate: true,
  adapters: Object.freeze({
    prompt: true,
    rag: true,
    lora: true,
  }),
})

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function nonNegativeNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function positiveIntegerOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
}

function validClock(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return false
  const [hour, minute] = value.split(':').map(Number)
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}

function legacyHourToClock(value: unknown, fallback: string): string {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 23) return fallback
  return `${String(value).padStart(2, '0')}:00`
}

export function createDefaultSleepConfig(): SleepConfig {
  return {
    enabled: DEFAULT_SLEEP_CONFIG.enabled,
    window: { ...DEFAULT_SLEEP_CONFIG.window },
    minIdleMins: DEFAULT_SLEEP_CONFIG.minIdleMins,
    maxDreamsPerNight: DEFAULT_SLEEP_CONFIG.maxDreamsPerNight,
    showInUI: DEFAULT_SLEEP_CONFIG.showInUI,
    evaluate: DEFAULT_SLEEP_CONFIG.evaluate,
    adapters: { ...DEFAULT_SLEEP_CONFIG.adapters },
  }
}

/** Convert both maintained and legacy sleep settings into the canonical shape. */
export function normalizeSleepConfig(value: unknown): SleepConfig {
  const defaults = createDefaultSleepConfig()
  if (!isRecord(value)) return defaults

  const window = isRecord(value.window) ? value.window : {}
  const adapters = isRecord(value.adapters) ? value.adapters : {}
  const start = validClock(window.start)
    ? window.start
    : legacyHourToClock(value.sleepHour, defaults.window.start)
  const end = validClock(window.end)
    ? window.end
    : legacyHourToClock(value.wakeHour, defaults.window.end)

  return {
    enabled: booleanOr(value.enabled, defaults.enabled),
    window: { start, end },
    minIdleMins: nonNegativeNumberOr(value.minIdleMins, defaults.minIdleMins),
    maxDreamsPerNight: positiveIntegerOr(value.maxDreamsPerNight, defaults.maxDreamsPerNight),
    showInUI: booleanOr(value.showInUI, defaults.showInUI),
    evaluate: booleanOr(value.evaluate, defaults.evaluate),
    adapters: {
      prompt: booleanOr(adapters.prompt, defaults.adapters.prompt),
      rag: booleanOr(adapters.rag, defaults.adapters.rag),
      lora: booleanOr(adapters.lora, defaults.adapters.lora),
    },
  }
}

function sameConfig(left: unknown, right: SleepConfig): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Load and, when needed, atomically migrate one sleep.json file in place. */
export function loadSleepConfigFile(configPath: string): SleepConfig {
  let raw: unknown
  let needsWrite = false
  if (fs.existsSync(configPath)) {
    raw = safeReadJSON(configPath)
  } else {
    raw = createDefaultSleepConfig()
    needsWrite = true
  }

  const config = normalizeSleepConfig(raw)
  if (needsWrite || !sameConfig(raw, config)) safeWriteJSON(configPath, config)
  return config
}

/** Resolve a profile-aware sleep config, falling back to the system template owner. */
export function loadSleepConfig(username?: string): SleepConfig {
  if (username && username !== 'system') {
    const resolved = storageClient.resolvePath({
      username,
      category: 'config',
      subcategory: 'etc',
      relativePath: 'sleep.json',
    })
    if (resolved.success && resolved.path && fs.existsSync(resolved.path)) {
      return loadSleepConfigFile(resolved.path)
    }
  }

  return loadSleepConfigFile(`${systemPaths.etc}/sleep.json`)
}

/** Persist a canonical profile sleep config without falling back across users. */
export function saveSleepConfig(config: SleepConfig, username?: string): SleepConfig {
  const normalized = normalizeSleepConfig(config)
  if (username && username !== 'system') {
    const resolved = storageClient.resolvePath({
      username,
      category: 'config',
      subcategory: 'etc',
      relativePath: 'sleep.json',
    })
    if (!resolved.success || !resolved.path) {
      throw new Error(`Cannot resolve sleep config for ${username}: ${resolved.error || 'unknown error'}`)
    }
    safeWriteJSON(resolved.path, normalized)
    return normalized
  }

  safeWriteJSON(`${systemPaths.etc}/sleep.json`, normalized)
  return normalized
}
