/**
 * Tool Executor Configuration
 *
 * Manages configuration for the tool execution layer including:
 * - Open Interpreter settings
 * - Legacy CLI backends (Claude Code, Qwen Code, Aider, etc.)
 * - LLM proxy settings for tool execution
 * - Routing and escalation rules
 *
 * Configuration is per-profile (profiles/{username}/etc/tool-executor.json)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadUserConfig, saveUserConfig } from './config.js';
import { audit } from './audit.js';

// ============================================================================
// Types
// ============================================================================

export interface LocalSkillsBackendConfig {
  description?: string;
  enabled: boolean;
  fallbackOnError?: boolean;
}

export interface OpenInterpreterBackendConfig {
  description?: string;
  enabled: boolean;
  endpoint: string;
  autoStart: boolean;
  /** Model ID from models.json - user configurable! */
  modelId: string;
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
  /** Model ID from models.json - user configurable! */
  modelId?: string;
  timeout: number;
  // CLI-specific options
  dangerouslySkipPermissions?: boolean;
  autoStartSession?: boolean;
  terminalPort?: number;
  gitEnabled?: boolean;
  autoCommit?: boolean;
}

export type BackendConfig =
  | LocalSkillsBackendConfig
  | OpenInterpreterBackendConfig
  | CLIBackendConfig;

export interface EscalationRule {
  trigger: 'repeated_failures' | 'tool_not_found' | 'timeout' | 'complexity_score';
  threshold: number;
  escalateTo: string;
  enabled: boolean;
}

export interface RoutingConfig {
  strategy: 'primary-with-fallback' | 'round-robin' | 'priority';
  primaryBackend: string;
  fallbackBackend: string;
  escalationRules: EscalationRule[];
}

export interface LLMProxyConfig {
  enabled: boolean;
  endpoint: string;
  /** Model ID from models.json for tool execution LLM calls */
  modelId: string;
  fallbackModelId: string;
  temperature: number;
  maxTokens: number;
}

export interface TerminalConfig {
  enabled: boolean;
  port: number;
  showOutput: boolean;
  logFile: string;
}

export interface AuditConfig {
  logAllExecutions: boolean;
  logToolOutputs: boolean;
  redactSensitiveData: boolean;
}

/**
 * Escalation configuration for Big Brother mode
 * Controls when and how to escalate to external agents
 */
export interface EscalationConfig {
  /** Whether escalation is enabled */
  enabled: boolean;
  /** Default backend to use for escalation */
  defaultBackend: 'claude-code' | 'open-interpreter' | 'aider' | 'gemini-cli' | 'qwen-code';
  /** Escalate when operator gets stuck (no progress) */
  escalateOnStuck: boolean;
  /** Escalate on repeated failures */
  escalateOnRepeatedFailures: boolean;
  /** Maximum retry attempts before giving up */
  maxRetries: number;
  /** Include full scratchpad in escalation request */
  includeFullScratchpad: boolean;
}

export interface ToolExecutorConfig {
  version: string;
  activeBackend: string;
  backends: {
    'local-skills': LocalSkillsBackendConfig;
    'open-interpreter': OpenInterpreterBackendConfig;
    'claude-code': CLIBackendConfig;
    'qwen-code': CLIBackendConfig;
    'aider': CLIBackendConfig;
    'gemini-cli': CLIBackendConfig;
    [key: string]: BackendConfig;
  };
  routing: RoutingConfig;
  llmProxy: LLMProxyConfig;
  terminal: TerminalConfig;
  audit: AuditConfig;
  /** Escalation configuration for Big Brother mode */
  escalation?: EscalationConfig;
}

// ============================================================================
// Default Configuration
// ============================================================================

export function getDefaultToolExecutorConfig(): ToolExecutorConfig {
  return {
    version: '1.0.0',
    activeBackend: 'local-skills',

    backends: {
      'local-skills': {
        description: 'Native MetaHuman skill executor (default)',
        enabled: true,
        fallbackOnError: true,
      },

      'open-interpreter': {
        description: 'Open Interpreter for natural language code execution',
        enabled: false,
        endpoint: 'http://localhost:4325',
        autoStart: true,
        modelId: 'default.coder',
        safeMode: true,
        autoRun: false,
        maxIterations: 10,
        timeout: 120000,
        allowedLanguages: ['python', 'shell', 'javascript'],
        blockedCommands: ['rm -rf /', 'sudo rm', 'chmod 777'],
        sandboxMode: 'none',
      },

      'claude-code': {
        description: 'Claude Code CLI for complex reasoning tasks',
        enabled: false,
        command: 'claude',
        args: ['--print'],
        dangerouslySkipPermissions: false,
        autoStartSession: true,
        timeout: 60000,
        terminalPort: 3099,
      },

      'qwen-code': {
        description: 'Qwen Code CLI',
        enabled: false,
        command: 'qwen-code',
        args: [],
        modelId: 'default.coder',
        timeout: 120000,
      },

      'aider': {
        description: 'Aider AI pair programming',
        enabled: false,
        command: 'aider',
        args: ['--no-auto-commits', '--yes'],
        modelId: 'default.coder',
        gitEnabled: true,
        autoCommit: false,
        timeout: 180000,
      },

      'gemini-cli': {
        description: 'Google Gemini CLI',
        enabled: false,
        command: 'gemini',
        args: ['--non-interactive'],
        timeout: 120000,
      },
    },

    routing: {
      strategy: 'primary-with-fallback',
      primaryBackend: 'local-skills',
      fallbackBackend: 'open-interpreter',
      escalationRules: [
        {
          trigger: 'repeated_failures',
          threshold: 3,
          escalateTo: 'open-interpreter',
          enabled: true,
        },
      ],
    },

    llmProxy: {
      enabled: true,
      endpoint: '/api/llm/proxy',
      modelId: 'default.coder',
      fallbackModelId: 'default.orchestrator',
      temperature: 0.0,
      maxTokens: 4096,
    },

    terminal: {
      enabled: true,
      port: 3099,
      showOutput: true,
      logFile: 'logs/run/tool-executor.log',
    },

    audit: {
      logAllExecutions: true,
      logToolOutputs: true,
      redactSensitiveData: true,
    },

    escalation: {
      enabled: true,
      defaultBackend: 'claude-code',
      escalateOnStuck: true,
      escalateOnRepeatedFailures: true,
      maxRetries: 2,
      includeFullScratchpad: true,
    },
  };
}

// ============================================================================
// Configuration Loading/Saving
// ============================================================================

// Per-user config cache with TTL to avoid repeated disk reads during API polling
const CONFIG_CACHE_TTL_MS = 5000; // 5 seconds
interface CacheEntry {
  config: ToolExecutorConfig;
  timestamp: number;
}
const configCache = new Map<string, CacheEntry>();

/**
 * Load tool executor configuration for a user
 *
 * Uses a 5-second per-user cache to avoid repeated disk reads
 * during polling operations. Cache is invalidated on save.
 *
 * If no username is provided, falls back to system-wide config (etc/tool-executor.json)
 */
export function loadToolExecutorConfig(username?: string): ToolExecutorConfig {
  const cacheKey = username || '__system__';
  const now = Date.now();

  // Check cache - return if still valid
  const cached = configCache.get(cacheKey);
  if (cached && (now - cached.timestamp) < CONFIG_CACHE_TTL_MS) {
    return cached.config;
  }

  let config: ToolExecutorConfig;

  if (username) {
    // Load user-specific config
    config = loadUserConfig<ToolExecutorConfig>(
      'tool-executor.json',
      getDefaultToolExecutorConfig(),
      username
    );
  } else {
    // Fall back to system-wide config for contexts without user (CLI, agents, etc.)
    try {
      const systemConfigPath = path.join(process.cwd(), 'etc', 'tool-executor.json');
      const raw = fs.readFileSync(systemConfigPath, 'utf8');
      config = JSON.parse(raw) as ToolExecutorConfig;
    } catch {
      // If system config doesn't exist, use defaults
      config = getDefaultToolExecutorConfig();
    }
  }

  // Cache the result
  configCache.set(cacheKey, { config, timestamp: now });

  return config;
}

/**
 * Save tool executor configuration for a user
 */
export function saveToolExecutorConfig(
  config: ToolExecutorConfig,
  username?: string
): void {
  saveUserConfig('tool-executor.json', config, username);
  invalidateToolExecutorConfig();

  audit({
    level: 'info',
    category: 'system',
    event: 'tool_executor_config_saved',
    details: {
      activeBackend: config.activeBackend,
      llmProxyModelId: config.llmProxy.modelId,
    },
    actor: username || 'system',
  });
}

/**
 * Invalidate cached configuration (call after external changes)
 */
export function invalidateToolExecutorConfig(username?: string): void {
  if (username) {
    configCache.delete(username);
  } else {
    configCache.clear();
  }
}

// ============================================================================
// Configuration Helpers
// ============================================================================

/**
 * Get the active backend configuration
 */
export function getActiveBackendConfig(username?: string): BackendConfig {
  const config = loadToolExecutorConfig(username);
  const backendId = config.activeBackend;
  return config.backends[backendId] || config.backends['local-skills'];
}

/**
 * Get a specific backend configuration
 */
export function getBackendConfig(backendId: string, username?: string): BackendConfig | undefined {
  const config = loadToolExecutorConfig(username);
  return config.backends[backendId];
}

/**
 * Check if a backend is enabled
 */
export function isBackendEnabled(backendId: string, username?: string): boolean {
  const backend = getBackendConfig(backendId, username);
  return backend?.enabled ?? false;
}

/**
 * Get the model ID for tool execution LLM calls
 */
export function getToolExecutorModelId(username?: string): string {
  const config = loadToolExecutorConfig(username);
  return config.llmProxy.modelId;
}

/**
 * Set the active backend
 */
export function setActiveBackend(backendId: string, username?: string): boolean {
  const config = loadToolExecutorConfig(username);

  if (!config.backends[backendId]) {
    return false;
  }

  if (!config.backends[backendId].enabled) {
    return false;
  }

  config.activeBackend = backendId;
  saveToolExecutorConfig(config, username);

  audit({
    level: 'info',
    category: 'system',
    event: 'tool_executor_backend_changed',
    details: { backendId },
    actor: username || 'system',
  });

  return true;
}

/**
 * Update LLM proxy model selection
 */
export function setToolExecutorModel(modelId: string, username?: string): void {
  const config = loadToolExecutorConfig(username);
  config.llmProxy.modelId = modelId;
  saveToolExecutorConfig(config, username);

  audit({
    level: 'info',
    category: 'system',
    event: 'tool_executor_model_changed',
    details: { modelId },
    actor: username || 'system',
  });
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate tool executor configuration
 */
export function validateToolExecutorConfig(config: ToolExecutorConfig): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check version
  if (!config.version) {
    errors.push('Missing version field');
  }

  // Check active backend exists
  if (!config.backends[config.activeBackend]) {
    errors.push(`Active backend '${config.activeBackend}' not found in backends`);
  }

  // Check active backend is enabled
  if (config.backends[config.activeBackend]?.enabled === false) {
    errors.push(`Active backend '${config.activeBackend}' is disabled`);
  }

  // Check routing references
  if (config.routing.primaryBackend && !config.backends[config.routing.primaryBackend]) {
    errors.push(`Primary backend '${config.routing.primaryBackend}' not found`);
  }

  if (config.routing.fallbackBackend && !config.backends[config.routing.fallbackBackend]) {
    warnings.push(`Fallback backend '${config.routing.fallbackBackend}' not found`);
  }

  // Check escalation rules reference valid backends
  for (const rule of config.routing.escalationRules) {
    if (rule.enabled && !config.backends[rule.escalateTo]) {
      warnings.push(`Escalation rule targets unknown backend '${rule.escalateTo}'`);
    }
  }

  // Check LLM proxy model (just warn, model validation happens at runtime)
  if (!config.llmProxy.modelId) {
    warnings.push('LLM proxy has no modelId configured');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Backend Detection
// ============================================================================

/**
 * Check if a CLI command is available on the system
 */
export async function isCommandAvailable(command: string): Promise<boolean> {
  const { execSync } = await import('child_process');

  try {
    execSync(`which ${command}`, { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect which tool executor backends are installed on the system
 */
export async function detectInstalledBackends(): Promise<string[]> {
  const installed: string[] = ['local-skills']; // Always available

  // Check CLI tools
  const cliTools = [
    { id: 'claude-code', command: 'claude' },
    { id: 'qwen-code', command: 'qwen-code' },
    { id: 'aider', command: 'aider' },
    { id: 'gemini-cli', command: 'gemini' },
  ];

  for (const tool of cliTools) {
    if (await isCommandAvailable(tool.command)) {
      installed.push(tool.id);
    }
  }

  // Check if Open Interpreter server is running
  try {
    const response = await fetch('http://localhost:4325/health', {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      installed.push('open-interpreter');
    }
  } catch {
    // Server not running - check if Python interpreter package is installed
    if (await isCommandAvailable('interpreter')) {
      installed.push('open-interpreter');
    }
  }

  return installed;
}
