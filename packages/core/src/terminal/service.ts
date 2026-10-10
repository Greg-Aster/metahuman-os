import http, { type ServerResponse } from 'node:http'
import fs from 'node:fs'
import { acquireLock } from '../locks.js'
import { unregisterAgent } from '../agent-monitor-registry.js'
import { TerminalRuntime } from './runtime.js'
import { recoverTerminalProcesses } from './recovery.js'
import { terminalDirectory, terminalSocket, terminalReceipts } from './paths.js'
import { TerminalError, type TerminalEvent } from './types.js'

function send(res: ServerResponse, value: unknown): void {
  if (res.destroyed) return
  if (res.writableLength > 1024 * 1024) { res.destroy(new Error('Terminal viewer is too slow; reconnect for a snapshot')); return }
  res.write(`data: ${JSON.stringify(value)}\n\n`)
}
function stream(res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' })
  res.flushHeaders()
}
async function body(req: http.IncomingMessage): Promise<Record<string, any>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 24 * 1024 * 1024) throw new TerminalError('Terminal request is too large', 413)
    chunks.push(chunk)
  }
  try {
    const value = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object')
    return value
  }
  catch { throw new TerminalError('Invalid JSON request', 400) }
}

/** Private Unix socket only; public authentication remains in the shared API router. */
export async function runTerminalService(): Promise<void> {
  if (process.platform !== 'linux') throw new Error('Terminal service requires Linux process-session ownership')
  const lock = acquireLock('agent-terminal', { exitOnSignal: false })
  let runtime: TerminalRuntime | undefined
  let shutdown: Promise<void> | undefined
  let resolveDone!: () => void
  const done = new Promise<void>(resolve => { resolveDone = resolve })
  const server = http.createServer(async (req, res) => {
    const abort = new AbortController()
    res.once('close', () => abort.abort(new Error('Terminal request disconnected')))
    try {
      const url = new URL(req.url || '/', 'http://terminal')
      const data = req.method === 'POST' ? await body(req) : {}
      const owner = runtime!
      let result: unknown
      if (req.method === 'GET' && url.pathname === '/state') result = owner.state()
      else if (req.method === 'GET' && url.pathname === '/events') {
        const id = url.searchParams.get('id')
        let ready = false
        const onEvent = (event: TerminalEvent) => {
          if (!ready || (event.type === 'output' && event.id !== id)) return
          send(res, event)
        }
        owner.on('event', onEvent)
        let heartbeat: NodeJS.Timeout | undefined
        res.once('close', () => { owner.off('event', onEvent); clearInterval(heartbeat) })
        try {
          const snapshot = id ? await owner.snapshot(id) : undefined
          if (abort.signal.aborted) return
          stream(res)
          send(res, { type: 'state', state: owner.state() })
          if (snapshot) send(res, snapshot)
          ready = true
          heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n') }, 15000)
        } catch (error) { owner.off('event', onEvent); throw error }
        return
      } else if (req.method === 'POST' && url.pathname === '/create') {
        if (data.kind !== 'shell' && data.kind !== 'log') throw new TerminalError('Invalid terminal kind', 400)
        result = owner.create(data.kind, data.cols, data.rows)
      } else if (req.method === 'POST' && url.pathname === '/input') { owner.input(data.id, data.data); result = { success: true } }
      else if (req.method === 'POST' && url.pathname === '/resize') { owner.resize(data.id, data.cols, data.rows); result = { success: true } }
      else if (req.method === 'POST' && url.pathname === '/close') { await owner.close(data.id); result = { success: true } }
      else if (req.method === 'POST' && url.pathname === '/diagnostic') {
        if (typeof data.prompt !== 'string' || typeof data.reasoning !== 'boolean'
          || (data.model !== undefined && typeof data.model !== 'string')) throw new TerminalError('Invalid diagnostic request', 400)
        result = await owner.submitDiagnostic(data as import('./types.js').DiagnosticRequest)
      } else if (req.method === 'POST' && url.pathname === '/diagnostic-input') {
        if (typeof data.message !== 'string') throw new TerminalError('Invalid diagnostic message', 400)
        result = await owner.diagnosticInput(data.id, data.message)
      }
      else if (req.method === 'POST' && url.pathname === '/execute') {
        if (!['claude-code', 'codex'].includes(data.provider) || typeof data.prompt !== 'string') throw new TerminalError('Invalid provider request', 400)
        stream(res)
        const execution = await owner.execute(data.provider, data.prompt, data.options || {}, abort.signal,
          event => send(res, { type: 'provider_event', event }))
        send(res, { type: 'result', result: execution })
        res.end()
        return
      } else if (req.method === 'POST' && url.pathname === '/stop') {
        await stopSessions()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }), finish)
        return
      } else throw new TerminalError('Unknown terminal operation', 404)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    } catch (error) {
      const message = (error as Error).message
      if (res.headersSent) { send(res, { type: 'error', error: message }); res.end() }
      else { res.writeHead(error instanceof TerminalError ? error.status : 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: message })) }
    }
  })
  const stopSessions = (): Promise<void> => {
    if (!shutdown) shutdown = runtime!.stop().catch(error => { shutdown = undefined; throw error })
    return shutdown
  }
  const finish = () => {
    server.close()
    server.closeAllConnections()
    resolveDone()
  }
  const onSignal = () => {
    void stopSessions().then(finish, error => {
      // Stay alive with receipts intact so the operator can retry the failed stop.
      console.error('[terminal] Shutdown failed:', error)
    })
  }
  try {
    fs.mkdirSync(terminalDirectory, { recursive: true, mode: 0o700 })
    fs.chmodSync(terminalDirectory, 0o700)
    await recoverTerminalProcesses()
    runtime = new TerminalRuntime(terminalReceipts)
    fs.rmSync(terminalSocket, { force: true })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(terminalSocket, () => {
        try { fs.chmodSync(terminalSocket, 0o600); resolve() } catch (error) { reject(error) }
      })
    })
    process.on('SIGTERM', onSignal)
    process.on('SIGINT', onSignal)
    console.log('[terminal] Ready; no shell sessions started')
    await done
  } finally {
    process.off('SIGTERM', onSignal)
    process.off('SIGINT', onSignal)
    server.close()
    server.closeAllConnections()
    fs.rmSync(terminalSocket, { force: true })
    // The runner may launch through a tsx wrapper. The exclusive service lock
    // proves this registration still belongs to us during shutdown.
    unregisterAgent('terminal')
    lock.release()
  }
}
