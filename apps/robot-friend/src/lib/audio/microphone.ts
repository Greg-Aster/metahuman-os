export interface MicrophoneOptions {
  vadThreshold: number
  silenceMs: number
  minSpeechMs: number
  shouldPause: () => boolean
  onLevel: (level: number) => void
  onState: (state: 'off' | 'ready' | 'recording') => void
  onAudio: (blob: Blob, durationMs: number) => void
  onError: (message: string) => void
}

export class RobotMicrophone {
  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private recorder: MediaRecorder | null = null
  private chunks: BlobPart[] = []
  private animationFrame = 0
  private silenceStartedAt: number | null = null
  private recordingStartedAt: number | null = null
  private running = false

  constructor(private readonly options: MicrophoneOptions) {}

  async start(): Promise<void> {
    if (this.running) return

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.options.onError('Microphone requires localhost or trusted HTTPS.')
      return
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })

      this.audioContext = new AudioContext()
      const source = this.audioContext.createMediaStreamSource(this.stream)
      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = 512
      this.analyser.smoothingTimeConstant = 0.8
      source.connect(this.analyser)
      this.running = true
      this.options.onState('ready')
      this.tick()
    } catch (error) {
      this.options.onError((error as Error).message || 'Failed to start microphone.')
      this.stop()
    }
  }

  stop(): void {
    this.running = false
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame)
    this.animationFrame = 0
    this.stopRecording(false)
    this.stream?.getTracks().forEach(track => track.stop())
    this.stream = null
    this.audioContext?.close().catch(() => undefined)
    this.audioContext = null
    this.analyser = null
    this.options.onLevel(0)
    this.options.onState('off')
  }

  private tick = (): void => {
    if (!this.running || !this.analyser) return

    const level = calculateVoiceLevel(this.analyser)
    this.options.onLevel(level)

    if (this.options.shouldPause()) {
      this.silenceStartedAt = null
      this.animationFrame = requestAnimationFrame(this.tick)
      return
    }

    const recording = this.recorder?.state === 'recording'
    if (!recording && level > this.options.vadThreshold) {
      this.startRecording()
    } else if (recording && level <= this.options.vadThreshold) {
      this.silenceStartedAt ??= Date.now()
      if (Date.now() - this.silenceStartedAt >= this.options.silenceMs) {
        this.stopRecording(true)
      }
    } else if (recording && level > this.options.vadThreshold) {
      this.silenceStartedAt = null
    }

    this.animationFrame = requestAnimationFrame(this.tick)
  }

  private startRecording(): void {
    if (!this.stream || this.recorder?.state === 'recording') return

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'

    this.chunks = []
    this.silenceStartedAt = null
    this.recordingStartedAt = Date.now()
    this.recorder = new MediaRecorder(this.stream, { mimeType })
    this.recorder.ondataavailable = event => {
      if (event.data.size > 0) this.chunks.push(event.data)
    }
    this.recorder.onstop = () => {
      const durationMs = this.recordingStartedAt ? Date.now() - this.recordingStartedAt : 0
      const blob = new Blob(this.chunks, { type: mimeType })
      this.chunks = []
      this.recordingStartedAt = null
      this.options.onState('ready')

      if (durationMs >= this.options.minSpeechMs && blob.size > 0) {
        this.options.onAudio(blob, durationMs)
      }
    }
    this.recorder.start()
    this.options.onState('recording')
  }

  private stopRecording(emitAudio: boolean): void {
    if (!this.recorder || this.recorder.state === 'inactive') return
    if (!emitAudio) this.chunks = []
    try {
      this.recorder.stop()
    } catch {
      this.options.onState('ready')
    }
  }
}

export function calculateVoiceLevel(analyser: AnalyserNode): number {
  const data = new Uint8Array(analyser.frequencyBinCount)
  analyser.getByteFrequencyData(data)

  let sum = 0
  let count = 0
  const start = Math.floor(data.length * 0.05)
  const end = Math.floor(data.length * 0.6)

  for (let index = start; index < end; index += 1) {
    sum += data[index]
    count += 1
  }

  return count ? Math.min(100, (sum / count / 255) * 100) : 0
}
