import type { APIRoute } from 'astro';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const POST: APIRoute = async ({ params }) => {
  const port = parseInt(params.port || '', 10);

  if (isNaN(port) || port < 3001 || port > 3100) {
    return new Response(JSON.stringify({
      error: 'Invalid port number',
      port
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Find the PID of the ttyd process on this port
    const { stdout: pgrepOut } = await execAsync(`pgrep -f "ttyd --port ${port}" || true`);
    const pids = pgrepOut.trim().split('\n').filter(Boolean);

    if (pids.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No terminal found on this port',
        port,
        killed: false
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Kill each matching process
    for (const pid of pids) {
      try {
        await execAsync(`kill ${pid}`);
        console.log(`[terminal/kill] Killed ttyd process ${pid} on port ${port}`);
      } catch (killError) {
        // Process might already be dead
        console.warn(`[terminal/kill] Failed to kill PID ${pid}:`, killError);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Killed terminal on port ${port}`,
      port,
      killed: true,
      pids: pids.map(p => parseInt(p, 10))
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error(`[terminal/kill] Error killing terminal on port ${port}:`, error);
    return new Response(JSON.stringify({
      error: 'Failed to kill terminal',
      port
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
