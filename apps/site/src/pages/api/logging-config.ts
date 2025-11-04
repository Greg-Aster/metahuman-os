import type { APIRoute } from 'astro';
import fs from 'fs';
import path from 'path';

const configPath = path.join(process.cwd(), '../../etc/logging.json');

export const GET: APIRoute = async () => {
  try {
    if (!fs.existsSync(configPath)) {
      // Return template defaults if no config exists
      return new Response(JSON.stringify({
        level: 'info',
        levels: { error: 0, warn: 1, info: 2, debug: 3 },
        suppressPatterns: ['/api/approvals', '/api/status', '/api/monitor', '/api/sleep-status', '/api/activity-ping'],
        logSlowRequests: true,
        slowRequestThresholdMs: 1000,
        console: { enabled: true, colorize: true, timestamp: true }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return new Response(JSON.stringify(config), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Failed to read logging config:', error);
    return new Response(JSON.stringify({ error: 'Failed to read logging config' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const updates = await request.json();

    // Load existing config or use defaults
    let config: any = {
      level: 'info',
      levels: { error: 0, warn: 1, info: 2, debug: 3 },
      suppressPatterns: [],
      logSlowRequests: true,
      slowRequestThresholdMs: 1000,
      console: { enabled: true, colorize: true, timestamp: true },
      file: { enabled: false, path: 'logs/http.log' }
    };

    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }

    // Merge updates
    config = {
      ...config,
      ...updates,
      console: {
        ...config.console,
        ...(updates.console || {})
      }
    };

    // Write updated config
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    return new Response(JSON.stringify({ success: true, config }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Failed to save logging config:', error);
    return new Response(JSON.stringify({ error: 'Failed to save logging config' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
