import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

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
  const addonsConfigPath = path.join(rootPath, 'etc', 'addons.json');

  // Handle TTS provider addons (gpt-sovits, rvc, piper)
  const ttsProviders = ['gpt-sovits', 'rvc'];

  if (ttsProviders.includes(addonId)) {
    if (!fs.existsSync(voiceConfigPath)) {
      return; // Voice config doesn't exist, skip
    }

    const voiceConfig = JSON.parse(fs.readFileSync(voiceConfigPath, 'utf-8'));
    const addonsConfig = JSON.parse(fs.readFileSync(addonsConfigPath, 'utf-8'));

    if (enabled) {
      // Enable this TTS provider - disable conflicting ones
      const providerMap: Record<string, string> = {
        'gpt-sovits': 'sovits',
        'rvc': 'rvc'
      };

      const newProvider = providerMap[addonId];

      if (newProvider) {
        // Set this as the active provider
        voiceConfig.tts.provider = newProvider;

        // Disable other TTS addons
        for (const otherProvider of ttsProviders) {
          if (otherProvider !== addonId && addonsConfig.addons[otherProvider]) {
            addonsConfig.addons[otherProvider].enabled = false;
          }
        }

        // Save both configs
        fs.writeFileSync(voiceConfigPath, JSON.stringify(voiceConfig, null, 2));
        fs.writeFileSync(addonsConfigPath, JSON.stringify(addonsConfig, null, 2));
      }
    } else {
      // Disabling - fall back to piper (default)
      const currentProvider = voiceConfig.tts.provider;
      const providerMap: Record<string, string> = {
        'gpt-sovits': 'sovits',
        'rvc': 'rvc'
      };

      // If this addon's provider is active, switch to piper
      if (currentProvider === providerMap[addonId]) {
        voiceConfig.tts.provider = 'piper';
        fs.writeFileSync(voiceConfigPath, JSON.stringify(voiceConfig, null, 2));
      }
    }
  }
}
