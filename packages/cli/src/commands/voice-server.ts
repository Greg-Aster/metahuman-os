import {
  ensureVoiceServiceRunning,
  getVoiceServiceConfig,
  getVoiceServiceStatus,
  stopVoiceService,
  type VoiceServiceId,
} from '@metahuman/core'

const VOICE_SERVERS: VoiceServiceId[] = ['kokoro', 'whisper']

function targets(value: string | undefined): VoiceServiceId[] {
  if (value === '--all') return VOICE_SERVERS
  if (value === 'kokoro' || value === 'whisper') return [value]
  throw new Error('Choose kokoro, whisper, or --all')
}

function showHelp(): void {
  console.log(`
Voice Server Management

Usage:
  mh voice-server status <kokoro|whisper|--all>
  mh voice-server start <kokoro|whisper|--all> [--boot]
  mh voice-server stop <kokoro|whisper|--all>

The --boot flag starts only servers enabled for system boot in
etc/voice-servers.json.
`)
}

export async function voiceServerCommand(args: string[]): Promise<void> {
  const action = args[0]
  if (!action || action === 'help' || action === '--help' || action === '-h') {
    showHelp()
    return
  }

  const selected = targets(args[1])
  const bootOnly = args.includes('--boot')
  let failed = false

  for (const id of selected) {
    try {
      if (action === 'status') {
        const status = await getVoiceServiceStatus(id)
        console.log(`${id}: ${status.readiness}${status.pid ? ` (PID ${status.pid})` : ''}`)
        continue
      }

      if (action === 'start') {
        const config = getVoiceServiceConfig(id)
        if (!config.enabled || (bootOnly && !config.startOnSystemBoot)) {
          console.log(`${id}: disabled${bootOnly ? ' for system boot' : ''}`)
          continue
        }
        const status = await ensureVoiceServiceRunning(id)
        console.log(`${id}: ${status.readiness}${status.pid ? ` (PID ${status.pid})` : ''}`)
        continue
      }

      if (action === 'stop') {
        const result = await stopVoiceService(id)
        console.log(`${id}: ${result.message}`)
        failed ||= !result.success
        continue
      }

      throw new Error(`Unknown voice-server action: ${action}`)
    } catch (error) {
      failed = true
      console.error(`${id}: ${(error as Error).message}`)
    }
  }

  if (failed) process.exitCode = 1
}
