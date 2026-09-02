import fs from 'node:fs'
import path from 'node:path'

import { getProfilePaths } from './path-builder.js'
import { systemPaths } from './paths.js'
import { safeWriteJSON } from './safe-file.js'

function readObject(filePath: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must contain a JSON object`)
  }
  return parsed as Record<string, unknown>
}

export function profileTrainingConfigPath(username: string): string {
  return path.join(getProfilePaths(username).etc, 'training.json')
}

export function readTrainingConfigSeed(): Record<string, unknown> {
  const seedPath = path.join(systemPaths.etc, 'training.json')
  if (!fs.existsSync(seedPath)) {
    throw new Error('Training configuration seed not found')
  }
  return readObject(seedPath, 'Training configuration seed')
}

export function ensureProfileTrainingConfig(username: string): string {
  const destination = profileTrainingConfigPath(username)
  if (!fs.existsSync(destination)) {
    safeWriteJSON(destination, readTrainingConfigSeed())
  }
  return destination
}

/**
 * Read the profile configuration with current system defaults filling fields that
 * predate the current training contract. Profile values remain authoritative.
 */
export function readProfileTrainingConfig(username: string): Record<string, unknown> {
  const profilePath = ensureProfileTrainingConfig(username)
  return {
    ...readTrainingConfigSeed(),
    ...readObject(profilePath, `Training configuration for ${username}`),
  }
}

/** Merge a bounded owner update without deleting sibling training sections. */
export function updateProfileTrainingConfig(
  username: string,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const profilePath = ensureProfileTrainingConfig(username)
  const current = readObject(profilePath, `Training configuration for ${username}`)
  const updated = { ...current, ...updates }
  safeWriteJSON(profilePath, updated)
  return updated
}
