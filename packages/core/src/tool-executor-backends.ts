/**
 * Tool Executor Backend Manager
 *
 * Manages switching between different tool execution backends:
 * - local-skills: Native MetaHuman skill executor (default)
 * - open-interpreter: Open Interpreter Python server
 * - claude-code: Claude Code CLI
 * - qwen-code: Qwen Code CLI
 * - aider: Aider AI pair programming
 * - gemini-cli: Google Gemini CLI
 *
 * Backend selection is user-configurable via Settings.
 */

import { audit } from './audit.js';
import {
  loadToolExecutorConfig,
  saveToolExecutorConfig,
  getActiveBackendConfig,
  isBackendEnabled,
  setActiveBackend,
  detectInstalledBackends,
  type ToolExecutorConfig,
  type BackendConfig,
  type OpenInterpreterBackendConfig,
  type CLIBackendConfig,
} from './tool-executor-config.js';
import {
  isInterpreterServerRunning,
  startInterpreterServer,
  executeWithInterpreter,
  type InterpreterRequest,
  type InterpreterResponse,
} from './open-interpreter.js';

// ============================================================================
// Types
// ============================================================================

export interface ToolExecutorResult {
  success: boolean;
  output?: string;
  error?: string;
  backend: string;
  executionTime?: number;
  metadata?: Record<string, any>;
}

export interface ToolExecutorRequest {
  task: string;
  context?: {
    conversationId?: string;
    sessionId?: string;
    workingDirectory?: string;
    skillInputs?: Record<string, any>;
  };
}

export interface BackendStatus {
  id: string;
  name: string;
  enabled: boolean;
  installed: boolean;
  running?: boolean;
  description?: string;
}

// ============================================================================
// Backend Status
// ============================================================================

/**
 * Get the status of all backends
 */
export async function getAllBackendStatus(username?: string): Promise<BackendStatus[]> {
  const config = loadToolExecutorConfig(username);
  const installedBackends = await detectInstalledBackends();

  const statuses: BackendStatus[] = [];

  // Process each backend
  for (const [id, backendConfig] of Object.entries(config.backends)) {
    const status: BackendStatus = {
      id,
      name: getBackendDisplayName(id),
      enabled: backendConfig.enabled,
      installed: installedBackends.includes(id),
      description: backendConfig.description,
    };

    // Check running status for server-based backends
    if (id === 'open-interpreter' && backendConfig.enabled) {
      const interpreterConfig = backendConfig as OpenInterpreterBackendConfig;
      status.running = await isInterpreterServerRunning(interpreterConfig.endpoint);
    }

    statuses.push(status);
  }

  return statuses;
}

/**
 * Get display name for a backend
 */
function getBackendDisplayName(id: string): string {
  const names: Record<string, string> = {
    'local-skills': 'Local Skills',
    'open-interpreter': 'Open Interpreter',
    'claude-code': 'Claude Code',
    'qwen-code': 'Qwen Code',
    'aider': 'Aider',
    'gemini-cli': 'Gemini CLI',
  };
  return names[id] || id;
}

// ============================================================================
// Backend Resolution
// ============================================================================

/**
 * Resolve which backend to use for execution
 *
 * Uses the routing strategy from configuration:
 * - primary-with-fallback: Try primary, fall back if unavailable
 * - round-robin: Cycle through enabled backends
 * - priority: Use highest priority available backend
 */
export async function resolveBackend(
  config: ToolExecutorConfig,
  preference?: string
): Promise<string> {
  // If a specific preference is given and it's available, use it
  if (preference && config.backends[preference]?.enabled) {
    const available = await isBackendAvailable(preference, config);
    if (available) {
      return preference;
    }
  }

  // Use routing strategy
  const { strategy, primaryBackend, fallbackBackend } = config.routing;

  switch (strategy) {
    case 'primary-with-fallback':
      // Try primary backend
      if (config.backends[primaryBackend]?.enabled) {
        if (await isBackendAvailable(primaryBackend, config)) {
          return primaryBackend;
        }
      }

      // Try fallback
      if (fallbackBackend && config.backends[fallbackBackend]?.enabled) {
        if (await isBackendAvailable(fallbackBackend, config)) {
          return fallbackBackend;
        }
      }

      // Fall back to local-skills
      return 'local-skills';

    case 'priority':
      // Use backend priority order
      const priorityOrder = ['open-interpreter', 'claude-code', 'qwen-code', 'aider', 'gemini-cli', 'local-skills'];
      for (const backendId of priorityOrder) {
        if (config.backends[backendId]?.enabled) {
          if (await isBackendAvailable(backendId, config)) {
            return backendId;
          }
        }
      }
      return 'local-skills';

    default:
      // Default to primary or local-skills
      return config.backends[primaryBackend]?.enabled ? primaryBackend : 'local-skills';
  }
}

/**
 * Check if a specific backend is available for use
 */
async function isBackendAvailable(backendId: string, config: ToolExecutorConfig): Promise<boolean> {
  const backendConfig = config.backends[backendId];
  if (!backendConfig?.enabled) {
    return false;
  }

  switch (backendId) {
    case 'local-skills':
      return true; // Always available

    case 'open-interpreter':
      const interpreterConfig = backendConfig as OpenInterpreterBackendConfig;
      const running = await isInterpreterServerRunning(interpreterConfig.endpoint);
      // Available if running OR if autoStart is enabled
      return running || interpreterConfig.autoStart;

    case 'claude-code':
    case 'qwen-code':
    case 'aider':
    case 'gemini-cli':
      // Check if CLI command is available
      const cliConfig = backendConfig as CLIBackendConfig;
      return await isCommandInstalled(cliConfig.command);

    default:
      return false;
  }
}

/**
 * Check if a CLI command is installed
 */
async function isCommandInstalled(command: string): Promise<boolean> {
  try {
    const { execSync } = await import('child_process');
    execSync(`which ${command}`, { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Backend Execution
// ============================================================================

/**
 * Execute a task using the resolved backend
 */
export async function executeWithBackend(
  request: ToolExecutorRequest,
  backendId?: string,
  username?: string
): Promise<ToolExecutorResult> {
  const config = loadToolExecutorConfig(username);
  const startTime = Date.now();

  // Resolve which backend to use
  const resolvedBackend = backendId || await resolveBackend(config);

  audit({
    level: 'info',
    category: 'action',
    event: 'tool_executor_started',
    details: {
      backend: resolvedBackend,
      task: request.task.slice(0, 200),
      requestedBackend: backendId,
    },
    actor: username || 'system',
  });

  try {
    let result: ToolExecutorResult;

    switch (resolvedBackend) {
      case 'local-skills':
        result = await executeWithLocalSkills(request, username);
        break;

      case 'open-interpreter':
        result = await executeWithOpenInterpreter(request, config, username);
        break;

      case 'claude-code':
      case 'qwen-code':
      case 'aider':
      case 'gemini-cli':
        result = await executeWithLegacyCLI(request, resolvedBackend, config, username);
        break;

      default:
        result = {
          success: false,
          error: `Unknown backend: ${resolvedBackend}`,
          backend: resolvedBackend,
        };
    }

    result.executionTime = Date.now() - startTime;
    result.backend = resolvedBackend;

    audit({
      level: result.success ? 'info' : 'warn',
      category: 'action',
      event: 'tool_executor_completed',
      details: {
        backend: resolvedBackend,
        success: result.success,
        executionTime: result.executionTime,
        error: result.error,
      },
      actor: username || 'system',
    });

    return result;
  } catch (error) {
    const executionTime = Date.now() - startTime;

    audit({
      level: 'error',
      category: 'action',
      event: 'tool_executor_failed',
      details: {
        backend: resolvedBackend,
        error: (error as Error).message,
        executionTime,
      },
      actor: username || 'system',
    });

    return {
      success: false,
      error: (error as Error).message,
      backend: resolvedBackend,
      executionTime,
    };
  }
}

// ============================================================================
// Backend-Specific Executors
// ============================================================================

/**
 * Execute with local skills (default)
 */
async function executeWithLocalSkills(
  request: ToolExecutorRequest,
  username?: string
): Promise<ToolExecutorResult> {
  // Import skill executor
  const { executeSkill } = await import('./skills.js');
  const { loadDecisionRules } = await import('./identity.js');

  try {
    // Parse the task to extract skill name and inputs
    const skillMatch = request.task.match(/Action:\s*(\w+)/i);
    const inputMatch = request.task.match(/Action Input:\s*({[\s\S]*?})/i);

    if (!skillMatch) {
      // For simple tasks, use the conversational_response skill
      const rules = loadDecisionRules();
      const result = await executeSkill(
        'conversational_response',
        { message: request.task },
        rules.trustLevel as any,
        false
      );

      return {
        success: result.success !== false,
        output: result.outputs?.response || JSON.stringify(result.outputs),
        error: result.error,
        backend: 'local-skills',
      };
    }

    const skillId = skillMatch[1];
    let skillInputs = {};

    if (inputMatch) {
      try {
        skillInputs = JSON.parse(inputMatch[1]);
      } catch {
        skillInputs = { input: inputMatch[1] };
      }
    }

    const rules = loadDecisionRules();
    const result = await executeSkill(skillId, skillInputs, rules.trustLevel as any, false);

    return {
      success: result.success !== false,
      output: result.outputs ? JSON.stringify(result.outputs, null, 2) : undefined,
      error: result.error,
      backend: 'local-skills',
      metadata: {
        skillId,
        skillInputs,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      backend: 'local-skills',
    };
  }
}

/**
 * Execute with Open Interpreter
 */
async function executeWithOpenInterpreter(
  request: ToolExecutorRequest,
  config: ToolExecutorConfig,
  username?: string
): Promise<ToolExecutorResult> {
  const interpreterRequest: InterpreterRequest = {
    task: request.task,
    context: {
      conversationId: request.context?.conversationId,
      sessionId: request.context?.sessionId,
      workingDirectory: request.context?.workingDirectory,
    },
  };

  const response = await executeWithInterpreter(interpreterRequest, undefined, username);

  return {
    success: response.success,
    output: response.finalOutput || response.messages.map(m => m.content).join('\n'),
    error: response.error,
    backend: 'open-interpreter',
    metadata: response.metadata,
  };
}

/**
 * Execute with legacy CLI tools (Claude Code, Qwen Code, Aider, Gemini CLI)
 */
async function executeWithLegacyCLI(
  request: ToolExecutorRequest,
  backendId: string,
  config: ToolExecutorConfig,
  username?: string
): Promise<ToolExecutorResult> {
  // Import legacy adapters
  const {
    executeWithClaudeCode,
    executeWithQwenCode,
    executeWithAider,
    executeWithGeminiCLI,
  } = await import('./legacy-cli-adapters.js');

  const cliConfig = config.backends[backendId] as CLIBackendConfig;

  switch (backendId) {
    case 'claude-code':
      return executeWithClaudeCode(request.task, cliConfig, username);

    case 'qwen-code':
      return executeWithQwenCode(request.task, cliConfig, username);

    case 'aider':
      return executeWithAider(request.task, cliConfig, username);

    case 'gemini-cli':
      return executeWithGeminiCLI(request.task, cliConfig, username);

    default:
      return {
        success: false,
        error: `Unknown CLI backend: ${backendId}`,
        backend: backendId,
      };
  }
}

// ============================================================================
// Backend Management
// ============================================================================

/**
 * Switch to a different tool executor backend
 */
export async function switchToolBackend(
  newBackend: string,
  username?: string
): Promise<{ success: boolean; error?: string }> {
  const config = loadToolExecutorConfig(username);

  // Check if backend exists
  if (!config.backends[newBackend]) {
    return { success: false, error: `Unknown backend: ${newBackend}` };
  }

  // Check if backend is enabled
  if (!config.backends[newBackend].enabled) {
    return { success: false, error: `Backend ${newBackend} is disabled` };
  }

  // Check if backend is available
  const available = await isBackendAvailable(newBackend, config);
  if (!available) {
    return { success: false, error: `Backend ${newBackend} is not available` };
  }

  // Switch
  const switched = setActiveBackend(newBackend, username);
  if (!switched) {
    return { success: false, error: 'Failed to switch backend' };
  }

  return { success: true };
}

/**
 * Enable or disable a backend
 */
export function setBackendEnabled(
  backendId: string,
  enabled: boolean,
  username?: string
): { success: boolean; error?: string } {
  const config = loadToolExecutorConfig(username);

  if (!config.backends[backendId]) {
    return { success: false, error: `Unknown backend: ${backendId}` };
  }

  config.backends[backendId].enabled = enabled;

  // If disabling the active backend, switch to local-skills
  if (!enabled && config.activeBackend === backendId) {
    config.activeBackend = 'local-skills';
  }

  saveToolExecutorConfig(config, username);

  audit({
    level: 'info',
    category: 'system',
    event: 'backend_enabled_changed',
    details: { backendId, enabled },
    actor: username || 'system',
  });

  return { success: true };
}

/**
 * Get currently active backend
 */
export function getActiveBackend(username?: string): string {
  const config = loadToolExecutorConfig(username);
  return config.activeBackend;
}

/**
 * Check if escalation should occur based on rules
 */
export async function shouldEscalate(
  failureCount: number,
  currentBackend: string,
  username?: string
): Promise<{ escalate: boolean; escalateTo?: string }> {
  const config = loadToolExecutorConfig(username);

  for (const rule of config.routing.escalationRules) {
    if (!rule.enabled) continue;

    if (rule.trigger === 'repeated_failures' && failureCount >= rule.threshold) {
      // Check if escalation target is available
      if (await isBackendAvailable(rule.escalateTo, config)) {
        return { escalate: true, escalateTo: rule.escalateTo };
      }
    }
  }

  return { escalate: false };
}
