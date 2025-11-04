/**
 * shell_safe Skill
 * Execute whitelisted shell commands
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { SkillManifest, SkillResult, isCommandWhitelisted } from '../../packages/core/src/skills.js';
import { paths } from '../../packages/core/src/index.js';

const COMMAND_WHITELIST = ['ls', 'cat', 'grep', 'find', 'git', 'pnpm', 'node', 'tsx', 'pwd', 'whoami'];
const TIMEOUT_MS = 30000; // 30 seconds

export const manifest: SkillManifest = {
  id: 'shell_safe',
  name: 'Safe Shell Command',
  description: 'Execute a whitelisted shell command',
  category: 'shell',

  inputs: {
    command: {
      type: 'string',
      required: true,
      description: 'Command to execute',
      validation: (value) => isCommandWhitelisted(value, COMMAND_WHITELIST),
    },
    args: {
      type: 'array',
      required: false,
      description: 'Command arguments',
    },
    cwd: {
      type: 'string',
      required: false,
      description: 'Working directory (default: metahuman root)',
    },
  },

  outputs: {
    stdout: { type: 'string', description: 'Command output' },
    stderr: { type: 'string', description: 'Error output' },
    exitCode: { type: 'number', description: 'Process exit code' },
  },

  risk: 'high',
  cost: 'expensive',
  minTrustLevel: 'bounded_auto',
  requiresApproval: true,
  commandWhitelist: COMMAND_WHITELIST,
};

export async function execute(inputs: {
  command: string;
  args?: string[];
  cwd?: string;
}): Promise<SkillResult> {
  try {
    const command = inputs.command;
    const args = inputs.args ?? [];
    const cwd = inputs.cwd ? path.resolve(inputs.cwd) : paths.root;

    // Validate command is whitelisted
    if (!isCommandWhitelisted(command, COMMAND_WHITELIST)) {
      return {
        success: false,
        error: `Command not whitelisted: ${command}`,
      };
    }

    // Validate working directory is within metahuman root
    if (!cwd.startsWith(paths.root)) {
      return {
        success: false,
        error: `Working directory must be within metahuman root: ${cwd}`,
      };
    }

    // Execute command
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd,
        timeout: TIMEOUT_MS,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          success: code === 0,
          outputs: {
            stdout,
            stderr,
            exitCode: code ?? -1,
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
      setTimeout(() => {
        if (!child.killed) {
          child.kill();
          resolve({
            success: false,
            error: `Command timed out after ${TIMEOUT_MS}ms`,
          });
        }
      }, TIMEOUT_MS + 1000);
    });
  } catch (error) {
    return {
      success: false,
      error: `Failed to execute command: ${(error as Error).message}`,
    };
  }
}
