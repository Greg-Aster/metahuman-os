import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import path from 'node:path'
import * as pty from 'node-pty'
import { ROOT, systemPaths } from '../path-builder.js'
import type { EscalationOptions } from '../escalation-backend.js'
import { audit } from '../audit.js'
import { eventBus } from '../infrastructure/event-bus/client.js'
import { EventTypes } from '../infrastructure/event-bus/schema.js'
import { TerminalScreen } from './screen.js'
import { TerminalProcess } from './process.js'
import { TerminalError, dimensions, type TerminalEvent, type TerminalSession, type TerminalState, type TerminalProvider, type DiagnosticRequest, type DiagnosticReceipt } from './types.js'
import { appendDiagnosticLog, bigBrotherRepairLog } from './diagnostics.js'
import { runProvider } from './providers/session.js'
import { terminalHeading } from './presentation.js'
import type { BigBrotherSessionResult, ParsedBigBrotherEvent } from './providers/cli.js'

interface OwnedSession {
  info: TerminalSession
  screen: TerminalScreen
  close: () => Promise<void>
  input?: (data: string) => void
  resize?: (cols: number, rows: number) => void
  closing?: Promise<void>
  ready?: Promise<void>
  diagnostic?: {
    username?: string
    request: DiagnosticRequest
    pending: Array<{ id: string; receivedAt: string; request: DiagnosticRequest; complete?: (result: BigBrotherSessionResult) => void }>
    abort: AbortController
    finished?: Promise<void>
    cleanup?: () => Promise<void>
  }
}

/** Service-local owner. Construction starts no shells, timers, listeners, or providers. */
export class TerminalRuntime extends EventEmitter {
  private sessions = new Map<string, OwnedSession>()
  private status: TerminalState['status'] = 'running'
  private providerActive = false
  constructor(readonly receipts: string) { super() }
  state(): TerminalState { return { status: this.status, sessions: [...this.sessions.values()].map(s => ({ ...s.info })) } }
  private changed(): void { this.emit('event', { type: 'state', state: this.state() } satisfies TerminalEvent) }
  private admit(): void {
    if (this.status !== 'running') throw new TerminalError('Terminal agent is stopping', 409)
    if (this.sessions.size >= 10) throw new TerminalError('Close a terminal before opening another (limit 10)', 409)
  }
  private get(id: string): OwnedSession {
    const session = this.sessions.get(id)
    if (!session) throw new TerminalError('Terminal session no longer exists', 404)
    return session
  }
  private async write(session: OwnedSession, data: string): Promise<void> {
    await session.screen.write(data)
    this.emit('event', { type: 'output', id: session.info.id, data } satisfies TerminalEvent)
  }
  async snapshot(id: string): Promise<TerminalEvent> {
    const session = this.get(id)
    return { type: 'screen', id, data: await session.screen.snapshot(), cols: session.info.cols, rows: session.info.rows }
  }

  create(kind: 'shell' | 'log', cols = 80, rows = 24): TerminalSession {
    this.admit()
    dimensions(cols, rows)
    const id = randomUUID()
    const screen = new TerminalScreen(cols, rows)
    let child: pty.IPty
    try {
      child = kind === 'log'
        ? pty.spawn('tail', ['-n', '100', '-F', path.join(systemPaths.logs, 'server.log')], { cwd: ROOT, cols, rows, name: 'xterm-256color' })
        : pty.spawn(process.env.SHELL || '/bin/bash', [], { cwd: ROOT, cols, rows, name: 'xterm-256color', env: process.env as Record<string, string> })
    } catch (error) { screen.dispose(); throw error }
    child.onExit(() => {}) // PTY errors/exits always have an owner, including failed exec.
    let owned: TerminalProcess
    try { owned = TerminalProcess.record(child.pid, this.receipts) } catch (error) {
      child.kill('SIGKILL'); screen.dispose(); throw error
    }
    const session: OwnedSession = {
      info: { id, kind, title: kind === 'log' ? 'Server log' : 'Shell', phase: 'running', cols, rows }, screen,
      close: () => owned.stop(),
      input: kind === 'shell' ? data => child.write(data) : undefined,
      resize: (c, r) => child.resize(c, r),
    }
    this.sessions.set(id, session)
    child.onData(data => {
      child.pause()
      this.write(session, data).then(() => child.resume(), error => {
        session.info.error = error.message; session.info.phase = 'failed'; this.changed()
        this.close(id).catch(cleanup => { session.info.error = cleanup.message; this.changed() })
      })
    })
    child.onExit(({ exitCode }) => {
      session.info.phase = exitCode === 0 ? 'completed' : 'failed'
      if (exitCode !== 0) session.info.error = `Process exited with code ${exitCode}`
      owned.stop().catch(error => { session.info.error = error.message; session.info.phase = 'failed' })
        .finally(() => this.changed())
    })
    this.changed()
    return { ...session.info }
  }

  input(id: string, data: unknown): void {
    const session = this.get(id)
    if (typeof data !== 'string' || Buffer.byteLength(data) > 65536) throw new TerminalError('Input must be at most 64 KiB', 400)
    if (this.status !== 'running' || session.info.phase !== 'running' || !session.input) throw new TerminalError('Terminal is not accepting input', 409)
    session.input(data)
  }
  resize(id: string, cols: unknown, rows: unknown): void {
    const size = dimensions(cols, rows)
    const session = this.get(id)
    if (session.closing) throw new TerminalError('Terminal is closing', 409)
    session.resize?.(size.cols, size.rows)
    session.screen.resize(size.cols, size.rows)
    Object.assign(session.info, size)
    this.changed()
  }
  async close(id: string): Promise<void> {
    const session = this.get(id)
    if (session.closing) return session.closing
    session.info.phase = 'stopping'; this.changed()
    session.closing = (async () => {
      try {
        await session.close()
        await session.screen.snapshot() // drain pending writes before disposing
        session.screen.dispose()
        this.sessions.delete(id)
      } catch (error) {
        session.info.phase = 'failed'
        session.info.error = (error as Error).message
        throw error
      } finally { session.closing = undefined; this.changed() }
    })()
    return session.closing
  }

  async execute(provider: TerminalProvider, prompt: string, options: EscalationOptions, signal: AbortSignal,
    observe: (event: ParsedBigBrotherEvent) => void): Promise<BigBrotherSessionResult> {
    if (this.providerActive) throw new TerminalError('Big Brother already has an active execution', 409)
    this.admit()
    // Reserve synchronously before any cleanup or initialization can yield.
    this.providerActive = true
    const cancellation = new AbortController()
    const combined = AbortSignal.any([signal, cancellation.signal])
    let session: OwnedSession | undefined
    try {
      for (const old of this.sessions.values()) if (old.info.kind === 'provider' && !old.diagnostic) await this.close(old.info.id)
      combined.throwIfAborted()
      if (this.status !== 'running') throw new TerminalError('Terminal agent is stopping', 409)
      const id = randomUUID()
      session = { info: { id, kind: 'provider', provider, title: `Big Brother · ${provider}`, phase: 'running', cols: 100, rows: 30 },
        screen: new TerminalScreen(100, 30), close: async () => {} }
      const current = session
      this.sessions.set(id, current)
      let cleanup: (() => Promise<void>) | undefined
      const finished = runProvider(provider, prompt, options, this.receipts, combined,
        data => this.write(current, data), observe, release => { cleanup = release })
      current.close = async () => {
        cancellation.abort(new Error('Big Brother terminal closed'))
        try { await finished } catch (error) {
          if (!cleanup) throw error
          // A failed stop retains the actual process owner for a later retry.
          await cleanup()
        }
      }
      audit({ level: 'info', category: 'action', event: 'big_brother_session_started', actor: options.username || 'terminal', details: { provider, id, sessionId: options.sessionId } })
      eventBus.emit('big-brother', EventTypes.BIG_BROTHER_ESCALATION_STARTED, { provider, id, username: options.username })
      this.changed()
      const result = await finished
      current.info.phase = result.success ? 'completed' : 'failed'
      current.info.error = result.error
      audit({ level: result.success ? 'info' : 'error', category: 'action', event: result.success ? 'big_brother_session_completed' : 'big_brother_session_failed', actor: options.username || 'terminal', details: { provider, id, error: result.error } })
      eventBus.emit('big-brother', EventTypes.BIG_BROTHER_ESCALATION_COMPLETED, { provider, id, success: result.success })
      await this.write(current, `\r\n${result.success ? 'Completed. Final response sent to chat.' : result.error}\r\n`)
      return result
    } catch (error) {
      if (session) { session.info.phase = 'failed'; session.info.error = (error as Error).message }
      throw error
    } finally { this.providerActive = false; this.changed(); this.pumpDiagnostics() }
  }

  async submitDiagnostic(request: DiagnosticRequest, complete?: (result: BigBrotherSessionResult) => void): Promise<DiagnosticReceipt> {
    let session = [...this.sessions.values()].find(item => item.diagnostic?.username === request.username && item.diagnostic
      && item.diagnostic.request.toolTaskId === request.toolTaskId)
    if (!session) {
      this.admit()
      const id = randomUUID()
      const diagnostic: NonNullable<OwnedSession['diagnostic']> = {
        username: request.username, request, pending: [], abort: new AbortController(),
      }
      session = {
        info: { id, kind: 'provider', provider: 'codex', title: request.toolTaskId ? 'Big Brother Tools' : 'Big Brother Diagnostics', phase: 'completed',
          cols: 100, rows: 30, diagnostic: { pending: 0, repairLog: bigBrotherRepairLog } },
        screen: new TerminalScreen(100, 30), diagnostic, close: async () => {},
      }
      const current = session
      this.sessions.set(id, current)
      let desktop: TerminalProcess | undefined
      current.close = async () => {
        diagnostic.abort.abort(new Error('Big Brother diagnostic terminal closed'))
        // Finish admission before releasing the desktop process acquired by it.
        if (current.ready) await Promise.allSettled([current.ready])
        await diagnostic.finished
        await diagnostic.cleanup?.()
        await desktop?.stop()
        for (const pending of diagnostic.pending.splice(0)) {
          if (!pending.request.toolTaskId) appendDiagnosticLog(pending.id, 'cancelled', 'Terminal closed before this submission ran.')
          pending.complete?.({ success: false, output: '', error: 'Terminal closed before this submission ran.', executionTime: 0, metadata: {} })
        }
      }
      current.ready = (async () => {
        // The desktop window is a view of this owner, not another provider process.
        const child = spawn('x-terminal-emulator', ['-T', 'MetaHuman Big Brother', '-e',
          path.join(ROOT, 'bin', 'mh'), 'terminal', 'view', id], {
          cwd: ROOT, detached: true, env: process.env, stdio: ['ignore', 'ignore', 'pipe'],
        })
        let stderr = ''
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192) })
        await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
        desktop = TerminalProcess.record(child.pid!, this.receipts)
        child.once('close', code => {
          if (current.closing || !this.sessions.has(id)) return
          if (code !== 0) {
            current.info.error = stderr.trim() || `Desktop terminal exited with code ${code}`
            try { if (!request.toolTaskId) appendDiagnosticLog(id, 'desktop failed', current.info.error) }
            catch (error) { console.error('[big-brother-diagnostic] Cannot record desktop failure:', error) }
          }
          void this.close(id).catch(error => { current.info.error = error.message; this.changed() })
        })
      })()
    }
    try { await session.ready }
    catch (error) {
      if (this.sessions.has(session.info.id)) await this.close(session.info.id)
      throw error
    }
    if (session.closing || !this.sessions.has(session.info.id) || this.status !== 'running') throw new TerminalError('Terminal session is closed or stopping', 409)
    const id = randomUUID()
    const diagnostic = session.diagnostic!
    if (!request.toolTaskId) appendDiagnosticLog(id, 'submitted', JSON.stringify({ username: request.username, source: request.source, data: request.data }, null, 2))
    diagnostic.pending.push({ id, receivedAt: new Date().toISOString(), request, complete })
    diagnostic.request = request
    session.info.diagnostic!.pending = diagnostic.pending.length
    this.changed()
    this.pumpDiagnostics()
    return { sessionId: session.info.id, submissionId: id, status: 'submitted' }
  }

  async executeTool(request: DiagnosticRequest, signal: AbortSignal): Promise<BigBrotherSessionResult> {
    signal.throwIfAborted()
    let complete!: (result: BigBrotherSessionResult) => void
    const finished = new Promise<BigBrotherSessionResult>(resolve => { complete = resolve })
    const receipt = await this.submitDiagnostic(request, complete)
    const cancel = () => { void this.close(receipt.sessionId).catch(error => {
      complete({ success: false, output: '', error: String(error), executionTime: 0, metadata: {} })
    }) }
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    try { return await finished } finally { signal.removeEventListener('abort', cancel) }
  }

  async diagnosticInput(id: string, message: string): Promise<DiagnosticReceipt> {
    const session = this.get(id)
    if (!session.diagnostic) throw new TerminalError('Not a diagnostic session', 400)
    return this.submitDiagnostic({ ...session.diagnostic.request, data: message, source: { terminalSessionId: id, speaker: 'operator' } })
  }

  private pumpDiagnostics(): void {
    if (this.providerActive || this.status !== 'running') return
    const session = [...this.sessions.values()].find(item => item.diagnostic?.pending.length && !item.closing)
    if (!session) return
    const diagnostic = session.diagnostic!
    const submission = diagnostic.pending.shift()!
    const state = session.info.diagnostic!
    state.pending = diagnostic.pending.length
    state.submissionId = submission.id
    session.info.phase = 'running'
    session.info.error = undefined
    this.providerActive = true
    this.changed()
    diagnostic.finished = (async () => {
      try {
        await diagnostic.cleanup?.()
        diagnostic.cleanup = undefined
        const request = submission.request
        const prompt = `${request.prompt}\n\n${JSON.stringify({
          ...(!request.toolTaskId ? { repairLog: bigBrotherRepairLog } : { taskId: request.toolTaskId }), submissionId: submission.id,
          receivedAt: submission.receivedAt, source: request.source, data: request.data,
        }, null, 2)}`
        await this.write(session, terminalHeading(`${request.toolTaskId ? 'Tool task' : 'Diagnostic'} ${submission.id}`))
        const result = await runProvider('codex', prompt, {
          username: request.username,
          diagnostic: { model: request.model, reasoning: request.reasoning, threadId: state.threadId },
        }, this.receipts, diagnostic.abort.signal, data => this.write(session, data), event => {
          if (event.threadId) { state.threadId = event.threadId; this.changed() }
        }, cleanup => { diagnostic.cleanup = cleanup })
        diagnostic.cleanup = undefined
        session.info.phase = result.success ? 'completed' : 'failed'
        session.info.error = result.error
        if (!request.toolTaskId) appendDiagnosticLog(submission.id, result.success ? 'agent turn completed' : 'agent turn failed',
          [result.output, result.error].filter(Boolean).join('\n\n'))
        await this.write(session, terminalHeading(result.success ? 'Agent turn completed.' : result.error || 'Agent turn failed.',
          result.success ? 'success' : 'error'))
        submission.complete?.(result)
      } catch (error) {
        session.info.phase = 'failed'
        session.info.error = (error as Error).message
        console.error('[big-brother-diagnostic]', error)
        submission.complete?.({ success: false, output: '', error: session.info.error, executionTime: 0, metadata: {} })
        await this.write(session, terminalHeading(session.info.error!, 'error'))
      } finally {
        this.providerActive = false
        this.changed()
      }
    })()
    void diagnostic.finished.then(() => {
      // Do not lose a process receipt if the existing cleanup owner reports failure.
      if (!diagnostic.cleanup) this.pumpDiagnostics()
    }, error => { console.error('[big-brother-diagnostic] Terminal output failed:', error) })
  }
  async stop(): Promise<void> {
    this.status = 'stopping'; this.changed()
    const results = await Promise.allSettled([...this.sessions.keys()].map(id => this.close(id)))
    const failures = results.filter(result => result.status === 'rejected') as PromiseRejectedResult[]
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Failed to stop terminal sessions')
    this.status = 'stopped'; this.changed()
  }
}
