/**
 * Codex CLI Backend
 *
 * Escalation backend using OpenAI Codex CLI.
 *
 * Features:
 * - OpenAI Codex CLI access
 * - Non-interactive execution via stdin
 */

import { execSync } from 'child_process';
import { audit } from '../audit.js';
import {
  type EscalationBackend,
  type EscalationOptions,
  type EscalationResult,
  registerBackend,
} from '../escalation-backend.js';
import { BACKEND_IDS } from '../escalation-constants.js';
import { executeWithCodexCLI } from '../legacy-cli-adapters.js';
import { loadToolExecutorConfig, type CLIBackendConfig } from '../tool-executor-config.js';

class CodexBackendImpl implements EscalationBackend {
  readonly id = BACKEND_IDS.CODEX;
  readonly name = 'Codex CLI';
  readonly description = 'OpenAI Codex command-line interface';
  readonly supportsStreaming = false;

  private ready = false;

  async isAvailable(): Promise<boolean> {
    return isCodexInstalled();
  }

  isReady(): boolean {
    return this.ready;
  }

  async start(): Promise<boolean> {
    if (await this.isAvailable()) {
      this.ready = true;
      audit({
        level: 'info',
        category: 'system',
        event: 'codex_backend_ready',
        details: {},
        actor: 'codex-backend',
      });
      return true;
    }
    return false;
  }

  stop(): void {
    this.ready = false;
  }

  async execute(prompt: string, options?: EscalationOptions): Promise<EscalationResult> {
    const startTime = Date.now();

    try {
      const config = loadToolExecutorConfig();
      const codexConfig = config.backends.codex as CLIBackendConfig;

      if (!codexConfig.enabled) {
        return {
          success: false,
          output: '',
          error: 'Codex CLI backend is not enabled in configuration',
          executionTime: Date.now() - startTime,
        };
      }

      const reasoningCallback = (step: any) => {
        if (options?.onReasoningStep) {
          options.onReasoningStep(step);
        }
        audit({
          level: 'info',
          category: 'action',
          event: 'big_brother_reasoning_step',
          details: {
            stepType: step.type,
            toolName: step.toolName,
            content: step.content?.substring(0, 200),
            sessionId: options?.sessionId,
          },
          actor: 'codex-backend',
        });
      };

      const result = await executeWithCodexCLI(prompt, codexConfig, {
        timeout: options?.timeout,
        workingDirectory: options?.workingDirectory,
        onReasoningStep: reasoningCallback,
      });

      if (options?.onChunk && result.metadata?.rawStdout) {
        emitCodexTerminalOutput(result.metadata.rawStdout, options.onChunk);
      }

      return {
        success: result.success,
        output: result.output || '',
        error: result.error,
        executionTime: Date.now() - startTime,
        metadata: result.metadata,
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: (error as Error).message,
        executionTime: Date.now() - startTime,
      };
    }
  }
}

function emitCodexTerminalOutput(rawStdout: string, onChunk: (chunk: string) => void): void {
  const lines = rawStdout.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const msg = parsed?.msg;
      if (!msg || typeof msg !== 'object') continue;

      if (msg.type === 'agent_reasoning' && typeof msg.text === 'string') {
        onChunk(`🧠 ${msg.text.trim()}\n`);
      } else if (msg.type === 'agent_message' && typeof msg.message === 'string') {
        onChunk(`🟢 ${msg.message.trim()}\n`);
      } else if (msg.type === 'agent_reasoning_section_break') {
        onChunk('────────────────────────────────────────\n');
      }
    } catch {
      // Ignore malformed JSON lines
    }
  }
}

function isCodexInstalled(): boolean {
  try {
    execSync('which codex', { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export const codexBackend = new CodexBackendImpl();

registerBackend(codexBackend);
