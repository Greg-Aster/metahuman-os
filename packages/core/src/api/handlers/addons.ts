/**
 * Addons API Handlers
 *
 * Unified handlers for addon management endpoints.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { systemPaths } from '../../paths.js';

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

    // Toggle or set enabled status
    const newEnabled = enabled !== undefined ? enabled : !config.addons[addonId].enabled;
    config.addons[addonId].enabled = newEnabled;

    fs.writeFileSync(addonsConfigPath, JSON.stringify(config, null, 2));

    return successResponse({
      success: true,
      addonId,
      enabled: newEnabled,
    });
  } catch (error) {
    console.error('[addons-handler] Toggle error:', error);
    return {
      status: 500,
      error: String(error),
    };
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
