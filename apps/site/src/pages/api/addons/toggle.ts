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

  switch (addonId) {
    case 'gpt-sovits': {
      // Update voice.json provider setting
      const voiceConfigPath = path.join(rootPath, 'etc', 'voice.json');

      if (fs.existsSync(voiceConfigPath)) {
        const voiceConfig = JSON.parse(fs.readFileSync(voiceConfigPath, 'utf-8'));
        // Only change provider if enabling and provider is not already set
        if (enabled && voiceConfig.tts.provider !== 'gpt-sovits') {
          // Don't automatically switch - let user choose
          // voiceConfig.tts.provider = 'gpt-sovits';
        }
        // fs.writeFileSync(voiceConfigPath, JSON.stringify(voiceConfig, null, 2));
      }
      break;
    }

    default:
      // No configuration changes needed
      break;
  }
}
