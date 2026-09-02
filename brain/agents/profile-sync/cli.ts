#!/usr/bin/env node
/** Thin process adapter for the canonical finite Profile Sync contract. */

import { getTargetUser, initGlobalLogger, withUserContext } from '@metahuman/core'
import { parseSyncOptions, syncUserProfile } from './core.js'

function parseCliArgs(args: string[]): { username?: string; syncArgs: string[] } {
  let username: string | undefined
  const syncArgs: string[] = []
  for (const argument of args) {
    if (argument.startsWith('--user=')) {
      if (username !== undefined) throw new Error('--user may be provided only once')
      username = argument.slice('--user='.length).trim()
      if (!username) throw new Error('--user requires a username')
    } else {
      syncArgs.push(argument)
    }
  }
  return { username, syncArgs }
}

async function main(): Promise<void> {
  initGlobalLogger('profile-sync')
  const parsed = parseCliArgs(process.argv.slice(2))
  const triggerUsername = process.env.MH_TRIGGER_USERNAME?.trim()
  if (parsed.username && triggerUsername && parsed.username !== triggerUsername) {
    throw new Error('--user cannot override the Work Coordinator user')
  }
  const target = getTargetUser({ username: triggerUsername || parsed.username })
  if (!target) throw new Error('Profile Sync requires an existing active or explicitly selected user')
  const options = parseSyncOptions(parsed.syncArgs)
  const result = await withUserContext(target, () => syncUserProfile(target.username, options, progress => {
    console.log(`[profile-sync] ${progress.phase}: ${progress.message}`)
  }))
  console.log(JSON.stringify({
    agent: 'profile-sync',
    username: target.username,
    success: result.success,
    profileFiles: result.profileFiles,
    memoriesImported: result.memoriesImported,
    memoriesDeduplicated: result.memoriesDeduplicated,
    credentialKeys: result.credentialKeys,
    errors: result.errors,
  }))
  if (!result.success) throw new Error(result.errors.join('; ') || 'Profile sync failed')
}

main().catch(error => {
  console.error('[profile-sync] Fatal error:', (error as Error).message)
  process.exitCode = 1
})
