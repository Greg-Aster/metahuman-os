/**
 * API endpoint for executing CLI commands
 */
import type { APIRoute } from 'astro';
import { spawn } from 'child_process';
import { paths } from '@metahuman/core';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { command, args = [] } = await request.json();

    if (!command) {
      return new Response(JSON.stringify({ error: 'Command is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate command is an allowed mh command
    const allowedCommands = [
      'init', 'status', 'capture', 'remember', 'task', 'trust',
      'sync', 'agent', 'ollama', 'help', 'guide'
    ];

    if (!allowedCommands.includes(command)) {
      return new Response(JSON.stringify({ error: `Command '${command}' not allowed` }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Execute command
    const mhPath = `${paths.root}/packages/cli/src/mh-new.ts`;
    const child = spawn('tsx', [mhPath, command, ...args], {
      cwd: paths.root,
      env: process.env,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', (code) => resolve(code || 0));
    });

    return new Response(
      JSON.stringify({
        success: exitCode === 0,
        exitCode,
        stdout,
        stderr,
        command: `mh ${command} ${args.join(' ')}`,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
