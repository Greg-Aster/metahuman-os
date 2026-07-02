export type ConversationState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'offline' | 'error'

export interface AppConfig {
  configExists: boolean
  server: {
    url: string
    configured: boolean
    requestTimeoutMs: number
  }
  app: {
    host: string
    port: number
    autoListen: boolean
    showDebugUi: boolean
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
    status: 'disabled'
  }
}

export interface LocalStatus {
  app: {
    ok: boolean
    dev: boolean
    configExists: boolean
  }
  server: {
    url: string
    session: {
      connected: boolean
      username: string | null
      role: string | null
      lastLoginAt: number | null
      loginError: string | null
    }
  }
  robot: {
    motionEnabled: false
    status: 'disabled'
  }
}

export interface TranscriptMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  at: number
}

export interface ChatResponse {
  response?: string
  answer?: string
  error?: string
  events?: Array<{ type: string; data?: any }>
  sessionId?: string
}
