import WebSocket from 'ws'
import { validateSession } from '../../sessions.js'
import { streamResponse, type UnifiedHandler } from '../types.js'

/** The legacy debug page uses authenticated same-origin transport, never a public bus socket. */
export const handleEventBusStream: UnifiedHandler = async req => {
  if (!req.sessionId) return { status: 401, error: 'Authentication required' }
  return streamResponse((async function* () {
    const socket = new WebSocket('ws://127.0.0.1:3100')
    const queue: string[] = []
    let bytes = 0
    let closed = false
    let wake: (() => void) | undefined
    const close = () => { closed = true; socket.terminate(); wake?.() }
    const push = (text: string) => {
      bytes += text.length
      if (bytes > 1024 * 1024) { close(); return }
      queue.push(text); wake?.()
    }
    socket.on('message', data => push(`data: ${data.toString()}\n\n`))
    socket.on('error', error => { push(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`); close() })
    socket.on('close', () => { closed = true; wake?.() })
    const timer = setInterval(() => push(': heartbeat\n\n'), 15000)
    req.signal?.addEventListener('abort', close, { once: true })
    if (req.signal?.aborted) close()
    try {
      while (!closed || queue.length) {
        const session = validateSession(req.sessionId!)
        if (!session || session.userId !== req.user.userId || session.role !== 'owner') break
        while (queue.length) { const item = queue.shift()!; bytes -= item.length; yield item }
        if (!closed) await new Promise<void>(resolve => { wake = resolve })
      }
    } finally { clearInterval(timer); req.signal?.removeEventListener('abort', close); close() }
  })())
}
