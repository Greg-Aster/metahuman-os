import type { APIRoute } from 'astro';
import {
  getSovitsServerStatus,
  startSovitsServer,
  stopSovitsServer,
} from '../../lib/sovits-server';

/**
 * GET /api/sovits-server
 * Check GPT-SoVITS server status
 */
export const GET: APIRoute = async () => {
  try {
    const status = await getSovitsServerStatus();
    return new Response(JSON.stringify(status), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[API /sovits-server GET] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error), running: false }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * POST /api/sovits-server
 * Start or stop GPT-SoVITS server
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { action, port } = await request.json();

    if (action === 'start') {
      const result = await startSovitsServer(port || 9880);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      });
    } else if (action === 'stop') {
      const result = await stopSovitsServer();
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action. Use "start" or "stop".' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[API /sovits-server POST] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error), success: false }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
