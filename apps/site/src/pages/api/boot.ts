import type { APIRoute } from 'astro'
import { spawn } from 'node:child_process'
import path from 'node:path'
import {
  systemPaths,
  isAgentRunning,
  registerAgent,
  unregisterAgent,
  audit,
  loadPersonaCore,
  isHeadless,
  checkOllamaHealth,
} from '@metahuman/core'
import { loadCognitiveMode } from '@metahuman/core/cognitive-mode'

// Minimal, idempotent agent boot endpoint used by the UI to ensure
// core autonomous services are running. Safe to call multiple times.

// Always start headless-watcher, conditionally start others
const ALWAYS_AGENTS = ['headless-watcher'] as const
const CONDITIONAL_AGENTS = ['boredom-service', 'audio-organizer'] as const

export const GET: APIRoute = async ({ cookies }) => {
  // SECURITY: Agent management requires owner role
  // Anonymous users should not be able to start/stop system agents
  try {
    const { getAuthenticatedUser } = await import('@metahuman/core');
    const user = getAuthenticatedUser(cookies);

    if (user.role !== 'owner') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Owner role required to manage agents',
          started: [],
          already: [],
          missing: []
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    // No valid session = anonymous user, block access
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Authentication required',
        started: [],
        already: [],
        missing: []
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const started: string[] = []
  const already: string[] = []
  const missing: string[] = []
  let headlessMode = false

  // Check headless mode
  if (isHeadless()) {
    headlessMode = true
  }

  // Check authentication and determine effective cognitive mode
  const sessionCookie = cookies?.get('mh_session');
  const isAuthenticated = !!sessionCookie;

  // Prefer a deterministic tsx path under the site app to avoid PATH issues
  const tsxPath = path.join(systemPaths.root, 'apps', 'site', 'node_modules', '.bin', 'tsx')

  // Determine which agents to start based on headless mode
  const agentsToStart = headlessMode
    ? [...ALWAYS_AGENTS]
    : [...ALWAYS_AGENTS, ...CONDITIONAL_AGENTS]

  for (const agentName of agentsToStart) {
    try {
      const agentPath = path.join(systemPaths.brain, 'agents', `${agentName}.ts`)

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
        cwd: systemPaths.root,
        env: {
          ...process.env,
          NODE_PATH: [
            path.join(systemPaths.root, 'node_modules'),
            path.join(systemPaths.root, 'packages/cli/node_modules'),
            path.join(systemPaths.root, 'apps/site/node_modules'),
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
  let cognitiveMode = 'emulation'
  let ollamaStatus = null

  try {
    persona = loadPersonaCore()

    // Load cognitive mode, but override for unauthenticated users
    const cognitiveConfig = loadCognitiveMode()
    cognitiveMode = isAuthenticated ? cognitiveConfig.currentMode : 'emulation'

    // Try to get version from package.json
    try {
      const fs = await import('node:fs')
      const pkgPath = path.join(systemPaths.root, 'package.json')
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
        version = pkg.version || version
      }
    } catch {}

    // Try to get active model info
    try {
      const { loadModelRegistry } = await import('@metahuman/core')
      const registry = loadModelRegistry()
      const fallbackId = registry.defaults?.fallback || 'default.fallback'
      const fallbackModel = registry.models?.[fallbackId]
      modelInfo = { model: fallbackModel?.model || 'Local Models' }
    } catch {}

    // Check Ollama health status
    try {
      ollamaStatus = await checkOllamaHealth()
    } catch (e) {
      ollamaStatus = {
        running: false,
        hasModels: false,
        modelCount: 0,
        models: [],
        error: String(e)
      }
    }
  } catch (e) {
    // Continue without persona data if loading fails
  }

  return new Response(
    JSON.stringify({
      started,
      already,
      missing,
      persona,
      version,
      modelInfo,
      cognitiveMode,
      isAuthenticated,
      headlessMode,
      ollamaStatus
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
  )
}
