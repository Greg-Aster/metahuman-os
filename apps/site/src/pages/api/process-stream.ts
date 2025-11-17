import type { APIRoute } from 'astro';
import { spawn } from 'node:child_process';
import path from 'node:path';

/**
 * POST /api/process-stream
 * Universal real-time process execution with Server-Sent Events
 *
 * Request body:
 * {
 *   command: string,           // Command to execute (e.g., 'bash', 'python3')
 *   args: string[],           // Arguments array
 *   cwd?: string,             // Working directory (defaults to project root)
 *   env?: Record<string,string> // Environment variables
 * }
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { command, args = [], cwd, env } = body;

    if (!command) {
      return new Response('Missing command parameter', { status: 400 });
    }

    const rootPath = path.resolve(process.cwd(), '../..');
    const workingDir = cwd ? path.resolve(rootPath, cwd) : rootPath;

    // Security: Whitelist allowed commands
    const allowedCommands = [
      'bash',
      'sh',
      'python3',
      'python',
      'node',
      'tsx',
      'pnpm',
      'npm',
      'ollama',
    ];

    if (!allowedCommands.includes(command)) {
      return new Response(
        `Command not allowed: ${command}. Allowed: ${allowedCommands.join(', ')}`,
        { status: 403 }
      );
    }

    // Create SSE stream
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        const send = (event: string, data: any) => {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        };

        // Start process
        const proc = spawn(command, args, {
          cwd: workingDir,
          stdio: 'pipe',
          env: { ...process.env, ...env },
        });

        send('start', {
          command,
          args,
          cwd: workingDir,
          pid: proc.pid,
          message: 'Process started',
        });

        // Stream stdout
        proc.stdout?.on('data', (data) => {
          const lines = data
            .toString()
            .split('\n')
            .filter((l: string) => l.trim());

          lines.forEach((line: string) => {
            console.log(`[Process ${proc.pid}]`, line);
            send('log', { level: 'info', message: line });
          });
        });

        // Stream stderr
        proc.stderr?.on('data', (data) => {
          const lines = data
            .toString()
            .split('\n')
            .filter((l: string) => l.trim());

          lines.forEach((line: string) => {
            console.error(`[Process ${proc.pid} Error]`, line);
            send('log', { level: 'error', message: line });
          });
        });

        // Handle completion
        proc.on('close', (code) => {
          if (code === 0) {
            send('complete', {
              success: true,
              code,
              message: 'Process completed successfully',
            });
          } else {
            send('complete', {
              success: false,
              code,
              error: `Process exited with code ${code}`,
            });
          }
          controller.close();
        });

        // Handle errors
        proc.on('error', (error) => {
          send('error', { message: error.message });
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: String(error) }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
