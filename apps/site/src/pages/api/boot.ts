import type { APIRoute } from 'astro'
import { spawn } from 'node:child_process'
import path from 'node:path'
import {
  paths,
  isAgentRunning,
  registerAgent,
  unregisterAgent,
  audit,
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

  return new Response(
    JSON.stringify({ started, already, missing }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
  )
}
