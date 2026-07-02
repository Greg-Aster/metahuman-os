/**
 * Addons API Handlers
 *
 * Unified handlers for addon management endpoints.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, streamResponse } from '../types.js';
import { systemPaths } from '../../paths.js';
import { stopServer } from '../../tts/server-manager.js';

/**
 * Check if an addon is actually installed
 */
async function checkAddonInstalled(addonId: string, addon: any): Promise<boolean> {
  const rootPath = systemPaths.root;

  switch (addonId) {
    case 'gpt-sovits': {
      const sovitsDir = path.join(rootPath, 'external', 'gpt-sovits');
      return fs.existsSync(sovitsDir);
    }
    case 'rvc': {
      const rvcDir = path.join(rootPath, 'external', 'applio-rvc');
      return fs.existsSync(rvcDir);
    }
    case 'kokoro': {
      const kokoroDir = path.join(rootPath, 'external', 'kokoro');
      const venvExists = fs.existsSync(path.join(kokoroDir, 'venv'));
      return fs.existsSync(kokoroDir) && venvExists;
    }
    case 'whisper-stt': {
      // Check if whisper binary exists
      const whisperBin = path.join(rootPath, 'bin', 'whisper');
      return fs.existsSync(whisperBin);
    }
    default:
      return addon.installed || false;
  }
}

/**
 * GET /api/addons - Get list of available addons and their status
 */
export async function handleGetAddons(_req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const addonsConfigPath = path.join(systemPaths.etc, 'addons.json');

    if (!fs.existsSync(addonsConfigPath)) {
      return {
        status: 500,
        error: `Addons configuration not found at ${addonsConfigPath}`,
      };
    }

    const config = JSON.parse(fs.readFileSync(addonsConfigPath, 'utf-8'));

    // Enrich addon data with actual installation status
    const enrichedAddons: Record<string, any> = {};

    for (const [id, addon] of Object.entries(config.addons as Record<string, any>)) {
      enrichedAddons[id] = {
        ...(addon as Record<string, any>),
        id,
        installed: await checkAddonInstalled(id, addon),
      };
    }

    return successResponse({
      addons: enrichedAddons,
      categories: config.categories,
    });
  } catch (error) {
    console.error('[addons-handler] Error:', error);
    return {
      status: 500,
      error: String(error),
    };
  }
}

/**
 * POST /api/addons/toggle - Toggle addon enabled status
 */
export async function handleToggleAddon(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body } = req;
  const { addonId, enabled } = (body || {}) as { addonId?: string; enabled?: boolean };

  if (!addonId || typeof enabled !== 'boolean') {
    return {
      status: 400,
      error: 'Missing addonId or enabled',
    };
  }

  try {
    const addonsConfigPath = path.join(systemPaths.etc, 'addons.json');

    if (!fs.existsSync(addonsConfigPath)) {
      return {
        status: 404,
        error: 'Addons configuration not found',
      };
    }

    const config = JSON.parse(fs.readFileSync(addonsConfigPath, 'utf-8'));

    if (!config.addons[addonId]) {
      return {
        status: 404,
        error: `Addon "${addonId}" not found`,
      };
    }

    if (!config.addons[addonId].installed) {
      return {
        status: 400,
        error: 'Addon not installed',
      };
    }

    config.addons[addonId].enabled = enabled;
    fs.writeFileSync(addonsConfigPath, JSON.stringify(config, null, 2));
    await toggleAddonConfiguration(addonId, enabled);

    return successResponse({
      success: true,
      addonId,
      enabled,
    });
  } catch (error) {
    console.error('[addons-handler] Toggle error:', error);
    return {
      status: 500,
      error: String(error),
    };
  }
}

async function toggleAddonConfiguration(addonId: string, enabled: boolean): Promise<void> {
  const voiceConfigPath = path.join(systemPaths.etc, 'voice.json');
  const ttsProviders = ['gpt-sovits', 'rvc', 'kokoro'];

  if (!ttsProviders.includes(addonId) || !fs.existsSync(voiceConfigPath)) {
    return;
  }

  const voiceConfig = JSON.parse(fs.readFileSync(voiceConfigPath, 'utf-8'));
  const providerMap: Record<string, string> = {
    'gpt-sovits': 'sovits',
    rvc: 'rvc',
    kokoro: 'kokoro',
  };

  if (!enabled && voiceConfig.tts?.provider === providerMap[addonId]) {
    voiceConfig.tts.provider = 'piper';
    const tempVoicePath = `${voiceConfigPath}.tmp`;
    fs.writeFileSync(tempVoicePath, JSON.stringify(voiceConfig, null, 2));
    fs.renameSync(tempVoicePath, voiceConfigPath);

    if (addonId === 'gpt-sovits') {
      try {
        await stopServer('gpt-sovits');
      } catch (error) {
        console.error('[addons-handler] Failed to stop SoVITS server:', error);
      }
    } else if (addonId === 'kokoro') {
      try {
        await stopServer('kokoro');
      } catch (error) {
        console.error('[addons-handler] Failed to stop Kokoro server:', error);
      }
    }
  }
}

/**
 * POST /api/addons/install - Install an addon and mark it installed on success
 */
export async function handleInstallAddon(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { addonId } = (req.body || {}) as { addonId?: string };

  if (!addonId) {
    return { status: 400, error: 'Missing addonId' };
  }

  try {
    const addonsConfigPath = path.join(systemPaths.etc, 'addons.json');
    const config = JSON.parse(fs.readFileSync(addonsConfigPath, 'utf-8'));
    const addon = config.addons[addonId];

    if (!addon) {
      return { status: 404, error: 'Addon not found' };
    }

    const result = await installAddon(addonId, addon);
    if (!result.success) {
      return { status: 500, error: result.error };
    }

    addon.installed = true;
    fs.writeFileSync(addonsConfigPath, JSON.stringify(config, null, 2));

    return successResponse({ success: true, message: result.message });
  } catch (error) {
    console.error('[addons-handler] Install error:', error);
    return { status: 500, error: String(error) };
  }
}

async function installAddon(addonId: string, addon: any): Promise<{ success: boolean; error?: string; message?: string }> {
  const install = async (scriptName: string, args: string[], message: string) => {
    const scriptPath = path.join(systemPaths.root, 'bin', scriptName);
    if (!fs.existsSync(scriptPath)) {
      return { success: false, error: scriptName.includes('rvc') ? 'RVC installation script not found' : 'Installation script not found' };
    }
    await runScriptWithArgs(scriptPath, args);
    return { success: true, message };
  };

  try {
    switch (addonId) {
      case 'gpt-sovits': {
        const result = await install('install-sovits.sh', [], 'GPT-SoVITS installed successfully');
        if (!result.success) return result;
        const pipPackages = addon.dependencies?.pip || [];
        if (pipPackages.length > 0) {
          await installPipPackages(pipPackages);
        }
        return result;
      }
      case 'rvc':
        return await install('install-rvc.sh', [], 'RVC installed successfully');
      case 'kokoro':
        return await install('install-kokoro.sh', ['--yes'], 'Kokoro TTS installed successfully');
      default:
        return { success: false, error: 'Addon installation not implemented' };
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

function runScriptWithArgs(scriptPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('bash', [scriptPath, ...args], {
      cwd: systemPaths.root,
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
      console.log('[Install Script]', data.toString().trim());
    });
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
      console.error('[Install Script Error]', data.toString().trim());
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Script failed with code ${code}: ${stderr || stdout}`));
      }
    });
    proc.on('error', reject);
  });
}

function installPipPackages(packages: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let pythonCmd = 'python3';
    for (const cmd of ['python3', 'python']) {
      const result = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
      if (result.status === 0) {
        pythonCmd = cmd;
        break;
      }
    }

    const proc = spawn(pythonCmd, ['-m', 'pip', 'install', ...packages], {
      cwd: systemPaths.root,
      stdio: 'pipe',
    });

    let stderr = '';
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pip install failed with code ${code}: ${stderr}`));
      }
    });
    proc.on('error', reject);
  });
}

/**
 * GET /api/addons/install-stream?addonId=kokoro - Stream installer output
 */
export async function handleInstallAddonStream(req: UnifiedRequest): Promise<UnifiedResponse> {
  const addonId = req.query?.addonId;

  if (!addonId) {
    return { status: 400, error: 'Missing addonId parameter' };
  }

  const installer = getInstallScript(addonId);
  if (!installer) {
    return { status: 400, error: `Unsupported addon: ${addonId}` };
  }

  return streamResponse(streamInstaller(addonId, installer.scriptPath, installer.args));
}

function getInstallScript(addonId: string): { scriptPath: string; args: string[] } | null {
  switch (addonId) {
    case 'kokoro':
      return { scriptPath: path.join(systemPaths.root, 'bin', 'install-kokoro.sh'), args: ['--yes'] };
    case 'gpt-sovits':
      return { scriptPath: path.join(systemPaths.root, 'bin', 'install-sovits.sh'), args: [] };
    case 'rvc':
      return { scriptPath: path.join(systemPaths.root, 'bin', 'install-rvc.sh'), args: [] };
    default:
      return null;
  }
}

async function* streamInstaller(addonId: string, scriptPath: string, args: string[]): AsyncGenerator<string> {
  const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  yield event('start', { addonId, message: 'Installation started' });

  const proc = spawn('bash', [scriptPath, ...args], {
    cwd: systemPaths.root,
    stdio: 'pipe',
  });

  const queue: string[] = [];
  let done = false;
  let wake: (() => void) | null = null;

  const push = (chunk: string) => {
    queue.push(chunk);
    wake?.();
    wake = null;
  };

  const pushLines = (level: 'info' | 'error', data: Buffer) => {
    for (const line of data.toString().split('\n').filter((value) => value.trim())) {
      if (level === 'info') {
        console.log('[Install Stream]', line);
      } else {
        console.error('[Install Stream Error]', line);
      }
      push(event('log', { level, message: line }));
    }
  };

  proc.stdout?.on('data', (data) => pushLines('info', data));
  proc.stderr?.on('data', (data) => pushLines('error', data));
  proc.on('close', (code) => {
    if (code === 0) {
      push(event('complete', { success: true, message: 'Installation completed successfully' }));
    } else {
      push(event('complete', { success: false, error: `Installation failed with exit code ${code}` }));
    }
    done = true;
    wake?.();
    wake = null;
  });
  proc.on('error', (error) => {
    push(event('error', { message: error.message }));
    done = true;
    wake?.();
    wake = null;
  });

  while (!done || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      continue;
    }
    yield queue.shift()!;
  }
}

/**
 * POST /api/addons/uninstall - Uninstall an addon
 */
export async function handleUninstallAddon(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body } = req;
  const { addonId } = (body || {}) as { addonId?: string };

  if (!addonId) {
    return {
      status: 400,
      error: 'addonId is required',
    };
  }

  try {
    const addonsConfigPath = path.join(systemPaths.etc, 'addons.json');

    if (!fs.existsSync(addonsConfigPath)) {
      return {
        status: 404,
        error: 'Addons configuration not found',
      };
    }

    const config = JSON.parse(fs.readFileSync(addonsConfigPath, 'utf-8'));
    const addon = config.addons[addonId];

    if (!addon) {
      return {
        status: 404,
        error: `Addon "${addonId}" not found`,
      };
    }

    // Execute uninstallation based on addon type
    const result = await uninstallAddonFiles(addonId);

    if (!result.success) {
      return {
        status: 500,
        error: result.error || 'Uninstall failed',
      };
    }

    // Update addon status
    config.addons[addonId].installed = false;
    config.addons[addonId].enabled = false;
    fs.writeFileSync(addonsConfigPath, JSON.stringify(config, null, 2));

    return successResponse({
      success: true,
      message: result.message,
    });
  } catch (error) {
    console.error('[addons-handler] Uninstall error:', error);
    return {
      status: 500,
      error: String(error),
    };
  }
}

async function uninstallAddonFiles(addonId: string): Promise<{ success: boolean; error?: string; message?: string }> {
  const rootPath = systemPaths.root;

  switch (addonId) {
    case 'gpt-sovits': {
      const sovitsDir = path.join(rootPath, 'external', 'gpt-sovits');
      if (!fs.existsSync(sovitsDir)) {
        return { success: true, message: 'GPT-SoVITS already uninstalled' };
      }
      try {
        fs.rmSync(sovitsDir, { recursive: true, force: true });
        return { success: true, message: 'GPT-SoVITS uninstalled successfully' };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'rvc': {
      const rvcDir = path.join(rootPath, 'external', 'applio-rvc');
      if (!fs.existsSync(rvcDir)) {
        return { success: true, message: 'RVC already uninstalled' };
      }
      try {
        fs.rmSync(rvcDir, { recursive: true, force: true });
        return { success: true, message: 'RVC uninstalled successfully' };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    case 'kokoro': {
      const kokoroDir = path.join(rootPath, 'external', 'kokoro');
      if (!fs.existsSync(kokoroDir)) {
        return { success: true, message: 'Kokoro already uninstalled' };
      }
      try {
        // Stop server if running
        const pidFile = path.join(rootPath, 'logs', 'run', 'kokoro-server.pid');
        if (fs.existsSync(pidFile)) {
          try {
            const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
            process.kill(pid, 'SIGTERM');
            fs.unlinkSync(pidFile);
          } catch {
            // Ignore errors stopping server
          }
        }
        fs.rmSync(kokoroDir, { recursive: true, force: true });
        return { success: true, message: 'Kokoro TTS uninstalled successfully' };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    default:
      return { success: false, error: 'Addon uninstallation not implemented' };
  }
}

/**
 * POST /api/addons/mark-installed - Mark an addon as installed
 */
export async function handleMarkAddonInstalled(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body } = req;
  const { addonId, installed } = (body || {}) as { addonId?: string; installed?: boolean };

  if (!addonId) {
    return {
      status: 400,
      error: 'addonId is required',
    };
  }

  try {
    const addonsConfigPath = path.join(systemPaths.etc, 'addons.json');

    if (!fs.existsSync(addonsConfigPath)) {
      return {
        status: 404,
        error: 'Addons configuration not found',
      };
    }

    const config = JSON.parse(fs.readFileSync(addonsConfigPath, 'utf-8'));

    if (!config.addons[addonId]) {
      return {
        status: 404,
        error: `Addon "${addonId}" not found`,
      };
    }

    config.addons[addonId].installed = installed !== undefined ? installed : true;

    fs.writeFileSync(addonsConfigPath, JSON.stringify(config, null, 2));

    return successResponse({
      success: true,
      addonId,
      installed: config.addons[addonId].installed,
    });
  } catch (error) {
    console.error('[addons-handler] Mark installed error:', error);
    return {
      status: 500,
      error: String(error),
    };
  }
}
