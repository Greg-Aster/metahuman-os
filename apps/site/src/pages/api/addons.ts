import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

/**
 * GET /api/addons
 * Returns list of available addons and their status
 */
export const GET: APIRoute = async () => {
  try {
    // Use absolute path - go up 3 levels from apps/site to project root
    const rootPath = path.resolve(process.cwd(), '../..');
    const addonsConfigPath = path.join(rootPath, 'etc', 'addons.json');

    if (!fs.existsSync(addonsConfigPath)) {
      return new Response(
        JSON.stringify({
          error: 'Addons configuration not found',
          debug: {
            cwd: process.cwd(),
            rootPath,
            addonsConfigPath,
            exists: fs.existsSync(addonsConfigPath)
          }
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
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

    return new Response(
      JSON.stringify({
        addons: enrichedAddons,
        categories: config.categories,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[API /addons] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * Check if an addon is actually installed
 */
async function checkAddonInstalled(addonId: string, addon: any): Promise<boolean> {
  const rootPath = path.resolve(process.cwd(), '../..');

  switch (addonId) {
    case 'gpt-sovits': {
      const sovitsDir = path.join(rootPath, 'external', 'gpt-sovits');
      return fs.existsSync(sovitsDir);
    }
    case 'rvc': {
      const rvcDir = path.join(rootPath, 'external', 'applio-rvc');
      return fs.existsSync(rvcDir);
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
