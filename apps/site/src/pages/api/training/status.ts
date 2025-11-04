import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

export const GET: APIRoute = async () => {
  try {
    const statusDir = path.join(process.cwd(), 'logs/status');

    if (!fs.existsSync(statusDir)) {
      return new Response(JSON.stringify({ operations: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const files = fs.readdirSync(statusDir)
      .filter(f => f.startsWith('lora-training-') && f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 10); // Last 10 training runs

    const operations = files.map(file => {
      const content = fs.readFileSync(path.join(statusDir, file), 'utf-8');
      return JSON.parse(content);
    });

    return new Response(JSON.stringify({ operations }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
