/**
 * Execute CLI Command API Handler
 *
 * POST to execute allowed CLI commands.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { spawn } from 'node:child_process';
import { systemPaths } from '../../paths.js';

const ALLOWED_COMMANDS = [
  'init', 'status', 'capture', 'remember', 'task', 'trust',
  'sync', 'agent', 'ollama', 'help', 'guide'
];

/**
 * POST /api/execute - Execute an allowed CLI command
 */
export async function handleExecuteCommand(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const { command, args = [] } = req.body || {};

    if (!command) {
      return {
        status: 400,
        error: 'Command is required',
      };
    }

    // Validate command is an allowed mh command
    if (!ALLOWED_COMMANDS.includes(command)) {
      return {
        status: 403,
        error: `Command '${command}' not allowed`,
      };
    }

    // Execute command
    const mhPath = `${systemPaths.root}/packages/cli/src/mh-new.ts`;
    const child = spawn('tsx', [mhPath, command, ...args], {
      cwd: systemPaths.root,
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

    return successResponse({
      success: exitCode === 0,
      exitCode,
      stdout,
      stderr,
      command: `mh ${command} ${args.join(' ')}`,
    });
  } catch (error) {
    console.error('[execute] POST failed:', error);
    return {
      status: 500,
      error: (error as Error).message,
    };
  }
}
