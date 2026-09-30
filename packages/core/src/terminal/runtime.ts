import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import * as pty from 'node-pty'
import { ROOT, systemPaths } from '../path-builder.js'
import type { EscalationOptions } from '../escalation-backend.js'
import { audit } from '../audit.js'
import { eventBus } from '../infrastructure/event-bus/client.js'
import { EventTypes } from '../infrastructure/event-bus/schema.js'
import { TerminalScreen } from './screen.js'
import { TerminalProcess } from './process.js'
import { TerminalError, dimensions, type TerminalEvent, type TerminalSession, type TerminalState, type TerminalProvider } from './types.js'
import { runProvider } from './providers/session.js'
import type { BigBrotherSessionResult, ParsedBigBrotherEvent } from './providers/cli.js'

interface OwnedSession {
  info: TerminalSession
  screen: TerminalScreen
  close: () => Promise<void>
  input?: (data: string) => void
  resize?: (cols: number, rows: number) => void
  closing?: Promise<void>
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
      for (const old of this.sessions.values()) if (old.info.kind === 'provider') await this.close(old.info.id)
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
    } finally { this.providerActive = false; this.changed() }
  }
  async stop(): Promise<void> {
    this.status = 'stopping'; this.changed()
    const results = await Promise.allSettled([...this.sessions.keys()].map(id => this.close(id)))
    const failures = results.filter(result => result.status === 'rejected') as PromiseRejectedResult[]
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Failed to stop terminal sessions')
    this.status = 'stopped'; this.changed()
  }
}
