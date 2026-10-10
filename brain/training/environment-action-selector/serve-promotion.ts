import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const SERVICE = 'llama-cpp-environment-intent.service'
const TRAINING_GPU_SERVICES = ['llama-cpp.service', SERVICE] as const

/** Change only the selected adapter in the existing shared-server startup command. */
export function replaceStartupAdapter(unit: string, previousPath: string, nextPath: string): string {
  const line = unit.split('\n').find(value => value.startsWith('ExecStart='))
  if (!line) throw new Error('Shared llama.cpp service has no ExecStart')
  const match = line.match(/(^|\s)--lora-scaled\s+(\S+)/)
  if (!match) throw new Error('Shared llama.cpp service has no preloaded LoRA list')
  const entries = match[2]!.split(',')
  const index = entries.findIndex(entry => entry.startsWith(`${previousPath}:`))
  if (index < 0 || entries.filter(entry => entry.startsWith(`${previousPath}:`)).length !== 1) {
    throw new Error('Active LoRA appears zero or multiple times in the shared service')
  }
  entries[index] = `${nextPath}:${entries[index]!.slice(previousPath.length + 1)}`
  const updated = line.replace(match[2]!, entries.join(','))
  return unit.replace(line, updated)
}

async function systemctl(...arguments_: string[]): Promise<void> {
  const child = spawn('systemctl', ['--user', ...arguments_], { stdio: 'inherit' })
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once('error', reject)
    child.once('exit', code => resolveExit(code ?? 1))
  })
  if (exitCode !== 0) throw new Error(`systemctl --user ${arguments_.join(' ')} exited with code ${exitCode}`)
}

async function isRunning(service: string): Promise<boolean> {
  const child = spawn('systemctl', ['--user', 'is-active', service], { stdio: ['ignore', 'pipe', 'pipe'] })
  const output: Buffer[] = []
  const errors: Buffer[] = []
  child.stdout.on('data', chunk => output.push(chunk as Buffer))
  child.stderr.on('data', chunk => errors.push(chunk as Buffer))
  await new Promise<void>((resolveExit, reject) => {
    child.once('error', reject)
    child.once('close', () => resolveExit())
  })
  const state = Buffer.concat(output).toString('utf8').trim()
  if (!['active', 'activating', 'inactive', 'failed'].includes(state)) {
    throw new Error(`Cannot determine ${service} activity: ${state || Buffer.concat(errors).toString('utf8').trim() || 'no status'}`)
  }
  return state === 'active' || state === 'activating'
}

/** Free GPU memory for one manual fit/evaluation cycle and restore prior service activity. */
export async function withTrainingGpuCapacity<T>(work: () => Promise<T>): Promise<T> {
  const running = (await Promise.all(TRAINING_GPU_SERVICES.map(async service => ({
    service, running: await isRunning(service),
  })))).filter(value => value.running).map(value => value.service)
  let result: T | undefined
  let workError: unknown
  try {
    if (running.length) await systemctl('stop', ...running)
    result = await work()
  } catch (error) { workError = error }
  try {
    if (running.length) await systemctl('start', ...running)
  } catch (restoreError) {
    if (workError) throw new AggregateError([workError, restoreError], 'Training failed and model services were not restored')
    throw restoreError
  }
  if (workError) throw workError
  return result as T
}

async function replaceUnit(path: string, contents: string, mode: number): Promise<void> {
  const temporary = `${path}.tmp-${randomUUID()}`
  await writeFile(temporary, contents, { mode })
  await rename(temporary, path)
}

async function awaitLoaded(endpoint: string, adapterPath: string): Promise<void> {
  const deadline = Date.now() + 30_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL('/lora-adapters', endpoint), { signal: AbortSignal.timeout(2_000) })
      if (!response.ok) throw new Error(`Adapter list returned HTTP ${response.status}`)
      const adapters = await response.json() as Array<{ path?: string }>
      if (adapters.some(adapter => adapter.path === adapterPath)) return
      lastError = new Error('New LoRA was absent from the loaded adapter list')
    } catch (error) { lastError = error }
    await new Promise(resolveWait => setTimeout(resolveWait, 300))
  }
  throw new Error(`Shared llama.cpp service did not load ${adapterPath}: ${String(lastError)}`)
}

/** Run the Core role-owner commit only after llama.cpp advertises the new adapter. */
export async function activateReviewedLora<T>(input: {
  previousPath: string
  nextPath: string
  endpoint: string
  commit: () => Promise<T>
}): Promise<T> {
  const path = resolve(process.env.XDG_CONFIG_HOME || resolve(homedir(), '.config'), 'systemd/user', SERVICE)
  const original = await readFile(path, 'utf8')
  const mode = (await stat(path)).mode & 0o777
  const updated = replaceStartupAdapter(original, input.previousPath, input.nextPath)
  await replaceUnit(path, updated, mode)
  try {
    await systemctl('daemon-reload')
    await systemctl('restart', SERVICE)
    await awaitLoaded(input.endpoint, input.nextPath)
    return await input.commit()
  } catch (error) {
    try {
      await replaceUnit(path, original, mode)
      await systemctl('daemon-reload')
      await systemctl('restart', SERVICE)
      await awaitLoaded(input.endpoint, input.previousPath)
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Promotion and service restoration both failed')
    }
    throw error
  }
}
