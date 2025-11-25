/**
 * shell_execute Skill
 * Execute bash commands with full terminal capabilities
 * This allows the AI to run commands and read output
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { SkillManifest, SkillResult } from '../../packages/core/src/skills.js';
import { paths } from '../../packages/core/src/index.js';

const TIMEOUT_MS = 60000; // 60 seconds
const MAX_OUTPUT_LENGTH = 100000; // 100KB

export const manifest: SkillManifest = {
  id: 'shell_execute',
  name: 'Execute Shell Command',
  description: 'Execute a bash command and return its output. Use this to run terminal commands, check file contents, install packages, run tests, etc.',
  category: 'shell',

  inputs: {
    command: {
      type: 'string',
      required: true,
      description: 'The full bash command to execute (e.g., "ls -la", "git status", "pnpm install")',
    },
    cwd: {
      type: 'string',
      required: false,
      description: 'Working directory (default: metahuman root)',
    },
    timeout: {
      type: 'number',
      required: false,
      description: 'Timeout in milliseconds (default: 60000)',
    },
  },

  outputs: {
    stdout: { type: 'string', description: 'Standard output from the command' },
    stderr: { type: 'string', description: 'Standard error from the command' },
    exitCode: { type: 'number', description: 'Process exit code (0 = success)' },
    timedOut: { type: 'boolean', description: 'Whether the command timed out' },
  },

  risk: 'high',
  cost: 'expensive',
  minTrustLevel: 'bounded_auto',
  requiresApproval: true,
};

export async function execute(inputs: {
  command: string;
  cwd?: string;
  timeout?: number;
}): Promise<SkillResult> {
  try {
    const command = inputs.command.trim();
    const cwd = inputs.cwd ? path.resolve(inputs.cwd) : paths.root;
    const timeout = inputs.timeout ?? TIMEOUT_MS;

    // Validate command is not empty
    if (!command) {
      return {
        success: false,
        error: 'Command cannot be empty',
      };
    }

    // Validate working directory exists and is within metahuman root
    if (!cwd.startsWith(paths.root)) {
      return {
        success: false,
        error: `Working directory must be within metahuman root: ${cwd}`,
      };
    }

    // Security: Block obviously dangerous commands
    const dangerousPatterns = [
      /rm\s+-rf\s+\//, // rm -rf /
      /:\(\)\{.*:\|:/, // fork bomb
      /mkfs/, // format filesystem
      /dd\s+if=.*of=\/dev/, // disk wipe
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return {
          success: false,
          error: 'Command blocked: potentially destructive operation detected',
        };
      }
    }

    // Execute command using bash -c
    return new Promise((resolve) => {
      let timedOut = false;
      const child = spawn('bash', ['-c', command], {
        cwd,
        env: { ...process.env, PATH: process.env.PATH },
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
        // Truncate if output is too large
        if (stdout.length > MAX_OUTPUT_LENGTH) {
          stdout = stdout.slice(0, MAX_OUTPUT_LENGTH) + '\n... [output truncated]';
          child.kill();
        }
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
        // Truncate if output is too large
        if (stderr.length > MAX_OUTPUT_LENGTH) {
          stderr = stderr.slice(0, MAX_OUTPUT_LENGTH) + '\n... [output truncated]';
          child.kill();
        }
      });

      child.on('close', (code) => {
        resolve({
          success: code === 0 && !timedOut,
          outputs: {
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: code ?? -1,
            timedOut,
          },
        });
      });

      child.on('error', (error) => {
        resolve({
          success: false,
          error: `Command execution failed: ${error.message}`,
        });
      });

      // Timeout handler
      const timeoutHandle = setTimeout(() => {
        if (!child.killed) {
          timedOut = true;
          child.kill('SIGTERM');
          // Force kill after 2 seconds if still running
          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 2000);
        }
      }, timeout);

      child.on('exit', () => {
        clearTimeout(timeoutHandle);
      });
    });
  } catch (error) {
    return {
      success: false,
      error: `Failed to execute command: ${(error as Error).message}`,
    };
  }
}
