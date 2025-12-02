import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { systemPaths } from './path-builder.js'

export interface LockHandle {
  name: string
  path: string
  release: () => void
}

/**
 * Acquire a simple file lock. Returns a handle or throws if already locked.
 */
export function acquireLock(name: string): LockHandle {
  const dir = path.join(systemPaths.run, 'locks')
  fs.mkdirSync(dir, { recursive: true })
  const lockPath = path.join(dir, `${name}.lock`)

  try {
    const fd = fs.openSync(lockPath, 'wx')
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
        if (checkError.code === 'ESRCH' || checkError instanceof SyntaxError) {
          // Process doesn't exist or lock file is corrupt, lock is stale.
          fs.unlinkSync(lockPath);
          return acquireLock(name);
        } else {
          // Another error occurred (e.g. reading file, permissions).
          // We can't be sure, so we'll throw the original error.
          throw e;
        }
      }
    }
    throw e
  }

  const release = () => {
    try { fs.unlinkSync(lockPath) } catch {}
  }

  process.once('exit', release)
  process.once('SIGINT', () => { release(); process.exit(1) })
  process.once('SIGTERM', () => { release(); process.exit(1) })

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
    if (error.code === 'ESRCH' || error instanceof SyntaxError) {
      // Process doesn't exist or lock file is corrupt - stale lock
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
    } catch (error: any) {
      // Corrupt lock file - remove it
      if (error instanceof SyntaxError) {
        try {
          fs.unlinkSync(lockPath)
          cleaned++
        } catch {}
      }
    }
  }

  return cleaned
}

