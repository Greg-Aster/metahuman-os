import type { APIRoute } from 'astro'
import { spawn } from 'node:child_process'
import path from 'node:path'
import {
  paths,
  isAgentRunning,
  registerAgent,
  unregisterAgent,
  audit,
  loadPersonaCore,
} from '@metahuman/core'

// Minimal, idempotent agent boot endpoint used by the UI to ensure
// core autonomous services are running. Safe to call multiple times.

// UI-only boot: start boredom-service and audio-organizer from the web app
const DEFAULT_AGENTS = ['boredom-service', 'audio-organizer'] as const

export const GET: APIRoute = async () => {
  const started: string[] = []
  const already: string[] = []
  const missing: string[] = []

  // Prefer a deterministic tsx path under the site app to avoid PATH issues
  const tsxPath = path.join(paths.root, 'apps', 'site', 'node_modules', '.bin', 'tsx')

  for (const agentName of DEFAULT_AGENTS) {
    try {
      const agentPath = path.join(paths.brain, 'agents', `${agentName}.ts`)

      // Basic existence check
      try {
        const fs = await import('node:fs')
        if (!fs.existsSync(agentPath)) {
          missing.push(agentName)
          continue
        }
      } catch {}

      // Only consult registry; service will self-guard with lock and heal stale locks
      if (isAgentRunning(agentName)) {
        already.push(agentName)
        continue
      }

      const runner = tsxPath
      const child = spawn(runner, [agentPath], {
        stdio: 'ignore', // detach from API request
        cwd: paths.root,
        env: {
          ...process.env,
          NODE_PATH: [
            path.join(paths.root, 'node_modules'),
            path.join(paths.root, 'packages/cli/node_modules'),
            path.join(paths.root, 'apps/site/node_modules'),
          ].join(':'),
        },
        detached: true,
      })

      if (child.pid) {
        registerAgent(agentName, child.pid)
        started.push(agentName)

        audit({
          level: 'info',
          category: 'system',
          event: 'agent_started',
          details: { agent: agentName, pid: child.pid, source: 'api/boot' },
          actor: 'system',
        })

        child.unref()

        child.on('close', (code: number) => {
          audit({
            level: code === 0 ? 'info' : 'error',
            category: 'system',
            event: 'agent_stopped',
            details: { agent: agentName, exitCode: code, source: 'api/boot' },
            actor: 'system',
          })
          unregisterAgent(agentName)
        })
      }
    } catch (e) {
      // Continue booting others; surface in response
    }
  }

  // Load persona data for splash screen
  let persona = null
  let version = '1.0.0'
  let modelInfo = null

  try {
    persona = loadPersonaCore()

    // Try to get version from package.json
    try {
      const fs = await import('node:fs')
      const pkgPath = path.join(paths.root, 'package.json')
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
        version = pkg.version || version
      }
    } catch {}

    // Try to get active model info
    try {
      const configPath = path.join(paths.etc, 'agent.json')
      const fs = await import('node:fs')
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        modelInfo = { model: config.defaultModel || 'Local Models' }
      }
    } catch {}
  } catch (e) {
    // Continue without persona data if loading fails
  }

  return new Response(
    JSON.stringify({ started, already, missing, persona, version, modelInfo }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
  )
}
