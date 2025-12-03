import { spawn } from 'node:child_process'
import path from 'node:path'
import { ROOT, systemPaths, audit } from '../../packages/core/src/index'

// Resolve tsx path (installed in node_modules/.bin)
const TSX_PATH = path.join(ROOT, 'node_modules', '.bin', 'tsx')

async function runOneShot(agentFile: string, name: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(TSX_PATH, [agentFile], {
      stdio: 'inherit',
      cwd: ROOT,
      env: { ...process.env, ONESHOT: '1' },
    })
    child.on('close', (code) => resolve(code ?? 0))
    child.on('error', () => resolve(1))
  })
}

async function main() {
  audit({ level: 'info', category: 'system', event: 'night_processor_started', actor: 'system' })

  const transcriberPath = path.join(systemPaths.brain, 'agents', 'transcriber.ts')
  const organizerPath = path.join(systemPaths.brain, 'agents', 'audio-organizer.ts')

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

