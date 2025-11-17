import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

/**
 * POST /api/addons/mark-installed
 * Mark an addon as installed in etc/addons.json
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { addonId, installed } = await request.json();

    if (!addonId || typeof installed !== 'boolean') {
      return new Response(
        JSON.stringify({ error: 'Missing addonId or installed flag' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const rootPath = path.resolve(process.cwd(), '../..');
    const addonsConfigPath = path.join(rootPath, 'etc', 'addons.json');

    if (!fs.existsSync(addonsConfigPath)) {
      return new Response(
        JSON.stringify({ error: 'Addons configuration not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const config = JSON.parse(fs.readFileSync(addonsConfigPath, 'utf-8'));
    const addon = config.addons[addonId];

    if (!addon) {
      return new Response(
        JSON.stringify({ error: 'Addon not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Update installation status
    addon.installed = installed;
    fs.writeFileSync(addonsConfigPath, JSON.stringify(config, null, 2));

    return new Response(
      JSON.stringify({ success: true, installed }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[API /addons/mark-installed] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
