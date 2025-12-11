import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

export const GET: APIRoute = async ({ params }) => {
  try {
    const { operation } = params;
    const statusFile = path.join(process.cwd(), 'logs/status', `${operation}.json`);

    if (!fs.existsSync(statusFile)) {
      return new Response(
        JSON.stringify({ error: 'Training operation not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const content = fs.readFileSync(statusFile, 'utf-8');
    const status = JSON.parse(content);

    // Calculate if hung (heartbeat > 2 minutes old)
    const lastHeartbeat = new Date(status.lastHeartbeat);
    const now = new Date();
    const minutesSinceHeartbeat = (now.getTime() - lastHeartbeat.getTime()) / 60000;
    status.isHung = minutesSinceHeartbeat > 2 && status.overallStatus === 'running';

    // Calculate elapsed time
    if (status.startedAt) {
      const started = new Date(status.startedAt);
      status.elapsedSeconds = Math.floor((now.getTime() - started.getTime()) / 1000);
    }

    return new Response(JSON.stringify(status), {
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
