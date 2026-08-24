import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { systemPaths } from './path-builder.js'

export type VoiceServiceId = 'kokoro' | 'whisper'

export interface VoiceServiceStatus {
  id: VoiceServiceId
  installed: boolean
  running: boolean
  healthy: boolean
  readiness: 'stopped' | 'loading' | 'ready' | 'error'
  pid?: number
  url: string
  health?: Record<string, unknown>
  error?: string
}

export interface VoiceServiceConfig {
  enabled: boolean
  startOnSystemBoot: boolean
  port: number
  device: 'cpu' | 'cuda'
  model?: string
  computeType?: 'int8' | 'float16' | 'float32'
  langCode?: string
}

interface VoiceServiceSpec {
  cwd: string
  command: string
  args: string[]
  pidFile: string
  logFile: string
  requiredFiles: string[]
  config: VoiceServiceConfig
}

interface HealthResult {
  responding: boolean
  healthy: boolean
  health?: Record<string, unknown>
}

const CONFIG_FILE = 'voice-servers.json'

const DEFAULTS: Record<VoiceServiceId, VoiceServiceConfig> = {
  kokoro: {
    enabled: true,
    startOnSystemBoot: true,
    port: 9882,
    device: 'cpu',
    langCode: 'a',
  },
  whisper: {
    enabled: true,
    startOnSystemBoot: true,
    port: 9883,
    device: 'cpu',
    model: 'base.en',
    computeType: 'int8',
  },
}

function readServiceEntry(id: VoiceServiceId): Record<string, unknown> {
  try {
    const configPath = path.join(systemPaths.etc, CONFIG_FILE)
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      servers?: Record<string, Record<string, unknown>>
    }
    return parsed.servers?.[id] ?? {}
  } catch {
    return {}
  }
}

function positivePort(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback
}

function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function normalizeVoiceServiceConfig(
  id: VoiceServiceId,
  entry: Record<string, unknown>,
  environment: NodeJS.ProcessEnv = process.env,
): VoiceServiceConfig {
  const defaults = DEFAULTS[id]
  const envPrefix = id === 'whisper' ? 'MH_WHISPER' : 'MH_KOKORO'
  const requestedDevice = environment[`${envPrefix}_DEVICE`] ?? entry.device
  const device = requestedDevice === 'cuda' ? 'cuda' : 'cpu'
  const port = positivePort(environment[`${envPrefix}_PORT`] ?? entry.port, defaults.port)
  const shared: Pick<VoiceServiceConfig, 'enabled' | 'startOnSystemBoot' | 'port' | 'device'> = {
    enabled: typeof entry.enabled === 'boolean' ? entry.enabled : defaults.enabled,
    startOnSystemBoot: typeof entry.startOnSystemBoot === 'boolean'
      ? entry.startOnSystemBoot
      : defaults.startOnSystemBoot,
    port,
    device,
  }

  if (id === 'whisper') {
    const requestedCompute = environment.MH_WHISPER_COMPUTE_TYPE ?? entry.computeType
    const computeType = requestedCompute === 'float16' || requestedCompute === 'float32'
      ? requestedCompute
      : 'int8'
    return {
      ...shared,
      model: String(environment.MH_WHISPER_MODEL ?? entry.model ?? defaults.model),
      computeType: device === 'cuda' && computeType === 'int8' ? 'float16' : computeType,
    }
  }

  return {
    ...shared,
    langCode: String(environment.MH_KOKORO_LANG ?? entry.langCode ?? defaults.langCode),
  }
}

export function getVoiceServiceConfig(id: VoiceServiceId): VoiceServiceConfig {
  return normalizeVoiceServiceConfig(id, readServiceEntry(id))
}

export function getVoiceServiceUrl(id: VoiceServiceId): string {
  return `http://127.0.0.1:${getVoiceServiceConfig(id).port}`
}

function getVoiceServiceSpec(id: VoiceServiceId): VoiceServiceSpec {
  const config = getVoiceServiceConfig(id)
  const runDir = path.join(systemPaths.logs, 'run')

  if (id === 'whisper') {
    const command = path.join(systemPaths.root, 'venv', 'bin', 'python3')
    const script = path.join(systemPaths.root, 'external', 'whisper', 'whisper_server.py')
    return {
      cwd: systemPaths.root,
      command,
      args: [
        script,
        '--model', config.model!,
        '--device', config.device,
        '--compute-type', config.computeType!,
        '--port', String(config.port),
      ],
      pidFile: path.join(runDir, 'whisper-server.pid'),
      logFile: path.join(runDir, 'whisper-server.log'),
      requiredFiles: [command, script],
      config,
    }
  }

  const cwd = path.join(systemPaths.root, 'external', 'kokoro')
  const command = path.join(cwd, 'venv', 'bin', 'python3')
  const script = path.join(cwd, 'kokoro_server.py')
  return {
    cwd,
    command,
    args: [script, '--port', String(config.port), '--lang', config.langCode!, '--device', config.device],
    pidFile: path.join(runDir, 'kokoro-server.pid'),
    logFile: path.join(runDir, 'kokoro-server.log'),
    requiredFiles: [command, script],
    config,
  }
}

function readManagedPid(pidFile: string): number | undefined {
  try {
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim())
    if (isProcessRunning(pid)) return pid
    fs.rmSync(pidFile, { force: true })
  } catch {}
  return undefined
}

async function readHealth(id: VoiceServiceId): Promise<HealthResult> {
  try {
    const response = await fetch(`${getVoiceServiceUrl(id)}/health`, {
      signal: AbortSignal.timeout(1500),
    })
    let health: Record<string, unknown> | undefined
    try {
      health = await response.json() as Record<string, unknown>
    } catch {}
    const state = String(health?.status ?? '').toLowerCase()
    return {
      responding: true,
      health,
      healthy: response.ok && (
        state === 'ready'
        || state === 'ok'
        || state === 'healthy'
        || (id === 'kokoro' && state === '')
      ),
    }
  } catch {
    return { responding: false, healthy: false }
  }
}

export async function getVoiceServiceStatus(id: VoiceServiceId): Promise<VoiceServiceStatus> {
  const spec = getVoiceServiceSpec(id)
  const installed = spec.requiredFiles.every(file => fs.existsSync(file))
  const pid = readManagedPid(spec.pidFile)
  const { responding, healthy, health } = await readHealth(id)
  const running = Boolean(pid || responding)
  const state = String(health?.status ?? '').toLowerCase()
  const readiness = healthy
    ? 'ready'
    : running && (!responding || state === 'loading')
      ? 'loading'
      : running
        ? 'error'
        : 'stopped'

  return {
    id,
    installed,
    running,
    healthy,
    readiness,
    pid,
    url: getVoiceServiceUrl(id),
    health,
    error: installed ? undefined : `Required ${id} server files are not installed`,
  }
}

export async function ensureVoiceServiceRunning(id: VoiceServiceId): Promise<VoiceServiceStatus> {
  const current = await getVoiceServiceStatus(id)
  if (current.running) return current

  const spec = getVoiceServiceSpec(id)
  if (!spec.config.enabled) throw new Error(`${id} service is disabled in etc/${CONFIG_FILE}`)
  if (!current.installed) throw new Error(current.error)

  fs.mkdirSync(path.dirname(spec.pidFile), { recursive: true })
  const logFd = fs.openSync(spec.logFile, 'a')
  let child
  try {
    child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: process.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', logFd, logFd],
    })
  } finally {
    fs.closeSync(logFd)
  }

  if (!child.pid) throw new Error(`Failed to start ${id} server`)
  fs.writeFileSync(spec.pidFile, `${child.pid}\n`)
  child.unref()

  await new Promise(resolve => setTimeout(resolve, 300))
  const status = await getVoiceServiceStatus(id)
  if (!status.running) {
    fs.rmSync(spec.pidFile, { force: true })
    throw new Error(`${id} server exited during startup; check ${spec.logFile}`)
  }
  return status
}

function signalManagedProcess(pid: number, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, signal)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  process.kill(pid, signal)
}

export async function stopVoiceService(id: VoiceServiceId): Promise<{ success: boolean; message: string }> {
  const spec = getVoiceServiceSpec(id)
  const pid = readManagedPid(spec.pidFile)
  if (!pid) {
    const status = await getVoiceServiceStatus(id)
    if (status.running) {
      return { success: false, message: `${id} is running outside the voice server manager` }
    }
    return { success: true, message: `${id} is not running` }
  }

  signalManagedProcess(pid, 'SIGTERM')
  const deadline = Date.now() + 5000
  while (isProcessRunning(pid) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (isProcessRunning(pid)) signalManagedProcess(pid, 'SIGKILL')
  fs.rmSync(spec.pidFile, { force: true })
  return { success: true, message: `Stopped ${id} server` }
}
