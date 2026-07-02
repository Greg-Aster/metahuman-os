import type { AppConfig, ChatResponse, LocalStatus } from './types'

async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
  })
  return response
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await request(path, init)
  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(data?.error || data?.detail || `Request failed with ${response.status}`)
  }

  return data as T
}

export function getAppConfig(): Promise<AppConfig> {
  return json<AppConfig>('/robot/api/app-config')
}

export function getLocalStatus(): Promise<LocalStatus> {
  return json<LocalStatus>('/robot/api/status')
}

export function login(): Promise<{ success: boolean }> {
  return json('/robot/api/login', { method: 'POST' })
}

export async function transcribeAudio(blob: Blob, durationMs: number): Promise<string> {
  const response = await request(`/robot/api/stt?format=webm&collect=1&dur=${Math.max(0, Math.round(durationMs))}`, {
    method: 'POST',
    headers: {
      'Content-Type': blob.type || 'audio/webm',
    },
    body: await blob.arrayBuffer(),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(data?.error || `STT failed with ${response.status}`)
  }

  return String(data?.transcript || '').trim()
}

export async function sendChat(message: string, sessionId: string): Promise<ChatResponse> {
  const data = await json<any>('/robot/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      sessionId,
      mode: 'conversation',
      stream: false,
    }),
  })

  if (Array.isArray(data?.events)) {
    const answer = [...data.events].reverse().find(event => event.type === 'answer')
    const error = [...data.events].reverse().find(event => event.type === 'error')
    return {
      response: answer?.data?.response,
      error: error?.data?.message,
      events: data.events,
      sessionId,
    }
  }

  return {
    response: data?.response || data?.answer,
    error: data?.error,
    sessionId,
  }
}

export async function generateSpeech(text: string): Promise<ArrayBuffer> {
  const response = await request('/robot/api/tts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  })

  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.error || `TTS failed with ${response.status}`)
  }

  return response.arrayBuffer()
}

export function reportSpeaking(speaking: boolean): Promise<Response> {
  return request('/robot/api/pause-state', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'setTTS', speaking }),
  })
}
