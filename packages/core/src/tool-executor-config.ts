/**
 * Backend Configuration
 *
 * Configuration loading for escalation backends (Open Interpreter, Claude Code, etc.)
 * The configuration lives in etc/tool-executor.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = process.cwd().includes('/apps/site')
  ? path.resolve(process.cwd(), '../..')
  : process.cwd();

// ============================================================================
// Types
// ============================================================================

export interface OpenInterpreterBackendConfig {
  description?: string;
  enabled: boolean;
  endpoint: string;
  autoStart: boolean;
  modelId: string;
  provider?: string;
  runpodEndpointId?: string;
  safeMode: boolean;
  autoRun: boolean;
  maxIterations: number;
  timeout: number;
  allowedLanguages: string[];
  blockedCommands: string[];
  sandboxMode: 'none' | 'docker' | 'firejail';
}

export interface CLIBackendConfig {
  description?: string;
  enabled: boolean;
  command: string;
  args: string[];
  modelId?: string;
  timeout: number;
  dangerouslySkipPermissions?: boolean;
  autoStartSession?: boolean;
  terminalPort?: number;
  gitEnabled?: boolean;
  autoCommit?: boolean;
}

export interface LLMProxyConfig {
  enabled: boolean;
  endpoint: string;
  modelId: string;
  fallbackModelId: string;
  temperature: number;
  maxTokens: number;
}

export interface EscalationConfig {
  enabled: boolean;
  defaultBackend: 'claude-code' | 'open-interpreter' | 'aider' | 'gemini-cli' | 'qwen-code' | 'codex';
  escalateOnStuck: boolean;
  escalateOnRepeatedFailures: boolean;
  maxRetries: number;
  includeFullScratchpad?: boolean;
}

export interface ToolExecutorConfig {
  version: string;
  activeBackend: string;
  backends: {
    'open-interpreter': OpenInterpreterBackendConfig;
    'claude-code': CLIBackendConfig;
    'qwen-code': CLIBackendConfig;
    'aider': CLIBackendConfig;
    'gemini-cli': CLIBackendConfig;
    'codex': CLIBackendConfig;
    [key: string]: any;
  };
  llmProxy: LLMProxyConfig;
  escalation?: EscalationConfig;
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
    'open-interpreter': {
      description: 'Open Interpreter',
      enabled: true,
      endpoint: 'http://localhost:4325',
      autoStart: false,
      modelId: 'default.coder',
      safeMode: true,
      autoRun: false,
      maxIterations: 10,
      timeout: 120000,
      allowedLanguages: ['python', 'shell', 'javascript'],
      blockedCommands: [],
      sandboxMode: 'none',
    },
    'claude-code': {
      description: 'Claude Code CLI',
      enabled: true,
      command: 'claude',
      args: ['--print'],
      timeout: 60000,
      terminalPort: 3099,
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
    },
  },
  llmProxy: {
    enabled: true,
    endpoint: '/api/llm/proxy',
    modelId: 'default.coder',
    fallbackModelId: 'default.orchestrator',
    temperature: 0.0,
    maxTokens: 4096,
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
      llmProxy: {
        ...defaultConfig.llmProxy,
        ...parsed.llmProxy,
      },
      escalation: {
        ...defaultConfig.escalation,
        ...parsed.escalation,
      },
    };
  } catch {
    // Return defaults if file doesn't exist
    return defaultConfig;
  }
}

/**
 * Save configuration to etc/tool-executor.json
 */
export function saveToolExecutorConfig(config: ToolExecutorConfig, _username?: string): void {
  const configPath = path.join(ROOT, 'etc', 'tool-executor.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Get the LLM model ID for tool execution
 */
export function getToolExecutorModelId(_username?: string): string {
  const config = loadToolExecutorConfig(_username);
  return config.llmProxy?.modelId || 'default.coder';
}

/**
 * Set the LLM model ID for tool execution
 */
export function setToolExecutorModel(modelId: string, _username?: string): void {
  const config = loadToolExecutorConfig(_username);
  if (!config.llmProxy) {
    config.llmProxy = defaultConfig.llmProxy;
  }
  config.llmProxy.modelId = modelId;
  saveToolExecutorConfig(config, _username);
}
