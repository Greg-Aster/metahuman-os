import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { paths } from './paths.js'

export interface LockHandle {
  name: string
  path: string
  release: () => void
}

/**
 * Acquire a simple file lock. Returns a handle or throws if already locked.
 */
export function acquireLock(name: string): LockHandle {
  const dir = path.join(paths.run, 'locks')
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
  const lockPath = path.join(paths.run, 'locks', `${name}.lock`)
  return fs.existsSync(lockPath)
}

