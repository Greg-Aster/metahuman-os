/**
 * Legacy CLI Adapters
 *
 * Adapters for CLI-based code assistants:
 * - Claude Code (claude CLI)
 * - Qwen Code (qwen-code CLI)
 * - Aider (aider CLI)
 * - Gemini CLI (gemini CLI)
 *
 * These provide fallback options when Open Interpreter is not available
 * or when users prefer these tools.
 */

import { audit } from './audit.js';
import type { CLIBackendConfig } from './tool-executor-config.js';

// ============================================================================
// Common Types
// ============================================================================

export interface ToolExecutorResult {
  success: boolean;
  output?: string;
  error?: string;
  executionTime?: number;
}

interface CLIExecutionOptions {
  timeout?: number;
  workingDirectory?: string;
  environment?: Record<string, string>;
}

// ============================================================================
// Claude Code Adapter
// ============================================================================

/**
 * Execute a task using Claude Code CLI
 *
 * Claude Code is Anthropic's official CLI for Claude.
 * Uses --print mode for non-interactive execution.
 */
export async function executeWithClaudeCode(
  task: string,
  config: CLIBackendConfig,
  username?: string
): Promise<ToolExecutorResult> {
  const startTime = Date.now();

  try {
    const { spawn } = await import('child_process');

    // Build command arguments
    const args = [...(config.args || ['--print'])];

    // Add permission skip if configured (use with caution!)
    if (config.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    // Add the task as the prompt
    args.push(task);

    audit({
      level: 'info',
      category: 'action',
      event: 'claude_code_started',
      details: {
        task: task.slice(0, 200),
        command: config.command,
        args: args.filter(a => a !== task), // Don't log full task
      },
      actor: username || 'system',
    });

    const result = await runCLI(config.command, args, {
      timeout: config.timeout || 60000,
    });

    return {
      success: result.exitCode === 0,
      output: result.stdout,
      error: result.exitCode !== 0 ? result.stderr || `Exit code: ${result.exitCode}` : undefined,
      backend: 'claude-code',
      executionTime: Date.now() - startTime,
      metadata: {
        exitCode: result.exitCode,
        command: config.command,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      backend: 'claude-code',
      executionTime: Date.now() - startTime,
    };
  }
}

// ============================================================================
// Qwen Code Adapter
// ============================================================================

/**
 * Execute a task using Qwen Code CLI
 *
 * Qwen Code is a fork of Gemini CLI that uses local Qwen models.
 */
export async function executeWithQwenCode(
  task: string,
  config: CLIBackendConfig,
  username?: string
): Promise<ToolExecutorResult> {
  const startTime = Date.now();

  try {
    const args = [...(config.args || [])];
    args.push('--prompt', task);

    // Add model if configured
    if (config.modelId) {
      args.push('--model', config.modelId);
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'qwen_code_started',
      details: {
        task: task.slice(0, 200),
        command: config.command,
        modelId: config.modelId,
      },
      actor: username || 'system',
    });

    const result = await runCLI(config.command, args, {
      timeout: config.timeout || 120000,
    });

    return {
      success: result.exitCode === 0,
      output: result.stdout,
      error: result.exitCode !== 0 ? result.stderr || `Exit code: ${result.exitCode}` : undefined,
      backend: 'qwen-code',
      executionTime: Date.now() - startTime,
      metadata: {
        exitCode: result.exitCode,
        command: config.command,
        modelId: config.modelId,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      backend: 'qwen-code',
      executionTime: Date.now() - startTime,
    };
  }
}

// ============================================================================
// Aider Adapter
// ============================================================================

/**
 * Execute a task using Aider CLI
 *
 * Aider is an AI pair programming tool that integrates with git.
 */
export async function executeWithAider(
  task: string,
  config: CLIBackendConfig,
  username?: string
): Promise<ToolExecutorResult> {
  const startTime = Date.now();

  try {
    const args = [...(config.args || ['--no-auto-commits', '--yes'])];

    // Add message/task
    args.push('--message', task);

    // Add model if configured
    if (config.modelId) {
      args.push('--model', config.modelId);
    }

    // Disable git operations if configured
    if (config.gitEnabled === false) {
      args.push('--no-git');
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'aider_started',
      details: {
        task: task.slice(0, 200),
        command: config.command,
        modelId: config.modelId,
        gitEnabled: config.gitEnabled,
      },
      actor: username || 'system',
    });

    const result = await runCLI(config.command, args, {
      timeout: config.timeout || 180000,
    });

    return {
      success: result.exitCode === 0,
      output: result.stdout,
      error: result.exitCode !== 0 ? result.stderr || `Exit code: ${result.exitCode}` : undefined,
      backend: 'aider',
      executionTime: Date.now() - startTime,
      metadata: {
        exitCode: result.exitCode,
        command: config.command,
        modelId: config.modelId,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      backend: 'aider',
      executionTime: Date.now() - startTime,
    };
  }
}

// ============================================================================
// Gemini CLI Adapter
// ============================================================================

/**
 * Execute a task using Gemini CLI
 *
 * Google's Gemini CLI for interacting with Gemini models.
 */
export async function executeWithGeminiCLI(
  task: string,
  config: CLIBackendConfig,
  username?: string
): Promise<ToolExecutorResult> {
  const startTime = Date.now();

  try {
    const args = [...(config.args || ['--non-interactive'])];

    // Add prompt
    args.push('--prompt', task);

    audit({
      level: 'info',
      category: 'action',
      event: 'gemini_cli_started',
      details: {
        task: task.slice(0, 200),
        command: config.command,
      },
      actor: username || 'system',
    });

    const result = await runCLI(config.command, args, {
      timeout: config.timeout || 120000,
    });

    return {
      success: result.exitCode === 0,
      output: result.stdout,
      error: result.exitCode !== 0 ? result.stderr || `Exit code: ${result.exitCode}` : undefined,
      backend: 'gemini-cli',
      executionTime: Date.now() - startTime,
      metadata: {
        exitCode: result.exitCode,
        command: config.command,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      backend: 'gemini-cli',
      executionTime: Date.now() - startTime,
    };
  }
}

// ============================================================================
// CLI Runner Utility
// ============================================================================

interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a CLI command and capture output
 */
async function runCLI(
  command: string,
  args: string[],
  options: CLIExecutionOptions = {}
): Promise<CLIResult> {
  const { spawn } = await import('child_process');

  return new Promise((resolve, reject) => {
    const timeout = options.timeout || 60000;
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(command, args, {
      cwd: options.workingDirectory,
      env: {
        ...process.env,
        ...options.environment,
        // Ensure non-interactive mode
        TERM: 'dumb',
        NO_COLOR: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Handle timeout
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);
    }, timeout);

    // Collect stdout
    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    // Collect stderr
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Handle process exit
    child.on('close', (code: number | null) => {
      clearTimeout(timer);

      if (timedOut) {
        resolve({
          stdout,
          stderr: stderr || `Command timed out after ${timeout}ms`,
          exitCode: 124, // Standard timeout exit code
        });
      } else {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
        });
      }
    });

    // Handle errors
    child.on('error', (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

// ============================================================================
// Detection Utilities
// ============================================================================

/**
 * Check which CLI tools are installed
 */
export async function detectInstalledCLIs(): Promise<string[]> {
  const { execSync } = await import('child_process');
  const installed: string[] = [];

  const cliTools = [
    { id: 'claude-code', command: 'claude' },
    { id: 'qwen-code', command: 'qwen-code' },
    { id: 'aider', command: 'aider' },
    { id: 'gemini-cli', command: 'gemini' },
  ];

  for (const tool of cliTools) {
    try {
      execSync(`which ${tool.command}`, { encoding: 'utf8', stdio: 'pipe' });
      installed.push(tool.id);
    } catch {
      // Command not found
    }
  }

  return installed;
}

/**
 * Get version of a CLI tool
 */
export async function getCLIVersion(command: string): Promise<string | null> {
  const { execSync } = await import('child_process');

  try {
    const version = execSync(`${command} --version`, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 5000,
    }).trim();
    return version;
  } catch {
    return null;
  }
}
