import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface RobotFriendConfig {
  server: {
    url: string
    username: string
    password: string
    requestTimeoutMs: number
  }
  app: {
    host: string
    port: number
    autoListen: boolean
    showDebugUi: boolean
    https: {
      enabled: boolean
      keyPath: string | null
      certPath: string | null
    }
  }
  voice: {
    language: string
    vadThreshold: number
    silenceMs: number
    minSpeechMs: number
    ttsEnabled: boolean
  }
  robot: {
    motionEnabled: boolean
  }
}

const DEFAULT_CONFIG: RobotFriendConfig = {
  server: {
    url: 'http://127.0.0.1:4321',
    username: 'owner',
    password: 'change-me',
    requestTimeoutMs: 30000,
  },
  app: {
    host: '0.0.0.0',
    port: 4377,
    autoListen: true,
    showDebugUi: false,
    https: {
      enabled: false,
      keyPath: null,
      certPath: null,
    },
  },
  voice: {
    language: 'en-US',
    vadThreshold: 12,
    silenceMs: 1400,
    minSpeechMs: 500,
    ttsEnabled: true,
  },
  robot: {
    motionEnabled: false,
  },
}

export function appRoot(): string {
  const thisFile = fileURLToPath(import.meta.url)
  if (thisFile.includes(`${path.sep}dist-server${path.sep}`)) {
    return path.resolve(path.dirname(thisFile), '..', '..')
  }
  return path.resolve(path.dirname(thisFile), '..', '..')
}

function mergeConfig(raw: Partial<RobotFriendConfig>): RobotFriendConfig {
  return applyEnvOverrides({
    server: {
      ...DEFAULT_CONFIG.server,
      ...(raw.server ?? {}),
      url: normalizeServerUrl(raw.server?.url ?? DEFAULT_CONFIG.server.url),
      requestTimeoutMs: clampNumber(raw.server?.requestTimeoutMs, 1000, 300000, DEFAULT_CONFIG.server.requestTimeoutMs),
    },
    app: {
      ...DEFAULT_CONFIG.app,
      ...(raw.app ?? {}),
      host: raw.app?.host || DEFAULT_CONFIG.app.host,
      port: clampNumber(raw.app?.port, 1, 65535, DEFAULT_CONFIG.app.port),
      autoListen: raw.app?.autoListen ?? DEFAULT_CONFIG.app.autoListen,
      showDebugUi: raw.app?.showDebugUi ?? DEFAULT_CONFIG.app.showDebugUi,
      https: {
        ...DEFAULT_CONFIG.app.https,
        ...(raw.app?.https ?? {}),
        enabled: raw.app?.https?.enabled ?? DEFAULT_CONFIG.app.https.enabled,
        keyPath: raw.app?.https?.keyPath ?? DEFAULT_CONFIG.app.https.keyPath,
        certPath: raw.app?.https?.certPath ?? DEFAULT_CONFIG.app.https.certPath,
      },
    },
    voice: {
      ...DEFAULT_CONFIG.voice,
      ...(raw.voice ?? {}),
      language: raw.voice?.language || DEFAULT_CONFIG.voice.language,
      vadThreshold: clampNumber(raw.voice?.vadThreshold, 0, 100, DEFAULT_CONFIG.voice.vadThreshold),
      silenceMs: clampNumber(raw.voice?.silenceMs, 250, 30000, DEFAULT_CONFIG.voice.silenceMs),
      minSpeechMs: clampNumber(raw.voice?.minSpeechMs, 100, 10000, DEFAULT_CONFIG.voice.minSpeechMs),
      ttsEnabled: raw.voice?.ttsEnabled ?? DEFAULT_CONFIG.voice.ttsEnabled,
    },
    robot: {
      motionEnabled: false,
    },
  })
}

function applyEnvOverrides(config: RobotFriendConfig): RobotFriendConfig {
  const envHost = process.env.ROBOT_FRIEND_HOST?.trim()
  const envPort = process.env.ROBOT_FRIEND_PORT ? Number(process.env.ROBOT_FRIEND_PORT) : undefined
  const envHttps = process.env.ROBOT_FRIEND_HTTPS
  const envKeyPath = process.env.ROBOT_FRIEND_HTTPS_KEY?.trim()
  const envCertPath = process.env.ROBOT_FRIEND_HTTPS_CERT?.trim()

  return {
    ...config,
    app: {
      ...config.app,
      host: envHost || config.app.host,
      port: clampNumber(envPort, 1, 65535, config.app.port),
      https: {
        ...config.app.https,
        enabled: envHttps ? envHttps === '1' || envHttps.toLowerCase() === 'true' : config.app.https.enabled,
        keyPath: envKeyPath || config.app.https.keyPath,
        certPath: envCertPath || config.app.https.certPath,
      },
    },
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function normalizeServerUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.pathname = parsed.pathname.replace(/\/+$/, '')
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return DEFAULT_CONFIG.server.url
  }
}

export function loadConfig(): { config: RobotFriendConfig; path: string; exists: boolean } {
  const configPath = process.env.ROBOT_FRIEND_CONFIG
    ? path.resolve(process.env.ROBOT_FRIEND_CONFIG)
    : path.join(process.cwd(), 'robot-friend.config.json')

  if (!fs.existsSync(configPath)) {
    return { config: applyEnvOverrides(DEFAULT_CONFIG), path: configPath, exists: false }
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Partial<RobotFriendConfig>
    return { config: mergeConfig(raw), path: configPath, exists: true }
  } catch (error) {
    throw new Error(`Failed to load ${configPath}: ${(error as Error).message}`)
  }
}

export function publicConfig(config: RobotFriendConfig, configExists: boolean) {
  return {
    configExists,
    server: {
      url: config.server.url,
      configured: config.server.password !== 'change-me',
      requestTimeoutMs: config.server.requestTimeoutMs,
    },
    app: {
      host: config.app.host,
      port: config.app.port,
      autoListen: config.app.autoListen,
      showDebugUi: config.app.showDebugUi,
    },
    voice: config.voice,
    robot: {
      motionEnabled: false,
      status: 'disabled' as const,
    },
  }
}
