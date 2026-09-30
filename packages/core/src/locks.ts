import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { systemPaths } from './path-builder.js'

export interface LockHandle {
  name: string
  path: string
  release: () => void
}

export interface AcquireLockOptions {
  exitOnSignal?: boolean
}

/** Shared with memory producers and Coordinator admission during an explicit reset. */
export function profileMemoryResetLockName(username: string): string {
  if (!username.trim()) throw new Error('Memory reset requires a profile')
  return `memory-reset-${createHash('sha256').update(username).digest('hex')}`
}

export function assertProfileMemoryAvailable(username: string): void {
  if (isLocked(profileMemoryResetLockName(username))) {
    throw new Error('This profile is resetting its memory. Retry after the reset completes.')
  }
}

/**
 * Acquire a simple file lock. Returns a handle or throws if already locked.
 */
export function acquireLock(name: string, options: AcquireLockOptions = {}): LockHandle {
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || name.includes('..')) throw new Error('Invalid lock name')
  const dir = path.join(systemPaths.run, 'locks')
  fs.mkdirSync(dir, { recursive: true })
  const lockPath = path.join(dir, `${name}.lock`)

  let identity: fs.Stats
  try {
    const fd = fs.openSync(lockPath, 'wx', 0o600)
    identity = fs.fstatSync(fd)
    const payload = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), name })
    fs.writeFileSync(fd, payload)
    fs.closeSync(fd)
  } catch (e: any) {
    if (e && e.code === 'EEXIST') {
      // Lock file exists, check if the locking process is still running.
      try {
        const content = fs.readFileSync(lockPath, 'utf8');
        const { pid } = JSON.parse(content);
        process.kill(pid, 0); // throws if process doesn't exist
        // If we're here, the process is running.
        throw new Error(`Lock already held: ${name}`);
      } catch (checkError: any) {
        if (checkError.code === 'ESRCH') {
          // Process doesn't exist or lock file is corrupt, lock is stale.
          fs.unlinkSync(lockPath);
          return acquireLock(name, options);
        } else {
          // Another error occurred (e.g. reading file, permissions).
          // We can't be sure, so we'll throw the original error.
          throw e;
        }
      }
    }
    throw e
  }

  let released = false
  const onSignal = () => { release(); process.exit(1) }
  const release = () => {
    if (released) return
    released = true
    process.removeListener('exit', release)
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    try {
      const current = fs.statSync(lockPath)
      if (current.dev === identity.dev && current.ino === identity.ino) fs.unlinkSync(lockPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  process.once('exit', release)
  if (options.exitOnSignal !== false) {
    process.once('SIGINT', onSignal)
    process.once('SIGTERM', onSignal)
  }

  return { name, path: lockPath, release }
}

export function isLocked(name: string): boolean {
  const lockPath = path.join(systemPaths.run, 'locks', `${name}.lock`)

  if (!fs.existsSync(lockPath)) {
    return false
  }

  // Lock file exists, check if the process is still running
  try {
    const content = fs.readFileSync(lockPath, 'utf8')
    const { pid } = JSON.parse(content)

    // Check if process exists (throws ESRCH if not)
    process.kill(pid, 0)

    // Process is running, lock is valid
    return true
  } catch (error: any) {
    if (error.code === 'ESRCH') {
      // Only a confirmed dead owner can be reclaimed. An incomplete write is held.
      // Clean it up automatically
      try {
        fs.unlinkSync(lockPath)
      } catch {}
      return false
    }

    // Other error (permissions, etc.) - assume locked to be safe
    return true
  }
}

/** Return the live process recorded by a lock, if one exists. */
export function getLockOwnerPid(name: string): number | undefined {
  if (!isLocked(name)) return undefined
  try {
    const lockPath = path.join(systemPaths.run, 'locks', `${name}.lock`)
    const { pid } = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { pid?: unknown }
    return Number.isInteger(pid) && Number(pid) > 0 ? Number(pid) : undefined
  } catch {
    return undefined
  }
}

/**
 * Clean up all stale lock files (where the process no longer exists).
 * Returns the number of stale locks removed.
 */
export function cleanupStaleLocks(): number {
  const lockDir = path.join(systemPaths.run, 'locks')

  if (!fs.existsSync(lockDir)) {
    return 0
  }

  const lockFiles = fs.readdirSync(lockDir).filter(f => f.endsWith('.lock'))
  let cleaned = 0

  for (const file of lockFiles) {
    const lockPath = path.join(lockDir, file)

    try {
      const content = fs.readFileSync(lockPath, 'utf8')
      const { pid } = JSON.parse(content)

      // Check if process exists
      try {
        process.kill(pid, 0)
        // Process exists, lock is valid
      } catch (killError: any) {
        if (killError.code === 'ESRCH') {
          // Process doesn't exist - remove stale lock
          fs.unlinkSync(lockPath)
          cleaned++
        }
      }
    } catch {
      // A partial write or unreadable owner is not evidence of a stale lock.
    }
  }

  return cleaned
}
