import type { IncomingMessage, ServerResponse } from 'node:http'
import { URL } from 'node:url'
import type { RobotFriendConfig } from './config.js'
import type { MetaHumanSession } from './session.js'

type ProxyMode = 'json' | 'binary' | 'audio'

const ALLOWED_DIRECT_PATHS = new Set([
  '/api/status',
  '/api/runtime/mode',
  '/api/voice-settings',
  '/api/tts',
  '/api/pause-state',
])

export interface ProxyContext {
  config: RobotFriendConfig
  session: MetaHumanSession
}

export async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function proxyRobotApi(req: IncomingMessage, res: ServerResponse, context: ProxyContext): Promise<boolean> {
  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
  const pathname = requestUrl.pathname

  if (!pathname.startsWith('/robot/api/')) {
    return false
  }

  if (pathname === '/robot/api/chat' && req.method === 'POST') {
    await proxyJson(req, res, context, '/api/persona_chat', 'POST', { forceStreamFalse: true })
    return true
  }

  if (pathname === '/robot/api/cancel' && req.method === 'POST') {
    await proxyJson(req, res, context, '/api/persona_chat/cancel', 'POST')
    return true
  }

  if (pathname === '/robot/api/stt' && req.method === 'POST') {
    const suffix = requestUrl.search || '?format=webm'
    await proxyRaw(req, res, context, `/api/stt${suffix}`, 'POST', 'audio')
    return true
  }

  if (pathname === '/robot/api/tts' && req.method === 'POST') {
    await proxyRaw(req, res, context, '/api/tts', 'POST', 'binary')
    return true
  }

  if (pathname === '/robot/api/tts-status' && req.method === 'GET') {
    await proxyJson(req, res, context, '/api/tts', 'GET')
    return true
  }

  if (pathname === '/robot/api/pause-state' && (req.method === 'GET' || req.method === 'POST')) {
    await proxyRaw(req, res, context, '/api/pause-state', req.method, 'json')
    return true
  }

  if (pathname === '/robot/api/main-status' && req.method === 'GET') {
    await proxyJson(req, res, context, '/api/status', 'GET')
    return true
  }

  if (pathname === '/robot/api/runtime-mode' && req.method === 'GET') {
    await proxyJson(req, res, context, '/api/runtime/mode', 'GET')
    return true
  }

  if (pathname === '/robot/api/voice-settings' && req.method === 'GET') {
    await proxyJson(req, res, context, '/api/voice-settings', 'GET')
    return true
  }

  sendJson(res, 404, { error: 'Robot Friend API route is not allowlisted' })
  return true
}

async function proxyJson(
  req: IncomingMessage,
  res: ServerResponse,
  context: ProxyContext,
  targetPath: string,
  method: string,
  options: { forceStreamFalse?: boolean } = {}
): Promise<void> {
  if (!ALLOWED_DIRECT_PATHS.has(targetPath) && !targetPath.startsWith('/api/persona_chat')) {
    sendJson(res, 403, { error: 'Target path is not allowlisted' })
    return
  }

  let body: any = undefined
  const raw = await readRequestBody(req)
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw.toString('utf8'))
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' })
      return
    }
  }

  if (options.forceStreamFalse) {
    body = { ...(body ?? {}), mode: 'conversation', stream: false }
  }

  await forwardToMetaHuman(res, context, targetPath, {
    method,
    body: body === undefined ? undefined : Buffer.from(JSON.stringify(body)),
    contentType: body === undefined ? undefined : 'application/json',
    mode: 'json',
  })
}

async function proxyRaw(
  req: IncomingMessage,
  res: ServerResponse,
  context: ProxyContext,
  targetPath: string,
  method: string,
  mode: ProxyMode
): Promise<void> {
  const body = method === 'GET' ? undefined : await readRequestBody(req)
  const contentType = req.headers['content-type']

  await forwardToMetaHuman(res, context, targetPath, {
    method,
    body,
    contentType: Array.isArray(contentType) ? contentType[0] : contentType,
    mode,
  })
}

async function forwardToMetaHuman(
  res: ServerResponse,
  context: ProxyContext,
  targetPath: string,
  request: {
    method: string
    body?: Buffer
    contentType?: string
    mode: ProxyMode
  }
): Promise<void> {
  let cookie: string
  try {
    cookie = await context.session.getSessionCookie()
  } catch (error) {
    sendJson(res, 502, {
      error: 'Failed to authenticate with MetaHuman server',
      detail: (error as Error).message,
    })
    return
  }

  const response = await fetchWithSession(context, targetPath, request, cookie)

  if (response.status === 401 || response.status === 403) {
    context.session.clear(`Session rejected with ${response.status}`)
    try {
      cookie = await context.session.getSessionCookie(true)
      const retry = await fetchWithSession(context, targetPath, request, cookie)
      await pipeResponse(res, retry, request.mode)
      return
    } catch (error) {
      sendJson(res, 502, {
        error: 'Failed to refresh MetaHuman session',
        detail: (error as Error).message,
      })
      return
    }
  }

  await pipeResponse(res, response, request.mode)
}

async function fetchWithSession(
  context: ProxyContext,
  targetPath: string,
  request: {
    method: string
    body?: Buffer
    contentType?: string
    mode: ProxyMode
  },
  cookie: string
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), context.config.server.requestTimeoutMs)

  try {
    return await fetch(`${context.config.server.url}${targetPath}`, {
      method: request.method,
      headers: {
        Accept: request.mode === 'binary' ? 'audio/wav,*/*' : 'application/json',
        Cookie: cookie,
        ...(request.contentType ? { 'Content-Type': request.contentType } : {}),
      },
      body: request.body,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function pipeResponse(res: ServerResponse, response: Response, mode: ProxyMode): Promise<void> {
  const headers: Record<string, string> = {}
  const contentType = response.headers.get('content-type')
  if (contentType) headers['Content-Type'] = contentType
  if (mode === 'binary' && !headers['Content-Type']) headers['Content-Type'] = 'audio/wav'

  res.writeHead(response.status, headers)
  const body = Buffer.from(await response.arrayBuffer())
  res.end(body)
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}
