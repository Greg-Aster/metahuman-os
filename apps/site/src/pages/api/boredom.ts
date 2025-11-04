
import type { APIRoute } from 'astro';
import { ROOT } from '@metahuman/core/paths';
import fs from 'node:fs/promises';
import path from 'node:path';

const boredomConfigPath = path.join(ROOT, 'etc', 'boredom.json');

export const GET: APIRoute = async () => {
  try {
    const configData = await fs.readFile(boredomConfigPath, 'utf-8');
    const config = JSON.parse(configData);
    return new Response(JSON.stringify({
      level: config.level,
      showInChat: config.showInChat !== undefined ? config.showInChat : true
    }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const { level, showInChat } = await request.json();

    const configData = await fs.readFile(boredomConfigPath, 'utf-8');
    const config = JSON.parse(configData);

    if (level !== undefined) {
      config.level = level;
    }

    if (showInChat !== undefined) {
      config.showInChat = showInChat;
    }

    await fs.writeFile(boredomConfigPath, JSON.stringify(config, null, 2));

    return new Response(JSON.stringify({ success: true, level: config.level, showInChat: config.showInChat }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500 });
  }
};
