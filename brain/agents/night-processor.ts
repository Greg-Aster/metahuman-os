import { spawn } from 'node:child_process'
import path from 'node:path'
import { paths, audit } from '../../packages/core/src/index'

async function runOneShot(agentFile: string, name: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('tsx', [agentFile], {
      stdio: 'inherit',
      cwd: paths.root,
      env: { ...process.env, ONESHOT: '1' },
    })
    child.on('close', (code) => resolve(code ?? 0))
    child.on('error', () => resolve(1))
  })
}

async function main() {
  audit({ level: 'info', category: 'system', event: 'night_processor_started', actor: 'system' })

  const transcriberPath = path.join(paths.brain, 'agents', 'transcriber.ts')
  const organizerPath = path.join(paths.brain, 'agents', 'audio-organizer.ts')

  const tCode = await runOneShot(transcriberPath, 'transcriber')
  const oCode = await runOneShot(organizerPath, 'audio-organizer')

  audit({
    level: tCode === 0 && oCode === 0 ? 'info' : 'warn',
    category: 'system',
    event: 'night_processor_completed',
    details: { transcriberExit: tCode, organizerExit: oCode },
    actor: 'system',
  })
}

main().catch((error) => {
  audit({ level: 'error', category: 'system', event: 'night_processor_failed', details: { error: String(error) }, actor: 'system' })
  process.exit(1)
})

