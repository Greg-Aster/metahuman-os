/**
 * The single terminal and process lifecycle owner for Big Brother escalation.
 * Claude Code and Codex start immediately under this owner while ttyd exposes
 * the same live transcript in the in-app terminal.
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { audit } from './audit.js'
import type { EscalationOptions } from './escalation-backend.js'
import { eventBus, EventTypes } from './infrastructure/event-bus/index.js'
import { ROOT } from './path-builder.js'
import {
  isTerminalBigBrotherProviderInstalled,
  providerLabel,
  type BigBrotherSessionResult,
  type ParsedBigBrotherEvent,
  type TerminalBigBrotherProvider,
} from './big-brother-cli.js'

export {
  isTerminalBigBrotherProviderInstalled,
  parseBigBrotherTerminalEvent,
  providerLabel,
  type BigBrotherSessionResult,
  type ParsedBigBrotherEvent,
  type TerminalBigBrotherProvider,
} from './big-brother-cli.js'

export const BIG_BROTHER_SESSION_PORT = 3099
const TERMINAL_HOST = '127.0.0.1'
const TTYD_BIN = path.join(ROOT, 'bin/ttyd')
const WORKER_PATH = path.join(ROOT, 'packages/core/src/big-brother-session-worker.ts')
const TAIL_BIN = '/usr/bin/tail'
const LOG_DIR = path.join(ROOT, 'logs/run')
const TERMINAL_START_TIMEOUT_MS = 5000

export type BigBrotherSessionPhase = 'idle' | 'starting' | 'running' | 'completed' | 'failed' | 'stopped'

export interface BigBrotherSessionState {
  sessionOpen: boolean
  processRunning: boolean
  port: number
  pid: number | null
  provider: TerminalBigBrotherProvider | null
  phase: BigBrotherSessionPhase
  lastActivity: Date | null
  error: string | null
}

interface WorkerJob {
  provider: TerminalBigBrotherProvider
  prompt: string
  username?: string
  workingDirectory?: string
  timeout?: number
  sessionId?: string
}

function terminalUrl(): string {
  return `http://localhost:${BIG_BROTHER_SESSION_PORT}`
}

async function waitForTerminalPort(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + TERMINAL_START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`ttyd exited before opening port ${BIG_BROTHER_SESSION_PORT}`)
    }

    const ready = await new Promise<boolean>(resolve => {
      const socket = net.createConnection({ host: TERMINAL_HOST, port: BIG_BROTHER_SESSION_PORT })
      let settled = false
      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        socket.destroy()
        resolve(value)
      }
      socket.once('connect', () => finish(true))
      socket.once('error', () => finish(false))
      socket.setTimeout(250, () => finish(false))
    })
    if (ready) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`ttyd did not open port ${BIG_BROTHER_SESSION_PORT} within ${TERMINAL_START_TIMEOUT_MS}ms`)
}

function findBigBrotherTtydPids(): number[] {
  try {
    const output = execFileSync(
      'pgrep',
      ['-f', `[t]tyd.*--port[ =]${BIG_BROTHER_SESSION_PORT}`],
      { encoding: 'utf8', timeout: 2000 },
    )
    return output
      .trim()
      .split(/\s+/)
      .map(value => Number.parseInt(value, 10))
      .filter(pid => Number.isInteger(pid) && pid > 1 && pid !== process.pid)
  } catch {
    return []
  }
}

async function stopStaleBigBrotherTerminals(): Promise<void> {
  const pids = findBigBrotherTtydPids()
  for (const pid of pids) {
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      try { process.kill(pid, 'SIGTERM') } catch { /* already exited */ }
    }
  }
  if (pids.length > 0) await new Promise(resolve => setTimeout(resolve, 200))
}

class BigBrotherSessionManager extends EventEmitter {
  private terminalProcess: ChildProcess | null = null
  private workerProcess: ChildProcess | null = null
  private provider: TerminalBigBrotherProvider | null = null
  private phase: BigBrotherSessionPhase = 'idle'
  private executionActive = false
  private lastActivity: Date | null = null
  private error: string | null = null
  private cancellationReason: string | null = null
  private jobDir: string | null = null

  getState(): BigBrotherSessionState {
    return {
      sessionOpen: this.terminalProcess !== null,
      processRunning: this.executionActive,
      port: BIG_BROTHER_SESSION_PORT,
      pid: this.terminalProcess?.pid ?? null,
      provider: this.provider,
      phase: this.phase,
      lastActivity: this.lastActivity,
      error: this.error,
    }
  }

  async execute(
    provider: TerminalBigBrotherProvider,
    prompt: string,
    options: EscalationOptions = {},
  ): Promise<BigBrotherSessionResult> {
    const startedAt = Date.now()
    if (this.executionActive) {
      return {
        success: false,
        output: '',
        error: `Big Brother is already running ${providerLabel(this.provider || provider)}`,
        executionTime: 0,
        metadata: { provider },
      }
    }

    if (!isTerminalBigBrotherProviderInstalled(provider, options.username)) {
      return {
        success: false,
        output: '',
        error: `${providerLabel(provider)} CLI is not installed`,
        executionTime: Date.now() - startedAt,
        metadata: { provider },
      }
    }

    if (this.terminalProcess) await this.closeTerminalProcess()
    else await stopStaleBigBrotherTerminals()
    await this.closeWorkerProcess()
    this.cleanupJobDirectory()

    this.provider = provider
    this.phase = 'starting'
    this.error = null
    this.cancellationReason = null
    this.lastActivity = new Date()
    this.executionActive = true

    const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metahuman-big-brother-session-'))
    const jobPath = path.join(jobDir, 'job.json')
    const transcriptPath = path.join(jobDir, 'transcript.log')
    const job: WorkerJob = {
      provider,
      prompt,
      username: options.username,
      workingDirectory: options.workingDirectory || ROOT,
      timeout: options.timeout,
      sessionId: options.sessionId,
    }
    fs.writeFileSync(jobPath, JSON.stringify(job), { mode: 0o600 })
    fs.writeFileSync(transcriptPath, '', { mode: 0o600 })
    this.jobDir = jobDir

    fs.mkdirSync(LOG_DIR, { recursive: true })
    const logFd = fs.openSync(path.join(LOG_DIR, 'big-brother-terminal.log'), 'a')
    let terminal: ChildProcess
    try {
      terminal = spawn(TTYD_BIN, [
        '--interface', TERMINAL_HOST,
        '--port', String(BIG_BROTHER_SESSION_PORT),
        '--writable',
        '--max-clients', '1',
        '--signal', '15',
        '--cwd', options.workingDirectory || ROOT,
        TAIL_BIN,
        '--lines=+1',
        '--follow=name',
        '--retry',
        transcriptPath,
      ], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
      })
    } catch (error) {
      fs.closeSync(logFd)
      return this.failedResult(provider, startedAt, error)
    }
    fs.closeSync(logFd)

    this.terminalProcess = terminal
    terminal.once('close', () => {
      if (this.terminalProcess === terminal) this.terminalProcess = null
    })

    try {
      await waitForTerminalPort(terminal)
    } catch (error) {
      await this.closeTerminalProcess()
      return this.failedResult(provider, startedAt, error)
    }

    let worker: ChildProcess
    const workerLogFd = fs.openSync(path.join(LOG_DIR, 'big-brother-terminal.log'), 'a')
    try {
      worker = spawn(process.execPath, [
        '--import', 'tsx',
        WORKER_PATH,
        jobPath,
      ], {
        cwd: options.workingDirectory || ROOT,
        detached: true,
        stdio: ['ignore', workerLogFd, workerLogFd],
      })
    } catch (error) {
      fs.closeSync(workerLogFd)
      await this.closeTerminalProcess()
      return this.failedResult(provider, startedAt, error)
    }
    fs.closeSync(workerLogFd)

    if (!worker.pid) {
      await this.closeTerminalProcess()
      return this.failedResult(provider, startedAt, new Error('Big Brother worker did not return a process ID'))
    }

    this.workerProcess = worker
    worker.once('close', () => {
      if (this.workerProcess === worker) this.workerProcess = null
    })

    this.phase = 'running'
    const terminalInfo = {
      port: BIG_BROTHER_SESSION_PORT,
      url: terminalUrl(),
      provider,
      pid: terminal.pid,
      title: `🤖 Big Brother — ${providerLabel(provider)}`,
    }
    this.emit('ready', terminalInfo)
    this.emit('open_tab', terminalInfo)

    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_session_started',
      details: { provider, promptLength: prompt.length, sessionId: options.sessionId, terminalPid: terminal.pid },
      actor: options.username || 'big-brother-session',
    })
    eventBus.emit('big-brother', EventTypes.BIG_BROTHER_ESCALATION_STARTED, {
      provider,
      port: BIG_BROTHER_SESSION_PORT,
      pid: terminal.pid,
      username: options.username,
    })

    const result = await this.waitForWorkerResult(jobDir, terminal, worker, options)
    this.executionActive = false
    this.phase = result.success ? 'completed' : this.cancellationReason ? 'stopped' : 'failed'
    this.error = result.error || null
    this.lastActivity = new Date()

    eventBus.emit('big-brother', EventTypes.BIG_BROTHER_ESCALATION_COMPLETED, {
      provider,
      status: result.success ? 'success' : 'error',
      responseLength: result.output.length,
      error: result.error,
    }, result.success ? undefined : { level: 'error' })
    audit({
      level: result.success ? 'info' : 'warn',
      category: 'action',
      event: result.success ? 'big_brother_session_completed' : 'big_brother_session_failed',
      details: {
        provider,
        executionTime: result.executionTime,
        outputLength: result.output.length,
        error: result.error,
        sessionId: options.sessionId,
      },
      actor: options.username || 'big-brother-session',
    })

    this.cancellationReason = null
    return result
  }

  async stop(reason = 'Big Brother terminal closed by user'): Promise<void> {
    this.cancellationReason = reason
    await this.closeWorkerProcess()
    await this.closeTerminalProcess()
    await stopStaleBigBrotherTerminals()
    this.executionActive = false
    this.phase = 'stopped'
    this.lastActivity = new Date()
    this.cleanupJobDirectory()
    this.emit('closed', { reason, provider: this.provider })
    audit({
      level: 'info',
      category: 'action',
      event: 'big_brother_session_stopped',
      details: { provider: this.provider, reason },
      actor: 'big-brother-session',
    })
  }

  private failedResult(
    provider: TerminalBigBrotherProvider,
    startedAt: number,
    error: unknown,
  ): BigBrotherSessionResult {
    const message = error instanceof Error ? error.message : 'Failed to start Big Brother terminal'
    this.executionActive = false
    this.phase = 'failed'
    this.error = message
    this.lastActivity = new Date()
    this.cleanupJobDirectory()
    return {
      success: false,
      output: '',
      error: message,
      executionTime: Date.now() - startedAt,
      metadata: { provider },
    }
  }

  private async waitForWorkerResult(
    jobDir: string,
    terminal: ChildProcess,
    worker: ChildProcess,
    options: EscalationOptions,
  ): Promise<BigBrotherSessionResult> {
    const resultPath = path.join(jobDir, 'result.json')
    const eventsPath = path.join(jobDir, 'events.jsonl')
    let processedEventLines = 0
    const timeout = (options.timeout || 300000) + 10000
    const deadline = Date.now() + timeout

    const drainEvents = () => {
      if (!fs.existsSync(eventsPath)) return
      const lines = fs.readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean)
      for (const line of lines.slice(processedEventLines)) {
        try {
          const event = JSON.parse(line) as ParsedBigBrotherEvent
          for (const step of event.reasoningSteps) options.onReasoningStep?.(step)
          if (event.displayLines.length > 0) {
            const content = `${event.displayLines.join('\n')}\n`
            options.onChunk?.(content)
            this.emit('output', { type: 'output', content, timestamp: new Date() })
          }
        } catch {
          // Ignore a partial or malformed observer event; the terminal remains authoritative.
        }
      }
      processedEventLines = lines.length
    }

    while (Date.now() < deadline) {
      drainEvents()
      if (fs.existsSync(resultPath)) {
        const result = JSON.parse(fs.readFileSync(resultPath, 'utf8')) as BigBrotherSessionResult
        drainEvents()
        return result
      }
      if (this.cancellationReason && this.terminalProcess !== terminal) {
        return {
          success: false,
          output: '',
          error: this.cancellationReason,
          executionTime: 0,
          metadata: { provider: this.provider },
        }
      }
      if (terminal.exitCode !== null || terminal.signalCode !== null) {
        await this.closeWorkerProcess()
        return {
          success: false,
          output: '',
          error: this.cancellationReason || 'Big Brother terminal exited before producing a response',
          executionTime: 0,
          metadata: { provider: this.provider, exitCode: terminal.exitCode, signal: terminal.signalCode },
        }
      }
      if (worker.exitCode !== null || worker.signalCode !== null) {
        return {
          success: false,
          output: '',
          error: 'Big Brother worker exited before producing a response',
          executionTime: Date.now() - (deadline - timeout),
          metadata: { provider: this.provider, exitCode: worker.exitCode, signal: worker.signalCode },
        }
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    this.cancellationReason = `Timed out after ${timeout}ms`
    await this.closeWorkerProcess()
    await this.closeTerminalProcess()
    return {
      success: false,
      output: '',
      error: this.cancellationReason,
      executionTime: timeout,
      metadata: { provider: this.provider },
    }
  }

  private async closeTerminalProcess(): Promise<void> {
    const terminal = this.terminalProcess
    if (!terminal?.pid) {
      this.terminalProcess = null
      return
    }

    try {
      process.kill(-terminal.pid, 'SIGTERM')
    } catch {
      try { terminal.kill('SIGTERM') } catch { /* already exited */ }
    }

    await Promise.race([
      new Promise<void>(resolve => terminal.once('close', () => resolve())),
      new Promise<void>(resolve => setTimeout(resolve, 3000)),
    ])

    if (terminal.exitCode === null && terminal.signalCode === null) {
      try { process.kill(-terminal.pid, 'SIGKILL') } catch { /* already exited */ }
    }
    if (this.terminalProcess === terminal) this.terminalProcess = null
  }

  private async closeWorkerProcess(): Promise<void> {
    const worker = this.workerProcess
    if (!worker?.pid) {
      this.workerProcess = null
      return
    }

    try {
      process.kill(-worker.pid, 'SIGTERM')
    } catch {
      try { worker.kill('SIGTERM') } catch { /* already exited */ }
    }

    await Promise.race([
      new Promise<void>(resolve => worker.once('close', () => resolve())),
      new Promise<void>(resolve => setTimeout(resolve, 3000)),
    ])

    if (worker.exitCode === null && worker.signalCode === null) {
      try { process.kill(-worker.pid, 'SIGKILL') } catch { /* already exited */ }
    }
    if (this.workerProcess === worker) this.workerProcess = null
  }

  private cleanupJobDirectory(): void {
    if (!this.jobDir) return
    fs.rmSync(this.jobDir, { recursive: true, force: true })
    this.jobDir = null
  }
}

export const bigBrotherSession = new BigBrotherSessionManager()

export function getBigBrotherSessionState(): BigBrotherSessionState {
  return bigBrotherSession.getState()
}

export async function executeInBigBrotherSession(
  provider: TerminalBigBrotherProvider,
  prompt: string,
  options?: EscalationOptions,
): Promise<BigBrotherSessionResult> {
  return bigBrotherSession.execute(provider, prompt, options)
}

export async function stopBigBrotherSession(reason?: string): Promise<void> {
  return bigBrotherSession.stop(reason)
}
