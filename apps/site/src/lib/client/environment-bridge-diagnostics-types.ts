/** Browser-side wire DTOs returned by the environment-bridge diagnostics API. */
export interface EnvironmentBridgeDiagnosticEvent {
  timestamp: string
  kind: string
  bytes?: number
  status?: string
  message?: string
}

export interface EnvironmentBridgeDiagnosticsSession {
  sessionId: string
  robotId?: string
  updatedAt: string
  transport: {
    inboundBytes: number
    outboundBytes: number
    inboundMessages: number
    outboundMessages: number
    inboundBytesPerSecond: number
    outboundBytesPerSecond: number
  }
  media: {
    imageFrames: number
    imageBytes: number
    audioUtterances: number
    audioBytes: number
  }
  microphoneLevel: number
  pendingAudioUtterances: number
  lastTranscriptionStatus?: string
  lastTranscript?: string
  robotStatus?: Record<string, unknown>
  freestyleMovement?: {
    supported: boolean
    enabled: boolean
    available: boolean
  }
  movementPlan?: {
    actionId?: string
    sequence?: number
    status: string
    frameCount?: number
    durationMs?: number
    activeFrame?: number
    message?: string
    updatedAt: string
  }
  latestImage?: {
    id: string
    timestamp: string
    mimeType: string
    bytes: number
    available: boolean
  }
  latestAudio?: {
    utteranceId: string
    timestamp: string
    bytes: number
    durationMs?: number
    wakeTriggered?: boolean
    truncated?: boolean
    available: boolean
  }
  recentEvents: EnvironmentBridgeDiagnosticEvent[]
}

export interface EnvironmentBridgeDiagnosticsSnapshot {
  updatedAt: string
  sessions: EnvironmentBridgeDiagnosticsSession[]
}
