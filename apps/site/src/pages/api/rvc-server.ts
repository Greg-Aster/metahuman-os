import type { APIRoute } from 'astro';
import {
  getRvcServerStatus,
  startRvcServer,
  stopRvcServer,
} from '../../lib/rvc-server';

/**
 * GET /api/rvc-server
 * Check RVC server status
 */
export const GET: APIRoute = async () => {
  try {
    const status = await getRvcServerStatus();
    return new Response(JSON.stringify(status), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[API /rvc-server GET] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error), running: false }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * POST /api/rvc-server
 * Start or stop RVC server
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const { action } = await request.json();

    if (action === 'start') {
      const result = await startRvcServer();
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      });
    } else if (action === 'stop') {
      const result = await stopRvcServer();
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      });
    } else if (action === 'restart') {
      // Stop then start
      await stopRvcServer();
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const result = await startRvcServer();
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action. Use "start", "stop", or "restart".' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[API /rvc-server POST] Error:', error);
    return new Response(
      JSON.stringify({ error: String(error), success: false }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
