import type { APIRoute } from 'astro';
import { spawn } from 'node:child_process';
import path from 'node:path';

/**
 * GET /api/addons/install-stream?addonId=kokoro
 * Stream installation logs in real-time using Server-Sent Events
 */
export const GET: APIRoute = async ({ url }) => {
  const addonId = url.searchParams.get('addonId');

  if (!addonId) {
    return new Response('Missing addonId parameter', { status: 400 });
  }

  const rootPath = path.resolve(process.cwd(), '../..');
  let scriptPath: string;
  let args: string[] = [];

  // Determine installation script based on addon
  switch (addonId) {
    case 'kokoro':
      scriptPath = path.join(rootPath, 'bin', 'install-kokoro.sh');
      args = ['--yes'];
      break;
    case 'gpt-sovits':
      scriptPath = path.join(rootPath, 'bin', 'install-sovits.sh');
      break;
    case 'rvc':
      scriptPath = path.join(rootPath, 'bin', 'install-rvc.sh');
      break;
    default:
      return new Response(`Unsupported addon: ${addonId}`, { status: 400 });
  }

  // Create SSE stream
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Start installation process
      const proc = spawn('bash', [scriptPath, ...args], {
        cwd: rootPath,
        stdio: 'pipe',
      });

      send('start', { addonId, message: 'Installation started' });

      // Stream stdout
      proc.stdout?.on('data', (data) => {
        const lines = data.toString().split('\n').filter((l: string) => l.trim());
        lines.forEach((line: string) => {
          console.log('[Install Stream]', line);
          send('log', { level: 'info', message: line });
        });
      });

      // Stream stderr
      proc.stderr?.on('data', (data) => {
        const lines = data.toString().split('\n').filter((l: string) => l.trim());
        lines.forEach((line: string) => {
          console.error('[Install Stream Error]', line);
          send('log', { level: 'error', message: line });
        });
      });

      // Handle completion
      proc.on('close', (code) => {
        if (code === 0) {
          send('complete', { success: true, message: 'Installation completed successfully' });
        } else {
          send('complete', { success: false, error: `Installation failed with exit code ${code}` });
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
};
