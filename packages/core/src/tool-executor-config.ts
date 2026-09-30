/**
 * Backend Configuration
 *
 * Configuration loading for escalation backends (Claude Code, Codex, etc.)
 * The configuration lives in etc/tool-executor.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { ROOT } from './path-builder.js';

// ============================================================================
// Types
// ============================================================================

export interface CLIBackendConfig {
  description?: string;
  enabled: boolean;
  command: string;
  args: string[];
  modelId?: string;
  timeout: number;
  dangerouslySkipPermissions?: boolean;
  gitEnabled?: boolean;
  /** Codex reasoning effort override. Defaults to low for latency-sensitive escalation. */
  reasoningEffort?: string;
}

export interface EscalationConfig {
  enabled: boolean;
  defaultBackend: 'claude-code' | 'aider' | 'gemini-cli' | 'qwen-code' | 'codex';
  escalateOnStuck: boolean;
  escalateOnRepeatedFailures: boolean;
  maxRetries: number;
  includeFullScratchpad?: boolean;
}

export interface ToolExecutorConfig {
  version: string;
  activeBackend: string;
  backends: {
    'claude-code': CLIBackendConfig;
    'qwen-code': CLIBackendConfig;
    'aider': CLIBackendConfig;
    'gemini-cli': CLIBackendConfig;
    'codex': CLIBackendConfig;
    [key: string]: any;
  };
  escalation: EscalationConfig;
}

// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * Load configuration from etc/tool-executor.json
 */
const defaultConfig: ToolExecutorConfig = {
  version: '1.0.0',
  activeBackend: 'claude-code',
  backends: {
    'claude-code': {
      description: 'Claude Code CLI',
      enabled: true,
      command: 'claude',
      args: ['--print'],
      timeout: 60000,
    },
    'qwen-code': {
      description: 'Qwen Code CLI',
      enabled: false,
      command: 'qwen-code',
      args: [],
      timeout: 120000,
    },
    'aider': {
      description: 'Aider AI pair programming',
      enabled: false,
      command: 'aider',
      args: ['--no-auto-commits', '--yes'],
      timeout: 180000,
    },
    'gemini-cli': {
      description: 'Google Gemini CLI',
      enabled: false,
      command: 'gemini',
      args: ['--non-interactive'],
      timeout: 120000,
    },
    'codex': {
      description: 'OpenAI Codex CLI',
      enabled: false,
      command: 'codex',
      args: ['exec', '--color', 'always', '--json'],
      timeout: 120000,
      reasoningEffort: 'low',
    },
  },
  escalation: {
    enabled: true,
    defaultBackend: 'claude-code',
    escalateOnStuck: true,
    escalateOnRepeatedFailures: true,
    maxRetries: 2,
  },
};

export function loadToolExecutorConfig(_username?: string): ToolExecutorConfig {
  // Try to load from etc/tool-executor.json
  try {
    const configPath = path.join(ROOT, 'etc', 'tool-executor.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as ToolExecutorConfig;
    return {
      ...defaultConfig,
      ...parsed,
      backends: {
        ...defaultConfig.backends,
        ...parsed.backends,
      },
      escalation: {
        ...defaultConfig.escalation,
        ...parsed.escalation,
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultConfig;
    throw error;
  }
}
