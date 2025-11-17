import type { APIRoute } from 'astro';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * POST /api/addons/uninstall
 * Uninstall an addon
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { addonId } = await request.json();

    if (!addonId) {
      return new Response(
        JSON.stringify({ error: 'Missing addonId' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Load addon configuration using system paths
    const rootPath = path.resolve(process.cwd(), '../..');
    const addonsConfigPath = path.join(rootPath, 'etc', 'addons.json');
    const config = JSON.parse(fs.readFileSync(addonsConfigPath, 'utf-8'));
    const addon = config.addons[addonId];

    if (!addon) {
      return new Response(
        JSON.stringify({ error: 'Addon not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Execute uninstallation
    const result = await uninstallAddon(addonId, addon);

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: result.error }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update addon status
    addon.installed = false;
    addon.enabled = false;
    fs.writeFileSync(addonsConfigPath, JSON.stringify(config, null, 2));

    return new Response(
      JSON.stringify({ success: true, message: result.message }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[API /addons/uninstall] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

async function uninstallAddon(addonId: string, addon: any): Promise<{ success: boolean; error?: string; message?: string }> {
  const rootPath = path.resolve(process.cwd(), '../..');

  switch (addonId) {
    case 'gpt-sovits': {
      const sovitsDir = path.join(rootPath, 'external', 'gpt-sovits');

      if (!fs.existsSync(sovitsDir)) {
        return { success: true, message: 'GPT-SoVITS already uninstalled' };
      }

      try {
        // Remove directory
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
        // Remove directory
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

        // Remove directory
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
