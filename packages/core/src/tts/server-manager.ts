/**
 * Lifecycle owner for the profile-coupled GPT-SoVITS server.
 * Kokoro and Whisper are shared services owned by voice-service-manager.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { audit } from '../audit.js'
import { systemPaths } from '../path-builder.js'

export type TTSProvider = 'piper' | 'gpt-sovits'

export interface SovitsStatus {
  running: boolean
  installed: boolean
  healthy?: boolean
  pid?: number
  port?: number
  serverUrl?: string
}

export interface SovitsActionResult {
  success: boolean
  message?: string
  error?: string
  pid?: number
  port?: number
}

interface SovitsPidRecord {
  pid: number
  port: number
  startedAt: string
}

const SOVITS_DIR = path.join(systemPaths.root, 'external', 'gpt-sovits')
const SOVITS_SCRIPT = path.join(SOVITS_DIR, 'api.py')
const RUN_DIR = path.join(systemPaths.logs, 'run')
const SOVITS_PID_FILE = path.join(RUN_DIR, 'sovits.pid')
const SOVITS_LOG_FILE = path.join(RUN_DIR, 'sovits.log')
const SOVITS_START_LOCK = path.join(RUN_DIR, 'sovits.start.lock')

function isProcessRunning(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function ownsSovitsProcess(pid: number): boolean {
  if (!isProcessRunning(pid)) return false

  try {
    const argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
    return argv.some(argument => path.resolve(argument) === SOVITS_SCRIPT)
  } catch {
    // Process ownership cannot be proven without its command line.
    return false
  }
}

function readPidRecord(removeInvalid = true): SovitsPidRecord | undefined {
  if (!fs.existsSync(SOVITS_PID_FILE)) return undefined

  try {
    const value = JSON.parse(fs.readFileSync(SOVITS_PID_FILE, 'utf8')) as Partial<SovitsPidRecord> & { startTime?: string }
    const pid = Number(value.pid)
    const port = Number(value.port)
    const startedAt = value.startedAt ?? value.startTime

    if (
      !Number.isSafeInteger(pid)
      || pid <= 0
      || !Number.isSafeInteger(port)
      || port < 1
      || port > 65535
      || typeof startedAt !== 'string'
      || !ownsSovitsProcess(pid)
    ) {
      if (removeInvalid) fs.rmSync(SOVITS_PID_FILE, { force: true })
      return undefined
    }

    return { pid, port, startedAt }
  } catch {
    if (removeInvalid) fs.rmSync(SOVITS_PID_FILE, { force: true })
    return undefined
  }
}

function removePidFile(expectedPid: number): void {
  try {
    const current = JSON.parse(fs.readFileSync(SOVITS_PID_FILE, 'utf8')) as { pid?: unknown }
    if (Number(current.pid) === expectedPid) fs.rmSync(SOVITS_PID_FILE, { force: true })
  } catch {
    // The process is already stopped; an unreadable stale record is safe to remove.
    fs.rmSync(SOVITS_PID_FILE, { force: true })
  }
}

function writePidRecord(record: SovitsPidRecord): void {
  fs.mkdirSync(RUN_DIR, { recursive: true })
  const temporaryPath = `${SOVITS_PID_FILE}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(record)}\n`, { mode: 0o600 })
  fs.renameSync(temporaryPath, SOVITS_PID_FILE)
}

function findPython(): string | undefined {
  const venvPython = path.join(SOVITS_DIR, 'venv', 'bin', 'python3')
  try {
    fs.accessSync(venvPython, fs.constants.X_OK)
    return venvPython
  } catch {
    // Fall through to PATH candidates.
  }

  const pathDirectories = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  for (const executable of ['python3.11', 'python3.10', 'python3.9', 'python3', 'python']) {
    for (const directory of pathDirectories) {
      const candidate = path.join(directory, executable)
      try {
        fs.accessSync(candidate, fs.constants.X_OK)
        return candidate
      } catch {
        // Try the next candidate.
      }
    }
  }

  return undefined
}

function acquireStartLock(): number | undefined {
  fs.mkdirSync(RUN_DIR, { recursive: true })

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(SOVITS_START_LOCK, 'wx', 0o600)
      fs.writeFileSync(descriptor, `${process.pid}\n`)
      return descriptor
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error

      let lockPid = Number.NaN
      try {
        lockPid = Number.parseInt(fs.readFileSync(SOVITS_START_LOCK, 'utf8').trim(), 10)
      } catch {
        // Treat an unreadable lock as stale.
      }
      if (isProcessRunning(lockPid)) return undefined
      fs.rmSync(SOVITS_START_LOCK, { force: true })
    }
  }

  return undefined
}

function releaseStartLock(descriptor: number): void {
  try {
    fs.closeSync(descriptor)
  } finally {
    fs.rmSync(SOVITS_START_LOCK, { force: true })
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return !isProcessRunning(pid)
}

export async function getSovitsServerStatus(): Promise<SovitsStatus> {
  const installed = fs.existsSync(SOVITS_SCRIPT)
  if (!installed) return { running: false, installed: false }

  const record = readPidRecord()
  if (!record) return { running: false, installed: true }

  let healthy = false
  try {
    const response = await fetch(`http://127.0.0.1:${record.port}/`, {
      signal: AbortSignal.timeout(2000),
    })
    healthy = response.status >= 200 && response.status < 500
  } catch {
    // A live process can still be warming up or unhealthy.
  }

  return {
    running: true,
    installed: true,
    healthy,
    pid: record.pid,
    port: record.port,
    serverUrl: `http://127.0.0.1:${record.port}`,
  }
}

export async function startSovitsServer(port = 9880): Promise<SovitsActionResult> {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    return { success: false, error: 'Port must be an integer between 1 and 65535.' }
  }

  if (!fs.existsSync(SOVITS_SCRIPT)) {
    return { success: false, error: 'GPT-SoVITS is not installed. Install it from the Addons page or CLI first.' }
  }

  const lockDescriptor = acquireStartLock()
  if (lockDescriptor === undefined) {
    return { success: false, error: 'Another GPT-SoVITS start is already in progress.' }
  }

  try {
    const existing = readPidRecord()
    if (existing) {
      return {
        success: false,
        error: `GPT-SoVITS is already running on port ${existing.port} (PID: ${existing.pid}).`,
      }
    }

    const python = findPython()
    if (!python) return { success: false, error: 'Python 3.9 or newer was not found.' }

    fs.mkdirSync(RUN_DIR, { recursive: true })
    const logDescriptor = fs.openSync(SOVITS_LOG_FILE, 'a')
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(python, [SOVITS_SCRIPT, '-a', '127.0.0.1', '-p', String(port)], {
        cwd: SOVITS_DIR,
        detached: true,
        stdio: ['ignore', logDescriptor, logDescriptor],
      })
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
      })
    } finally {
      fs.closeSync(logDescriptor)
    }

    if (child.pid === undefined) {
      return { success: false, error: 'GPT-SoVITS did not return a process ID.' }
    }

    child.unref()
    writePidRecord({ pid: child.pid, port, startedAt: new Date().toISOString() })
    await new Promise(resolve => setTimeout(resolve, 2000))

    const status = await getSovitsServerStatus()
    if (!status.running) {
      return { success: false, error: `GPT-SoVITS exited during startup. Check ${SOVITS_LOG_FILE}.` }
    }

    audit({
      level: 'info',
      category: 'system',
      event: 'tts_server_started',
      details: { provider: 'gpt-sovits', pid: child.pid, port },
      actor: 'system',
    })

    return {
      success: true,
      message: status.healthy
        ? `GPT-SoVITS started on port ${port}.`
        : `GPT-SoVITS started on port ${port} and is still warming up.`,
      pid: child.pid,
      port,
    }
  } catch (error) {
    return { success: false, error: `Failed to start GPT-SoVITS: ${(error as Error).message}` }
  } finally {
    releaseStartLock(lockDescriptor)
  }
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  process.kill(-pid, signal)
}

export async function stopSovitsServer(): Promise<SovitsActionResult> {
  const record = readPidRecord()
  if (!record) return { success: true, message: 'GPT-SoVITS is not running.' }

  try {
    signalProcessGroup(record.pid, 'SIGTERM')
    if (!(await waitForExit(record.pid, 5000)) && ownsSovitsProcess(record.pid)) {
      signalProcessGroup(record.pid, 'SIGKILL')
      await waitForExit(record.pid, 1000)
    }

    if (ownsSovitsProcess(record.pid)) {
      return { success: false, error: `GPT-SoVITS process ${record.pid} did not stop.` }
    }

    removePidFile(record.pid)
    audit({
      level: 'info',
      category: 'system',
      event: 'tts_server_stopped',
      details: { provider: 'gpt-sovits', pid: record.pid },
      actor: 'system',
    })
    return { success: true, message: 'GPT-SoVITS stopped.' }
  } catch (error) {
    return { success: false, error: `Failed to stop GPT-SoVITS: ${(error as Error).message}` }
  }
}

export async function stopServer(provider: TTSProvider): Promise<boolean> {
  if (provider === 'piper') return false
  const wasRunning = readPidRecord() !== undefined
  const result = await stopSovitsServer()
  return wasRunning && result.success
}

export async function stopAllServers(): Promise<number> {
  return (await stopServer('gpt-sovits')) ? 1 : 0
}

export function getRunningServers(): TTSProvider[] {
  return readPidRecord() ? ['gpt-sovits'] : []
}

export function cleanupStalePidFiles(): number {
  const hadPidFile = fs.existsSync(SOVITS_PID_FILE)
  const record = readPidRecord()
  return hadPidFile && !record ? 1 : 0
}
