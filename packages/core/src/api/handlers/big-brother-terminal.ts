import { audit } from '../../audit.js'
import {
  BIG_BROTHER_SESSION_PORT,
  bigBrotherSession,
  getBigBrotherSessionState,
  stopBigBrotherSession,
} from '../../big-brother-session.js'
import type { UnifiedHandler, UnifiedRequest } from '../types.js'
import { streamResponse } from '../types.js'

const LOG_PREFIX = '[api/big-brother-terminal]'

function publicState() {
  const state = getBigBrotherSessionState()
  return {
    ...state,
    running: state.processRunning,
    healthy: state.sessionOpen && !state.error,
    endpoint: `http://localhost:${BIG_BROTHER_SESSION_PORT}`,
  }
}

export const handleBigBrotherStatus: UnifiedHandler = async () => {
  try {
    return { status: 200, data: publicState() }
  } catch (error) {
    console.error(`${LOG_PREFIX} Error getting status:`, error)
    return { status: 500, data: { error: (error as Error).message } }
  }
}

export const handleBigBrotherControl: UnifiedHandler = async req => {
  try {
    const action = req.body?.action
    if (action !== 'stop') {
      return { status: 400, data: { error: 'Invalid action. Big Brother opens on escalation; use stop to close it.' } }
    }

    const beforeState = getBigBrotherSessionState()
    await stopBigBrotherSession('Big Brother terminal closed by user')

    const afterState = getBigBrotherSessionState()
    audit({
      level: 'info',
      category: 'action',
      event: `big_brother_${action}`,
      actor: req.user.username,
      details: {
        provider: afterState.provider,
        beforePid: beforeState.pid,
        afterPid: afterState.pid,
        beforeOpen: beforeState.sessionOpen,
        afterOpen: afterState.sessionOpen,
      },
    })

    return {
      status: 200,
      data: {
        success: true,
        message: 'Big Brother stopped',
        state: publicState(),
      },
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Error:`, error)
    return { status: 500, data: { error: (error as Error).message } }
  }
}

async function* terminalEvents(req: UnifiedRequest): AsyncIterable<string> {
  const queue: string[] = []
  let wake: (() => void) | null = null
  let closed = false

  const push = (payload: Record<string, unknown>): void => {
    queue.push(`data: ${JSON.stringify(payload)}\n\n`)
    if (wake) {
      wake()
      wake = null
    }
  }

  const handleReady = (info: Record<string, unknown>) => push({ type: 'terminal_ready', ...info })
  const handleOpenTab = (info: Record<string, unknown>) => push({ type: 'open_tab', ...info })
  const handleOutput = (event: { type?: string; content?: string }) => {
    push({ type: 'output', content: event.content?.substring(0, 200) })
  }
  const handleClosed = (info: Record<string, unknown>) => push({ type: 'closed', ...info })

  const close = (): void => {
    if (closed) return
    closed = true
    bigBrotherSession.off('ready', handleReady)
    bigBrotherSession.off('open_tab', handleOpenTab)
    bigBrotherSession.off('output', handleOutput)
    bigBrotherSession.off('closed', handleClosed)
    if (wake) {
      wake()
      wake = null
    }
  }

  req.signal?.addEventListener('abort', close, { once: true })

  try {
    push({ type: 'connected' })
    bigBrotherSession.on('ready', handleReady)
    bigBrotherSession.on('open_tab', handleOpenTab)
    bigBrotherSession.on('output', handleOutput)
    bigBrotherSession.on('closed', handleClosed)

    const state = getBigBrotherSessionState()
    if (state.sessionOpen) {
      push({
        type: 'terminal_ready',
        port: state.port,
        url: `http://localhost:${state.port}`,
        provider: state.provider,
        alreadyRunning: state.processRunning,
      })
    }

    while (!closed) {
      while (queue.length > 0) yield queue.shift()!
      if (closed) break
      await new Promise<void>(resolve => { wake = resolve })
    }
  } finally {
    req.signal?.removeEventListener('abort', close)
    close()
  }
}

export const handleBigBrotherTerminalEvents: UnifiedHandler = async req => {
  return streamResponse(terminalEvents(req))
}
