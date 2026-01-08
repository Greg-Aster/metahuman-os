import type { APIRoute } from 'astro';
import { exec } from 'child_process';
import { promisify } from 'util';
import { bigBrotherTerminal } from '@metahuman/core';

const execAsync = promisify(exec);

interface RunningTerminal {
  pid: number;
  port: number;
  command?: string;
  cwd?: string;
  isBigBrother?: boolean;
}

export const GET: APIRoute = async () => {
  try {
    // Find all running ttyd processes
    const { stdout } = await execAsync('pgrep -fa "ttyd --port" || true');

    const terminals: RunningTerminal[] = [];

    if (stdout.trim()) {
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        // Parse: PID /path/to/ttyd --port XXXX [--writable] [--cwd PATH] [command...]
        const pidMatch = line.match(/^(\d+)\s+/);
        const portMatch = line.match(/--port\s+(\d+)/);
        const cwdMatch = line.match(/--cwd\s+(\S+)/);

        if (pidMatch && portMatch) {
          const pid = parseInt(pidMatch[1], 10);
          const port = parseInt(portMatch[1], 10);

          // Extract command (everything after the last known flag)
          let command: string | undefined;
          const bashIndex = line.indexOf(' bash');
          if (bashIndex > -1) {
            const afterBash = line.substring(bashIndex + 5).trim();
            if (afterBash.startsWith('-c ')) {
              command = afterBash.substring(3).trim();
            }
          }

          terminals.push({
            pid,
            port,
            command: command || undefined,
            cwd: cwdMatch?.[1]
          });
        }
      }
    }

    // Check if Big Brother terminal is running and add it to the list
    const bigBrotherState = bigBrotherTerminal.getState();
    if (bigBrotherState.isRunning && bigBrotherState.pid) {
      // Add Big Brother terminal if not already in list (it won't be found by pgrep)
      const existingBigBrother = terminals.find(t => t.port === bigBrotherState.port);
      if (!existingBigBrother) {
        terminals.push({
          pid: bigBrotherState.pid,
          port: bigBrotherState.port,
          command: 'claude --dangerously-skip-permissions',
          isBigBrother: true
        });
      }
    }

    // Sort by port
    terminals.sort((a, b) => a.port - b.port);

    return new Response(JSON.stringify({
      terminals,
      count: terminals.length
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[terminal/list] Error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to list terminals',
      terminals: [],
      count: 0
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
