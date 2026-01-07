/**
 * Agent Runtime Types
 *
 * Universal types for agent execution on both web and mobile.
 */

/**
 * Context provided to every agent run
 */
export interface AgentContext {
  /** Username of the profile owner */
  username: string;
  /** User ID (alias for username, for compatibility) */
  userId?: string;
  /** Root data directory for the profile */
  dataDir: string;
  /** Abort signal for cancellation support */
  signal?: AbortSignal;
  /** Optional logger for structured output */
  log?: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

/**
 * Input parameters for agent execution
 */
export interface AgentInput {
  /** CLI-style arguments (for backward compatibility) */
  args?: string[];
  /** Structured options */
  options?: Record<string, unknown>;
}

/**
 * Result returned by every agent
 */
export interface AgentResult {
  /** Whether the agent completed successfully */
  success: boolean;
  /** Result data (agent-specific) */
  data?: unknown;
  /** Error message if failed */
  error?: string;
  /** Multiple error messages if failed */
  errors?: string[];
  /** Execution duration in milliseconds */
  duration?: number;
  /** Execution duration in milliseconds (alias for duration) */
  durationMs?: number;
  /** Number of items processed (if applicable) */
  itemsProcessed?: number;
}

/**
 * Agent metadata for registration
 */
export interface AgentMeta {
  /** Unique agent identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what the agent does */
  description: string;
  /** Whether this agent uses LLM (affects scheduling) */
  usesLLM: boolean;
  /** Execution priority */
  priority: 'high' | 'normal' | 'low';
  /** Default interval in seconds (for scheduled agents) */
  defaultInterval?: number;
  /** Tags for categorization */
  tags?: string[];
}

/**
 * Agent run function signature
 * All agents must export a function matching this signature
 */
export type AgentRunFn = (ctx: AgentContext, input: AgentInput) => Promise<AgentResult>;

/**
 * Complete agent module definition
 */
export interface AgentModule {
  /** Agent metadata */
  meta: AgentMeta;
  /** The run function */
  run: AgentRunFn;
}

/**
 * Options for runtime.run()
 */
export interface RunOptions {
  /** Timeout in milliseconds (default: 5 minutes) */
  timeout?: number;
  /** Whether to run in background (fire-and-forget) */
  background?: boolean;
  /** Callback for progress updates */
  onProgress?: (message: string) => void;
}

/**
 * Envelope wrapping agent results with execution metadata
 */
export interface ResultEnvelope {
  /** The agent that was run */
  agentId: string;
  /** When execution started */
  startedAt: string;
  /** When execution completed */
  completedAt: string;
  /** The result */
  result: AgentResult;
  /** Executor used (web-process, mobile-inproc, etc.) */
  executor: string;
}
