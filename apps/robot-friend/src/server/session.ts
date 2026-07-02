import type { RobotFriendConfig } from './config.js'

interface SessionState {
  sessionId: string | null
  username: string | null
  role: string | null
  lastLoginAt: number | null
  loginError: string | null
}

export class MetaHumanSession {
  private state: SessionState = {
    sessionId: null,
    username: null,
    role: null,
    lastLoginAt: null,
    loginError: null,
  }

  constructor(private readonly config: RobotFriendConfig) {}

  getStatus() {
    return {
      connected: !!this.state.sessionId,
      username: this.state.username,
      role: this.state.role,
      lastLoginAt: this.state.lastLoginAt,
      loginError: this.state.loginError,
    }
  }

  async getSessionCookie(forceLogin = false): Promise<string> {
    if (!forceLogin && this.state.sessionId) {
      return `mh_session=${this.state.sessionId}`
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.server.requestTimeoutMs)

    try {
      const response = await fetch(`${this.config.server.url}/api/auth/login`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: this.config.server.username,
          password: this.config.server.password,
        }),
        signal: controller.signal,
      })

      const text = await response.text()
      let data: any = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = null
      }

      if (!response.ok || !data?.sessionId) {
        const message = data?.error || text || `Login failed with ${response.status}`
        this.state = { ...this.state, sessionId: null, loginError: message }
        throw new Error(message)
      }

      this.state = {
        sessionId: data.sessionId,
        username: data.user?.username ?? this.config.server.username,
        role: data.user?.role ?? null,
        lastLoginAt: Date.now(),
        loginError: null,
      }

      return `mh_session=${data.sessionId}`
    } finally {
      clearTimeout(timeout)
    }
  }

  clear(error?: string): void {
    this.state = {
      sessionId: null,
      username: null,
      role: null,
      lastLoginAt: null,
      loginError: error ?? null,
    }
  }
}
