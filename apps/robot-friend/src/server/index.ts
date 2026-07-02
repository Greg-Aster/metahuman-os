import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { appRoot, loadConfig, publicConfig } from './config.js'
import { MetaHumanSession } from './session.js'
import { proxyRobotApi, sendJson } from './proxy.js'

const { config, path: configPath, exists: configExists } = loadConfig()
const session = new MetaHumanSession(config)
const isDev = process.env.ROBOT_FRIEND_DEV === '1'
const root = appRoot()
const distDir = path.join(root, 'dist')

const vite = isDev
  ? await import('vite').then(({ createServer }) =>
      createServer({
        root,
        server: { middlewareMode: true },
        appType: 'spa',
      })
    )
  : null

const protocol = config.app.https.enabled ? 'https' : 'http'
const server = createRobotServer(async (req, res) => {
  try {
    const handled = await handleLocalApi(req, res)
    if (handled) return

    const proxied = await proxyRobotApi(req, res, { config, session })
    if (proxied) return

    if (vite) {
      vite.middlewares(req, res, () => {
        sendJson(res, 404, { error: 'Not found' })
      })
      return
    }

    serveStatic(req, res)
  } catch (error) {
    console.error('[robot-friend] Request failed:', error)
    sendJson(res, 500, { error: (error as Error).message })
  }
})

server.on('error', error => {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EADDRINUSE') {
    console.error(`[robot-friend] Port ${config.app.port} is already in use.`)
  } else if (code === 'EACCES' || code === 'EPERM') {
    console.error(`[robot-friend] Cannot listen on ${config.app.host}:${config.app.port}: permission denied.`)
  } else {
    console.error('[robot-friend] Server failed:', (error as Error).message)
  }
  process.exit(1)
})

server.listen(config.app.port, config.app.host, () => {
  const url = `${protocol}://${config.app.host}:${config.app.port}`
  console.log(`[robot-friend] Listening at ${url}`)
  for (const accessUrl of accessUrls(protocol, config.app.host, config.app.port)) {
    console.log(`[robot-friend] Network URL: ${accessUrl}`)
  }
  console.log(`[robot-friend] MetaHuman server: ${config.server.url}`)
  console.log(`[robot-friend] Config: ${configExists ? configPath : `${configPath} (missing, using defaults)`}`)
})

function createRobotServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>,
): http.Server | https.Server {
  if (!config.app.https.enabled) {
    return http.createServer(handler)
  }

  if (!config.app.https.keyPath || !config.app.https.certPath) {
    throw new Error('HTTPS is enabled but app.https.keyPath and app.https.certPath are not configured.')
  }

  return https.createServer({
    key: fs.readFileSync(path.resolve(root, config.app.https.keyPath)),
    cert: fs.readFileSync(path.resolve(root, config.app.https.certPath)),
  }, handler)
}

function accessUrls(protocolName: 'http' | 'https', host: string, port: number): string[] {
  if (host !== '0.0.0.0' && host !== '::') return []

  const urls: string[] = []
  try {
    for (const interfaces of Object.values(os.networkInterfaces())) {
      for (const address of interfaces ?? []) {
        if (address.family !== 'IPv4' || address.internal) continue
        urls.push(`${protocolName}://${address.address}:${port}`)
      }
    }
  } catch {
    return []
  }
  return urls
}

async function handleLocalApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  if (!req.url) return false
  const url = new URL(req.url, `http://${req.headers.host ?? '127.0.0.1'}`)

  if (url.pathname === '/robot/api/app-config' && req.method === 'GET') {
    sendJson(res, 200, publicConfig(config, configExists))
    return true
  }

  if (url.pathname === '/robot/api/status' && req.method === 'GET') {
    sendJson(res, 200, {
      app: {
        ok: true,
        dev: isDev,
        configExists,
      },
      server: {
        url: config.server.url,
        session: session.getStatus(),
      },
      robot: {
        motionEnabled: false,
        status: 'disabled',
      },
    })
    return true
  }

  if (url.pathname === '/robot/api/login' && req.method === 'POST') {
    try {
      await session.getSessionCookie(true)
      sendJson(res, 200, { success: true, session: session.getStatus() })
    } catch (error) {
      sendJson(res, 502, { success: false, error: (error as Error).message })
    }
    return true
  }

  return false
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (!fs.existsSync(distDir)) {
    sendJson(res, 503, { error: 'Robot Friend has not been built. Run pnpm --dir apps/robot-friend build.' })
    return
  }

  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
  const normalizedPath = requestUrl.pathname === '/' ? '/index.html' : decodeURIComponent(requestUrl.pathname)
  const candidate = path.resolve(distDir, `.${normalizedPath}`)
  const filePath = candidate.startsWith(distDir) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    ? candidate
    : path.join(distDir, 'index.html')

  const contentType = contentTypeFor(filePath)
  res.writeHead(200, { 'Content-Type': contentType })
  fs.createReadStream(filePath).pipe(res)
}

function contentTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
      return 'application/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.wav':
      return 'audio/wav'
    default:
      return 'application/octet-stream'
  }
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

async function shutdown(): Promise<void> {
  server.close()
  if (vite) await vite.close()
  process.exit(0)
}
