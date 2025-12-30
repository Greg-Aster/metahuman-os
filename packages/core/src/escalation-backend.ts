/**
 * Escalation Backend Abstraction
 *
 * Provides a unified interface for "Big Brother" escalation backends.
 * Big Brother = escalating to a more capable agent when the local system
 * gets stuck or needs expert help.
 *
 * Supported backends:
 * - claude-code: Anthropic's Claude Code CLI
 * - open-interpreter: Open Interpreter Python server
 * - aider: Aider AI pair programming
 * - gemini-cli: Google Gemini CLI
 * - qwen-code: Qwen Code CLI
 *
 * Users can configure their preferred backend in tool-executor.json
 */

import { audit } from './audit.js';
import { loadToolExecutorConfig } from './tool-executor-config.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for executing an escalation request
 */
export interface EscalationOptions {
  /** Timeout in milliseconds */
  timeout?: number;
  /** Session ID for correlating audit events */
  sessionId?: string;
  /** Working directory for command execution */
  workingDirectory?: string;
  /** Called when a reasoning step is detected */
  onReasoningStep?: (step: ReasoningStep) => void;
  /** Called on each raw output chunk (for terminal display) */
  onChunk?: (chunk: string) => void;
}

/**
 * Result from executing an escalation request
 */
export interface EscalationResult {
  /** Whether the execution succeeded */
  success: boolean;
  /** The output from the backend */
  output: string;
  /** Error message if execution failed */
  error?: string;
  /** Execution time in milliseconds */
  executionTime?: number;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * A reasoning step from the backend (for streaming display)
 */
export interface ReasoningStep {
  type: 'thought' | 'action' | 'observation' | 'result' | 'tool_use';
  content: string;
  timestamp: string;
  toolName?: string;
  success?: boolean;
}

/**
 * Interface that all escalation backends must implement
 */
export interface EscalationBackend {
  /** Unique identifier for this backend */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Description of the backend */
  readonly description: string;

  /**
   * Check if the backend is available on this system
   * (e.g., CLI installed, server reachable)
   */
  isAvailable(): Promise<boolean>;

  /**
   * Check if the backend is ready to execute
   * (e.g., session started, server running)
   */
  isReady(): boolean;

  /**
   * Start/initialize the backend
   * @returns true if started successfully
   */
  start(): Promise<boolean>;

  /**
   * Stop/cleanup the backend
   */
  stop(): void;

  /**
   * Execute a prompt and return the result
   */
  execute(prompt: string, options?: EscalationOptions): Promise<EscalationResult>;

  /**
   * Whether this backend supports streaming output
   */
  readonly supportsStreaming: boolean;

  /**
   * Execute with streaming output (if supported)
   */
  executeStreaming?(
    prompt: string,
    options?: EscalationOptions
  ): AsyncGenerator<string, EscalationResult, unknown>;
}

// ============================================================================
// Backend Registry
// ============================================================================

const backendRegistry = new Map<string, EscalationBackend>();

/**
 * Register a backend implementation
 */
export function registerBackend(backend: EscalationBackend): void {
  if (backendRegistry.has(backend.id)) {
    audit({
      level: 'warn',
      category: 'system',
      event: 'escalation_backend_replaced',
      details: { backendId: backend.id },
      actor: 'escalation-backend',
    });
  }
  backendRegistry.set(backend.id, backend);
  audit({
    level: 'info',
    category: 'system',
    event: 'escalation_backend_registered',
    details: { backendId: backend.id, name: backend.name },
    actor: 'escalation-backend',
  });
}

/**
 * Get a backend by ID
 */
export function getBackend(id: string): EscalationBackend | undefined {
  return backendRegistry.get(id);
}

/**
 * Get the active backend based on user configuration
 */
export function getActiveBackend(username?: string): EscalationBackend | undefined {
  const config = loadToolExecutorConfig(username);

  // Check escalation config first (new schema)
  const escalationConfig = (config as any).escalation;
  if (escalationConfig?.defaultBackend) {
    const backend = backendRegistry.get(escalationConfig.defaultBackend);
    if (backend) return backend;
  }

  // Fall back to activeBackend (existing schema)
  if (config.activeBackend) {
    const backend = backendRegistry.get(config.activeBackend);
    if (backend) return backend;
  }

  // Default to claude-code if registered
  return backendRegistry.get('claude-code');
}

/**
 * List all registered backends
 */
export function listBackends(): EscalationBackend[] {
  return Array.from(backendRegistry.values());
}

/**
 * Get status of all backends
 */
export async function getBackendStatuses(): Promise<
  Array<{
    id: string;
    name: string;
    available: boolean;
    ready: boolean;
    supportsStreaming: boolean;
  }>
> {
  const statuses = [];
  for (const backend of backendRegistry.values()) {
    statuses.push({
      id: backend.id,
      name: backend.name,
      available: await backend.isAvailable(),
      ready: backend.isReady(),
      supportsStreaming: backend.supportsStreaming,
    });
  }
  return statuses;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Execute an escalation using the active backend
 */
export async function escalate(
  prompt: string,
  options?: EscalationOptions & { username?: string; preferredBackend?: string }
): Promise<EscalationResult> {
  // Ensure backends are initialized before proceeding
  await initializeBackends();

  const { username, preferredBackend, ...execOptions } = options || {};

  // Get backend
  let backend: EscalationBackend | undefined;
  if (preferredBackend) {
    backend = getBackend(preferredBackend);
  }
  if (!backend) {
    backend = getActiveBackend(username);
  }

  if (!backend) {
    return {
      success: false,
      output: '',
      error: 'No escalation backend available. Configure one in Settings.',
    };
  }

  // Check availability
  const available = await backend.isAvailable();
  if (!available) {
    return {
      success: false,
      output: '',
      error: `Backend ${backend.name} is not available. Check installation.`,
    };
  }

  // Start if not ready
  if (!backend.isReady()) {
    audit({
      level: 'info',
      category: 'action',
      event: 'escalation_backend_auto_start',
      details: { backendId: backend.id },
      actor: 'escalation-backend',
    });

    const started = await backend.start();
    if (!started) {
      return {
        success: false,
        output: '',
        error: `Failed to start backend ${backend.name}`,
      };
    }
  }

  // Execute
  audit({
    level: 'info',
    category: 'action',
    event: 'escalation_execute',
    details: {
      backendId: backend.id,
      promptLength: prompt.length,
      promptPreview: prompt.substring(0, 100),
      sessionId: execOptions.sessionId,
    },
    actor: 'escalation-backend',
  });

  const result = await backend.execute(prompt, execOptions);

  audit({
    level: result.success ? 'info' : 'warn',
    category: 'action',
    event: result.success ? 'escalation_success' : 'escalation_failed',
    details: {
      backendId: backend.id,
      outputLength: result.output.length,
      executionTime: result.executionTime,
      error: result.error,
      sessionId: execOptions.sessionId,
    },
    actor: 'escalation-backend',
  });

  return result;
}

/**
 * Check if any escalation backend is available
 */
export async function isEscalationAvailable(username?: string): Promise<boolean> {
  const backend = getActiveBackend(username);
  if (!backend) return false;
  return backend.isAvailable();
}

/**
 * Check if the active escalation backend is ready
 */
export function isEscalationReady(username?: string): boolean {
  const backend = getActiveBackend(username);
  if (!backend) return false;
  return backend.isReady();
}

// ============================================================================
// Re-export Backend IDs (from separate file to avoid circular deps)
// ============================================================================

export { BACKEND_IDS, type BackendId } from './escalation-constants.js';

// ============================================================================
// Auto-register backends
// ============================================================================
// Initialize backends when this module is first used.
// Uses dynamic import to avoid circular dependency issues during module load.

let backendsInitialized = false;

async function initializeBackends(): Promise<void> {
  if (backendsInitialized) return;
  backendsInitialized = true;

  // Dynamic imports - executed after this module is fully loaded
  await import('./backends/claude-code-backend.js');
  await import('./backends/open-interpreter-backend.js');
  await import('./backends/aider-backend.js');
  await import('./backends/gemini-cli-backend.js');
  await import('./backends/qwen-code-backend.js');
}

// Immediately trigger initialization (fire-and-forget)
initializeBackends().catch(console.error);

/**
 * Ensure backends are initialized (call before using registry)
 */
export async function ensureBackendsInitialized(): Promise<void> {
  await initializeBackends();
}
