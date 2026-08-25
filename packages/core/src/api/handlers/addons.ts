/**
 * Optional voice runtime catalog and lifecycle.
 *
 * The catalog is maintained source. Installation state is derived from the
 * runtime filesystem and is never written back into the repository.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse, streamResponse } from '../types.js'
import { systemPaths } from '../../paths.js'
import { stopServer } from '../../tts/server-manager.js'
import { stopVoiceService } from '../../voice-service-manager.js'

type AddonId = 'gpt-sovits' | 'rvc' | 'kokoro'

interface AddonCatalogEntry {
  name: string
  description: string
  category: string
  size: string
  requirements: Record<string, string>
  dependencies?: {
    system?: string[]
  }
  note?: string
}

interface AddonCatalog {
  addons: Record<AddonId, AddonCatalogEntry>
  categories: Record<string, { name: string; description: string }>
}

interface Installer {
  scriptPath: string
  args: string[]
}

const ADDONS_CONFIG_PATH = path.join(systemPaths.etc, 'addons.json')

function loadCatalog(): AddonCatalog {
  if (!fs.existsSync(ADDONS_CONFIG_PATH)) {
    throw new Error(`Add-on catalog not found at ${ADDONS_CONFIG_PATH}`)
  }

  return JSON.parse(fs.readFileSync(ADDONS_CONFIG_PATH, 'utf-8')) as AddonCatalog
}

function isAddonId(value: string): value is AddonId {
  return value === 'gpt-sovits' || value === 'rvc' || value === 'kokoro'
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function isAddonInstalled(addonId: AddonId): boolean {
  const externalDir = path.join(systemPaths.root, 'external')

  switch (addonId) {
    case 'gpt-sovits': {
      const addonDir = path.join(externalDir, 'gpt-sovits')
      return isExecutable(path.join(addonDir, 'venv', 'bin', 'python3'))
        && fs.existsSync(path.join(addonDir, 'api.py'))
    }
    case 'rvc': {
      const addonDir = path.join(externalDir, 'applio-rvc')
      return isExecutable(path.join(addonDir, 'venv', 'bin', 'python3'))
        && fs.existsSync(path.join(addonDir, 'core.py'))
    }
    case 'kokoro': {
      const addonDir = path.join(externalDir, 'kokoro')
      return isExecutable(path.join(addonDir, 'venv', 'bin', 'python3'))
        && fs.existsSync(path.join(addonDir, 'kokoro_server.py'))
        && fs.existsSync(path.join(addonDir, 'server_defaults.py'))
    }
  }
}

function getInstaller(addonId: AddonId): Installer {
  const args = addonId === 'kokoro' ? ['--yes'] : []
  const scriptName = addonId === 'gpt-sovits'
    ? 'install-sovits.sh'
    : addonId === 'rvc'
      ? 'install-rvc.sh'
      : 'install-kokoro.sh'

  return {
    scriptPath: path.join(systemPaths.root, 'bin', scriptName),
    args,
  }
}

export async function handleGetAddons(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const catalog = loadCatalog()
    const addons = Object.fromEntries(
      Object.entries(catalog.addons).map(([id, addon]) => [
        id,
        { ...addon, id, installed: isAddonInstalled(id as AddonId) },
      ]),
    )

    return successResponse({ addons, categories: catalog.categories })
  } catch (error) {
    console.error('[addons-handler] Failed to load catalog:', error)
    return { status: 500, error: String(error) }
  }
}

function event(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
}

async function* streamInstaller(
  req: UnifiedRequest,
  addonId: AddonId,
  installer: Installer,
): AsyncGenerator<string> {
  yield event('start', { addonId, message: 'Installation started' })

  const detached = process.platform !== 'win32'
  const proc = spawn('bash', [installer.scriptPath, ...installer.args], {
    cwd: systemPaths.root,
    stdio: 'pipe',
    detached,
  })
  const queue: string[] = []
  let done = false
  let wake: (() => void) | null = null

  const push = (chunk: string): void => {
    queue.push(chunk)
    wake?.()
    wake = null
  }
  const finish = (): void => {
    done = true
    wake?.()
    wake = null
  }
  const stopInstaller = (): void => {
    if (!proc.pid) return
    try {
      process.kill(detached ? -proc.pid : proc.pid, 'SIGTERM')
    } catch {
      // The installer may already have exited.
    }
  }
  const pushLines = (level: 'info' | 'error', data: Buffer): void => {
    for (const line of data.toString().split('\n').filter((value) => value.trim())) {
      push(event('log', { level, message: line }))
    }
  }

  req.signal?.addEventListener('abort', () => {
    stopInstaller()
    finish()
  }, { once: true })
  proc.stdout?.on('data', (data: Buffer) => pushLines('info', data))
  proc.stderr?.on('data', (data: Buffer) => pushLines('error', data))
  proc.on('close', (code) => {
    if (code === 0 && isAddonInstalled(addonId)) {
      push(event('complete', { success: true, message: 'Installation completed successfully' }))
    } else {
      push(event('complete', {
        success: false,
        error: code === 0
          ? 'Installer exited successfully, but the runtime did not pass its installation check'
          : `Installation failed with exit code ${code}`,
      }))
    }
    finish()
  })
  proc.on('error', (error) => {
    push(event('error', { message: error.message }))
    finish()
  })

  while (!done || queue.length > 0) {
    if (queue.length > 0) {
      yield queue.shift()!
      continue
    }
    await new Promise<void>((resolve) => {
      wake = resolve
    })
  }
}

export async function handleInstallAddonStream(req: UnifiedRequest): Promise<UnifiedResponse> {
  const addonId = (req.body as { addonId?: string } | undefined)?.addonId
  if (!addonId || !isAddonId(addonId)) {
    return { status: 400, error: 'A supported addonId is required' }
  }

  const installer = getInstaller(addonId)
  if (!fs.existsSync(installer.scriptPath)) {
    return { status: 500, error: `Installer not found: ${path.basename(installer.scriptPath)}` }
  }
  if (isAddonInstalled(addonId)) {
    return { status: 409, error: `${addonId} is already installed` }
  }

  return streamResponse(streamInstaller(req, addonId, installer))
}

async function uninstallAddon(addonId: AddonId): Promise<string> {
  switch (addonId) {
    case 'gpt-sovits': {
      await stopServer('gpt-sovits')
      fs.rmSync(path.join(systemPaths.root, 'external', 'gpt-sovits'), {
        recursive: true,
        force: true,
      })
      return 'GPT-SoVITS uninstalled successfully'
    }
    case 'rvc': {
      fs.rmSync(path.join(systemPaths.root, 'external', 'applio-rvc'), {
        recursive: true,
        force: true,
      })
      return 'RVC uninstalled successfully'
    }
    case 'kokoro': {
      await stopVoiceService('kokoro')
      const kokoroDir = path.join(systemPaths.root, 'external', 'kokoro')
      fs.rmSync(path.join(kokoroDir, 'venv'), { recursive: true, force: true })
      fs.rmSync(path.join(kokoroDir, '__pycache__'), { recursive: true, force: true })
      return 'Kokoro runtime uninstalled successfully; maintained integration source was preserved'
    }
  }
}

export async function handleUninstallAddon(req: UnifiedRequest): Promise<UnifiedResponse> {
  const addonId = (req.body as { addonId?: string } | undefined)?.addonId
  if (!addonId || !isAddonId(addonId)) {
    return { status: 400, error: 'A supported addonId is required' }
  }

  try {
    if (!isAddonInstalled(addonId)) {
      return successResponse({ success: true, message: `${addonId} is already uninstalled` })
    }
    const message = await uninstallAddon(addonId)
    return successResponse({ success: true, message })
  } catch (error) {
    console.error('[addons-handler] Uninstall failed:', error)
    return { status: 500, error: String(error) }
  }
}
