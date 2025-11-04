import type { APIRoute } from 'astro';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { paths } from '@metahuman/core';

const MEMORY_DIR = path.join(paths.root, 'memory');
const LOGS_DIR = path.join(paths.root, 'logs');
const CHAT_ARCHIVE_DIR = path.join(paths.root, 'out', 'chat');
const AGENT_PATH = path.join(paths.root, 'etc', 'agent.json');

async function emptyDirectory(dir: string, preserve: Set<string> = new Set()) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      if (preserve.has(entry.name)) return;
      const fullPath = path.join(dir, entry.name);
      await fs.rm(fullPath, { recursive: true, force: true });
    }));
  } catch (error) {
    // If the directory is missing we recreate it later. Ignore ENOENT.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    await fs.mkdir(dir, { recursive: true });
  }
}

async function ensureDirectory(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function resetAgentConfig() {
  const baseConfig = {
    model: 'gpt-oss:latest',
  };
  await fs.mkdir(path.dirname(AGENT_PATH), { recursive: true });
  await fs.writeFile(AGENT_PATH, JSON.stringify(baseConfig, null, 2) + '\n', 'utf-8');
}

export const POST: APIRoute = async () => {
  try {
    await ensureDirectory(MEMORY_DIR);
    await ensureDirectory(LOGS_DIR);
    await ensureDirectory(CHAT_ARCHIVE_DIR);

    await emptyDirectory(MEMORY_DIR, new Set(['README.md', 'schema.json']));
    await emptyDirectory(LOGS_DIR);
    await emptyDirectory(CHAT_ARCHIVE_DIR);

    await resetAgentConfig();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[reset-factory] Failed:', error);
    return new Response(JSON.stringify({ success: false, error: (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });
};
