import { generateSpeech, reportSpeaking } from '../api'

export class RobotTtsPlayer {
  private audioContext: AudioContext | null = null
  private source: AudioBufferSourceNode | null = null
  private token = 0
  private playing = false

  isPlaying(): boolean {
    return this.playing
  }

  stop(): void {
    this.token += 1
    if (this.source) {
      try {
        this.source.stop()
      } catch {
        // Already stopped.
      }
      this.source = null
    }
    if (this.playing) {
      this.playing = false
      reportSpeaking(false).catch(() => undefined)
    }
  }

  async speak(text: string, onState: (playing: boolean) => void): Promise<void> {
    const speechText = normalizeSpeechText(text)
    if (!speechText) return

    this.stop()
    const token = ++this.token
    const audio = await generateSpeech(speechText)
    if (token !== this.token) return

    this.audioContext ??= new AudioContext()
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
    }

    const buffer = await this.audioContext.decodeAudioData(audio.slice(0))
    if (token !== this.token) return

    const source = this.audioContext.createBufferSource()
    source.buffer = buffer
    source.connect(this.audioContext.destination)
    source.onended = () => {
      if (token !== this.token) return
      this.source = null
      this.playing = false
      onState(false)
      reportSpeaking(false).catch(() => undefined)
    }

    this.source = source
    this.playing = true
    onState(true)
    reportSpeaking(true).catch(() => undefined)
    source.start()
  }
}

function normalizeSpeechText(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-+*]\s+/gm, '')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
