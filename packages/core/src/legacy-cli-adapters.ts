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
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CLIBackendConfig } from './tool-executor-config.js';

// ============================================================================
// Common Types
// ============================================================================

export interface ToolExecutorResult {
  success: boolean;
  output?: string;
  error?: string;
  executionTime?: number;
  metadata?: Record<string, any>;
}

interface CLIExecutionOptions {
  timeout?: number;
  workingDirectory?: string;
  environment?: Record<string, string>;
  stdin?: string;
}

interface ReasoningStep {
  type: 'thought' | 'action' | 'observation' | 'result' | 'tool_use';
  content: string;
  timestamp: string;
  toolName?: string;
  success?: boolean;
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
// Codex CLI Adapter
// ============================================================================

/**
 * Execute a task using Codex CLI
 *
 * OpenAI Codex CLI execution via stdin prompt.
 */
export async function executeWithCodexCLI(
  task: string,
  config: CLIBackendConfig,
  options?: { timeout?: number; workingDirectory?: string; onReasoningStep?: (step: ReasoningStep) => void },
  username?: string
): Promise<ToolExecutorResult> {
  const startTime = Date.now();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-'));
  const lastMessagePath = path.join(tempDir, 'last-message.txt');

  try {
    const args = [...(config.args || [])];
    if (args.length === 0 || (args[0] !== 'exec' && args[0] !== 'e')) {
      args.unshift('exec');
    }
    if (!args.includes('--color')) {
      args.push('--color', 'always');
    }
    if (!args.includes('--json')) {
      args.push('--json');
    }
    if (!args.includes('--output-last-message')) {
      args.push('--output-last-message', lastMessagePath);
    }
    if (config.dangerouslySkipPermissions && !args.includes('--dangerously-bypass-approvals-and-sandbox')) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'codex_cli_started',
      details: {
        task: task.slice(0, 200),
        command: config.command,
      },
      actor: username || 'system',
    });

    const result = await runCLI(config.command, args, {
      timeout: options?.timeout || config.timeout || 120000,
      workingDirectory: options?.workingDirectory,
      stdin: task,
    });

    if (options?.onReasoningStep && result.stdout) {
      const lines = result.stdout.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
          const parsed = JSON.parse(trimmed);
          const msg = parsed?.msg;
          if (!msg || typeof msg !== 'object') continue;

          if (msg.type === 'agent_reasoning' && typeof msg.text === 'string' && msg.text.trim()) {
            options.onReasoningStep({
              type: 'thought',
              content: msg.text.trim(),
              timestamp: new Date().toISOString(),
            });
          } else if (msg.type === 'tool_use' && msg.tool) {
            options.onReasoningStep({
              type: 'tool_use',
              toolName: String(msg.tool),
              content: String(msg.input || '').slice(0, 500),
              timestamp: new Date().toISOString(),
            });
          }
        } catch {
          // Ignore non-JSON lines
        }
      }
    }

    let output = result.stdout;
    if (fs.existsSync(lastMessagePath)) {
      const lastMessage = fs.readFileSync(lastMessagePath, 'utf8').trim();
      if (lastMessage) {
        output = lastMessage;
      }
    }

    return {
      success: result.exitCode === 0,
      output,
      error: result.exitCode !== 0 ? result.stderr || `Exit code: ${result.exitCode}` : undefined,
      backend: 'codex',
      executionTime: Date.now() - startTime,
      metadata: {
        exitCode: result.exitCode,
        command: config.command,
        rawStdout: result.stdout,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      backend: 'codex',
      executionTime: Date.now() - startTime,
    };
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
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

    if (options.stdin) {
      child.stdin?.write(options.stdin);
      child.stdin?.end();
    }

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
