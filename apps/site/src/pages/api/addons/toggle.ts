import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { stopSovitsServer } from '../../../lib/server/sovits-server';

/**
 * POST /api/addons/toggle
 * Enable/disable an addon
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { addonId, enabled } = await request.json();

    if (!addonId || typeof enabled !== 'boolean') {
      return new Response(
        JSON.stringify({ error: 'Missing addonId or enabled' }),
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

    if (!addon.installed) {
      return new Response(
        JSON.stringify({ error: 'Addon not installed' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update addon enabled status
    addon.enabled = enabled;
    fs.writeFileSync(addonsConfigPath, JSON.stringify(config, null, 2));

    // Apply addon-specific configuration changes
    await toggleAddonConfiguration(addonId, enabled);

    return new Response(
      JSON.stringify({ success: true, enabled }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[API /addons/toggle] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

async function toggleAddonConfiguration(addonId: string, enabled: boolean): Promise<void> {
  const rootPath = path.resolve(process.cwd(), '../..');
  const voiceConfigPath = path.join(rootPath, 'etc', 'voice.json');

  // Handle TTS provider addons (gpt-sovits, rvc, kokoro)
  const ttsProviders = ['gpt-sovits', 'rvc', 'kokoro'];

  if (ttsProviders.includes(addonId)) {
    if (!fs.existsSync(voiceConfigPath)) {
      return; // Voice config doesn't exist, skip
    }

    const voiceConfig = JSON.parse(fs.readFileSync(voiceConfigPath, 'utf-8'));
    const providerMap: Record<string, string> = {
      'gpt-sovits': 'sovits',
      'rvc': 'rvc',
      'kokoro': 'kokoro',
    };

    if (!enabled && voiceConfig.tts?.provider === providerMap[addonId]) {
      // Fallback to Piper when disabling
      voiceConfig.tts.provider = 'piper';
      fs.writeFileSync(voiceConfigPath, JSON.stringify(voiceConfig, null, 2));

      // Stop servers if needed
      if (addonId === 'gpt-sovits') {
        try {
          await stopSovitsServer();
        } catch (error) {
          console.error('[API /addons/toggle] Failed to stop SoVITS server:', error);
        }
      } else if (addonId === 'kokoro') {
        // Stop Kokoro server if running
        const pidFile = path.join(rootPath, 'logs', 'run', 'kokoro-server.pid');
        if (fs.existsSync(pidFile)) {
          try {
            const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
            process.kill(pid, 'SIGTERM');
            fs.unlinkSync(pidFile);
          } catch (error) {
            console.error('[API /addons/toggle] Failed to stop Kokoro server:', error);
          }
        }
      }
    }
  }
}
