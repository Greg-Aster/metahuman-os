import { apiFetch } from '../../lib/client/api-config'
import { connectionPool, ConnectionPriority, type ConnectionHandle } from '../../lib/client/connection-pool'
import type { TerminalEvent, TerminalSession, TerminalState } from '@metahuman/core/terminal/types'

/** Owns only this mounted view's requests and subscription. Sessions live in the agent. */
export class TerminalController {
  private abort = new AbortController()
  private stream?: ConnectionHandle
  private generation = 0
  private inputQueue = ''
  private sending = false
  private streamId = `terminal-${crypto.randomUUID()}`
  selected = ''
  constructor(private event: (event: TerminalEvent) => void, private error: (message: string) => void) {}
  private async request<T>(path: string, data?: unknown): Promise<T> {
    const res = await apiFetch(`/api/terminal/${path}`, { signal: this.abort.signal,
      ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }) })
    const result = await res.json()
    this.abort.signal.throwIfAborted()
    if (!res.ok) throw new Error(result.error || `Terminal request failed (${res.status})`)
    return result
  }
  async refresh(): Promise<void> {
    const state = await this.request<TerminalState>('state')
    this.event({ type: 'state', state })
    if (state.status === 'running') this.select(state.sessions.some(s => s.id === this.selected) ? this.selected : state.sessions.find(s => s.kind === 'provider')?.id || state.sessions[0]?.id || '')
    else { this.stream?.close(); this.stream = undefined; this.selected = '' }
  }
  async control(action: 'start' | 'stop'): Promise<void> {
    const state = await this.request<TerminalState>('control', { action })
    this.event({ type: 'state', state })
    if (action === 'start') this.select('')
    else { this.generation++; this.stream?.close(); this.stream = undefined; this.selected = '' }
  }
  async create(kind: 'shell' | 'log'): Promise<void> {
    const session = await this.request<TerminalSession>('sessions', { action: 'create', kind, cols: 80, rows: 24 })
    this.select(session.id)
  }
  async close(id: string): Promise<void> {
    await this.request('sessions', { action: 'close', id })
    if (this.selected === id) this.select('')
  }
  select(id: string): void {
    if (this.abort.signal.aborted) return
    this.selected = id
    this.inputQueue = ''
    const generation = ++this.generation
    this.stream?.close()
    this.stream = connectionPool.request({
      id: this.streamId, name: 'Terminal', url: `/api/terminal/events${id ? `?id=${encodeURIComponent(id)}` : ''}`,
      priority: ConnectionPriority.CRITICAL,
      onMessage: message => {
        if (generation !== this.generation || this.abort.signal.aborted) return
        try {
          const event: TerminalEvent = JSON.parse(message.data)
          this.event(event)
          if (event.type === 'error' || (event.type === 'state' && event.state.status !== 'running')) {
            this.stream?.close(); this.stream = undefined
          } else if (event.type === 'state' && !event.state.sessions.some(s => s.id === this.selected)) {
            const next = event.state.sessions.find(s => s.kind === 'provider')?.id || event.state.sessions[0]?.id || ''
            if (next !== this.selected) this.select(next)
          }
        } catch (error) { this.error((error as Error).message) }
      },
      onError: () => {
        if (generation !== this.generation || this.abort.signal.aborted) return
        this.stream?.close(); this.stream = undefined
        this.error('Terminal connection interrupted. Use Reconnect to restore the screen.')
      },
    })
  }
  async resize(cols: number, rows: number): Promise<void> {
    if (this.selected) await this.request('sessions', { action: 'resize', id: this.selected, cols, rows })
  }
  input(data: string): void {
    if (!this.selected || this.abort.signal.aborted) return
    if (this.inputQueue.length + data.length > 65536) { this.error('Input is busy. Wait before sending more text.'); return }
    this.inputQueue += data
    if (!this.sending) void this.flushInput()
  }
  private async flushInput(): Promise<void> {
    this.sending = true
    try {
      while (this.inputQueue && !this.abort.signal.aborted) {
        const data = this.inputQueue; this.inputQueue = ''
        const generation = this.generation
        try { await this.request('sessions', { action: 'input', id: this.selected, data }) }
        catch (error) {
          if (generation === this.generation) {
            this.inputQueue = ''
            if (!this.abort.signal.aborted) this.error((error as Error).message)
          }
        }
      }
    } finally { this.sending = false }
  }
  dispose(): void {
    this.generation++
    this.abort.abort()
    this.inputQueue = ''
    this.stream?.close(); this.stream = undefined
  }
}
