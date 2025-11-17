import type { APIRoute } from 'astro';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';

const execAsync = promisify(exec);

/**
 * GET: List running Astro dev servers
 */
const getHandler: APIRoute = async ({ url }) => {
  try {
    const currentPort = parseInt(url.port || '4321');

    // Check common Astro dev ports
    const portsToCheck = [4321, 4322, 4323, 4324, 4325];
    const servers: any[] = [];

    for (const port of portsToCheck) {
      try {
        // Check if port is in use and get PID
        const { stdout } = await execAsync(`lsof -ti:${port}`, { timeout: 2000 });
        const pids = stdout.trim().split('\n').filter(Boolean);

        if (pids.length > 0) {
          // Check all PIDs on this port (there might be multiple processes)
          for (const pid of pids) {
            try {
              const { stdout: psOutput } = await execAsync(`ps -p ${pid} -o cmd=`, { timeout: 1000 });
              const command = psOutput.trim();

              // Only include if it's an Astro/Node process
              if (command.includes('astro') || command.includes('node') || command.includes('vite')) {
                servers.push({
                  port,
                  pid: parseInt(pid),
                  command: command.length > 60 ? command.substring(0, 57) + '...' : command,
                  isCurrentServer: port === currentPort,
                });
                break; // Only add one Astro server per port
              }
            } catch {}
          }
        }
      } catch {
        // Port not in use, skip
      }
    }

    return new Response(
      JSON.stringify({
        running: servers.length > 0,
        servers,
        currentPort,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[astro-servers] Error checking status:', error);
    return new Response(
      JSON.stringify({ running: false, error: String(error), servers: [] }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * POST: Stop Astro dev server(s)
 */
const postHandler: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { action, port } = body;

    if (action === 'stop' && port) {
      try {
        // Get PIDs on this port
        const { stdout } = await execAsync(`lsof -ti:${port}`, { timeout: 2000 });
        const pids = stdout.trim().split('\n').filter(Boolean);

        if (pids.length === 0) {
          return new Response(
            JSON.stringify({ success: false, error: 'No process found on this port' }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Kill all processes on this port
        for (const pid of pids) {
          try {
            await execAsync(`kill -TERM ${pid}`, { timeout: 2000 });
          } catch (killError) {
            // Process might already be dead, that's ok
          }
        }

        return new Response(
          JSON.stringify({
            success: true,
            message: `Stopped ${pids.length} process(es) on port ${port}`,
            stoppedPids: pids.map(p => parseInt(p)),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      } catch (error) {
        return new Response(
          JSON.stringify({ success: false, error: String(error) }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else if (action === 'stop-all') {
      // Stop all Astro servers
      const portsToCheck = [4321, 4322, 4323, 4324, 4325];
      const stopped: number[] = [];

      for (const port of portsToCheck) {
        try {
          const { stdout } = await execAsync(`lsof -ti:${port}`, { timeout: 2000 });
          const pids = stdout.trim().split('\n').filter(Boolean);

          for (const pid of pids) {
            try {
              await execAsync(`kill -TERM ${pid}`, { timeout: 2000 });
              stopped.push(parseInt(pid));
            } catch {}
          }
        } catch {}
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: `Stopped ${stopped.length} process(es)`,
          stoppedPids: stopped,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    } else {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid action or missing port' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('[astro-servers] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const GET = getHandler;
export const POST = postHandler;
