import http from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { terminalSocket } from './paths.js'
import { TerminalError, type TerminalState, type TerminalProvider, type DiagnosticRequest, type DiagnosticReceipt } from './types.js'
import type { EscalationOptions } from '../escalation-backend.js'
import type { BigBrotherSessionResult, ParsedBigBrotherEvent } from './providers/cli.js'

export async function terminalRequest(path: string, data?: unknown, signal?: AbortSignal): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath: terminalSocket, path, method: data === undefined ? 'GET' : 'POST',
      agent: false, signal, headers: { 'Content-Type': 'application/json' } }, resolve)
    request.once('error', error => {
      const code = (error as NodeJS.ErrnoException).code
      reject(['ENOENT', 'ECONNREFUSED'].includes(code || '')
        ? new TerminalError('Terminal agent is stopped. Start Terminal in Agent Monitor or the terminal panel.', 503) : error)
    })
    request.end(data === undefined ? undefined : JSON.stringify(data))
  })
}
export async function terminalCall<T>(path: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await terminalRequest(path, data, AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]))
  let body = ''
  for await (const chunk of response) {
    body += chunk
    if (body.length > 4 * 1024 * 1024) { response.destroy(); throw new TerminalError('Terminal response is too large') }
  }
  const value = JSON.parse(body)
  if (response.statusCode !== 200) throw new TerminalError(value.error || 'Terminal request failed', response.statusCode)
  return value as T
}
export async function getTerminalState(): Promise<TerminalState> {
  try { return await terminalCall('/state') } catch (error) {
    if (error instanceof TerminalError && error.status === 503) return { status: 'stopped', sessions: [] }
    throw error
  }
}
export async function startTerminalService(actor?: string): Promise<TerminalState> {
  const state = await getTerminalState()
  if (state.status === 'running') return state
  const { getAgentCatalogService } = await import('../agent-catalog.js')
  const entry = getAgentCatalogService().getAgent('terminal')
  if (!entry?.canRun) throw new TerminalError('Terminal service must be registered and enabled in Agent Catalog', 409)
  const { startAgentProcess } = await import('../agent-process-runner.js')
  const result = await startAgentProcess('terminal', { source: 'terminal', actor, useBootstrap: true, checkLock: true, waitForMs: 5000 })
  if (!result.started && !result.alreadyRunning) throw new TerminalError(result.error || 'Terminal agent failed to start')
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await getTerminalState()
    if (state.status === 'running') return state
    await delay(50)
  }
  throw new TerminalError('Terminal agent did not become ready. See Agent Monitor logs.')
}
export async function stopTerminalService(): Promise<void> {
  const { getLockOwnerPid } = await import('../locks.js')
  const ownerPid = getLockOwnerPid('agent-terminal')
  if ((await getTerminalState()).status === 'stopped') {
    const { stopOfflineTerminal } = await import('./recovery.js')
    await stopOfflineTerminal()
    return
  }
  await terminalCall('/stop', {})
  // The response confirms child cleanup. Wait for the service to relinquish
  // its lock/registration as well, before reporting an independent stop.
  for (let attempt = 0; attempt < 100; attempt++) {
    if (getLockOwnerPid('agent-terminal') !== ownerPid) return
    await delay(25)
  }
  throw new TerminalError('Terminal sessions closed, but the agent did not finish shutting down')
}
export async function getBigBrotherSessionState() {
  const state = await getTerminalState()
  const session = state.sessions.find(item => item.kind === 'provider' && !item.diagnostic)
  return { sessionOpen: !!session, processRunning: session?.phase === 'running', provider: session?.provider,
    phase: session?.phase || 'stopped', error: session?.error, id: session?.id }
}
export async function stopBigBrotherSession(): Promise<void> {
  const state = await getBigBrotherSessionState()
  if (state.id) await terminalCall('/close', { id: state.id })
}

export async function submitBigBrotherDiagnostic(request: DiagnosticRequest): Promise<DiagnosticReceipt> {
  await startTerminalService(request.username)
  return terminalCall('/diagnostic', request)
}

export async function executeInBigBrotherSession(provider: TerminalProvider, prompt: string,
  options: EscalationOptions = {}): Promise<BigBrotherSessionResult> {
  options.signal?.throwIfAborted()
  if ((await getTerminalState()).status === 'stopped') await startTerminalService(options.username)
  options.signal?.throwIfAborted()
  const abort = new AbortController()
  const signal = options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal
  const { onReasoningStep, onChunk, onWaitingForInput: _waiting, signal: _signal, ...serializable } = options
  return readProviderResult('/execute', { provider, prompt, options: serializable }, signal, abort, onReasoningStep, onChunk)
}

export async function executeBigBrotherTool(request: DiagnosticRequest, signal?: AbortSignal): Promise<BigBrotherSessionResult> {
  signal?.throwIfAborted()
  await startTerminalService(request.username)
  const abort = new AbortController()
  return readProviderResult('/tool', request, signal ? AbortSignal.any([signal, abort.signal]) : abort.signal, abort)
}

async function readProviderResult(path: string, payload: unknown, signal: AbortSignal, abort: AbortController,
  onReasoningStep?: EscalationOptions['onReasoningStep'], onChunk?: EscalationOptions['onChunk']): Promise<BigBrotherSessionResult> {
  const response = await terminalRequest(path, payload, signal)
  response.setEncoding('utf8')
  let buffered = ''
  try {
    for await (const chunk of response) {
      buffered += chunk
      if (buffered.length > 8 * 1024 * 1024) throw new TerminalError('Provider event exceeds transport limit')
      let end: number
      while ((end = buffered.indexOf('\n\n')) >= 0) {
        const frame = buffered.slice(0, end); buffered = buffered.slice(end + 2)
        if (!frame.startsWith('data: ')) continue
        const event = JSON.parse(frame.slice(6))
        if (event.type === 'error') throw new TerminalError(event.error)
        if (event.type === 'result') return event.result
        if (event.type === 'provider_event') {
          const parsed: ParsedBigBrotherEvent = event.event
          for (const step of parsed.reasoningSteps) onReasoningStep?.(step)
          for (const line of parsed.displayLines) onChunk?.(`${line}\n`)
        }
      }
    }
    throw new TerminalError('Terminal disconnected before Big Brother completed')
  } finally { abort.abort(); response.destroy() }
}
