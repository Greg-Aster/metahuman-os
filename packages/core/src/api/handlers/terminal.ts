import type { UnifiedHandler } from '../types.js'
import { streamResponse } from '../types.js'
import { validateSession } from '../../sessions.js'
import { getTerminalState, startTerminalService, stopTerminalService, terminalCall, terminalRequest } from '../../terminal/client.js'
import { TerminalError } from '../../terminal/types.js'
import { audit } from '../../audit.js'

function failure(error: unknown) {
  return { status: error instanceof TerminalError ? error.status : 500, data: { error: (error as Error).message } }
}
export const handleTerminalState: UnifiedHandler = async () => {
  try { return { status: 200, data: await getTerminalState() } } catch (error) { return failure(error) }
}
export const handleTerminalControl: UnifiedHandler = async req => {
  try {
    const action = req.body?.action
    if (action === 'start') await startTerminalService(req.user.username)
    else if (action === 'stop') await stopTerminalService()
    else throw new TerminalError('Expected start or stop', 400)
    audit({ level: 'info', category: 'action', event: `terminal_${action}`, actor: req.user.username })
    return { status: 200, data: await getTerminalState() }
  } catch (error) { return failure(error) }
}
export const handleTerminalSession: UnifiedHandler = async req => {
  try {
    const { action, ...data } = req.body || {}
    if (!['create', 'input', 'resize', 'close'].includes(action)) throw new TerminalError('Invalid terminal action', 400)
    const result = await terminalCall(`/${action}`, data, req.signal)
    if (action === 'create' || action === 'close') audit({ level: 'info', category: 'action', event: `terminal_session_${action}`, actor: req.user.username, details: { id: data.id, kind: data.kind } })
    return { status: 200, data: result }
  } catch (error) { return failure(error) }
}
export const handleTerminalEvents: UnifiedHandler = async req => {
  try {
    if (!req.sessionId) throw new TerminalError('Authentication required', 401)
    const abort = new AbortController()
    const signal = req.signal ? AbortSignal.any([req.signal, abort.signal]) : abort.signal
    const response = await terminalRequest(`/events${req.query?.id ? `?id=${encodeURIComponent(req.query.id)}` : ''}`, undefined, signal)
    if (response.statusCode !== 200) {
      let data = ''
      for await (const chunk of response) data += chunk
      throw new TerminalError(JSON.parse(data).error, response.statusCode)
    }
    response.setEncoding('utf8')
    const stream = (async function* () {
      try {
        for await (const chunk of response) {
          // Includes heartbeats, so expiry/logout closes even a quiet terminal.
          const session = validateSession(req.sessionId!)
          if (!session || session.userId !== req.user.userId || session.role !== 'owner') {
            yield `data: ${JSON.stringify({ type: 'error', error: 'Terminal access expired. Sign in again.' })}\n\n`
            break
          }
          yield String(chunk)
        }
      } finally { abort.abort(); response.destroy() }
    })()
    return { ...streamResponse(stream), headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } }
  } catch (error) { return failure(error) }
}
