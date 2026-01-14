/**
 * Event Bus Schema
 *
 * Defines the unified event format for all MetaHuman services.
 * All events flow through the event bus for centralized debugging and monitoring.
 */

/**
 * Source services that can publish events
 */
export type EventSource =
  | 'core'
  | 'web'
  | 'agents'
  | 'whisper'
  | 'kokoro'
  | 'rvc'
  | 'sovits'
  | 'piper'
  | 'ollama'
  | 'vllm'
  | 'interpreter'
  | 'big-brother'
  | 'audit'
  | 'graph'
  | 'memory'
  | 'scheduler'
  | 'telemetry';

/**
 * Log levels for filtering
 */
export type EventLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Unified event format for all MetaHuman telemetry
 */
export interface MetaHumanEvent {
  /** ISO 8601 timestamp */
  timestamp: string;

  /** Source service/module */
  source: EventSource;

  /** Event type (dot-separated namespace, e.g., 'memory.captured', 'llm.request.started') */
  event: string;

  /** Correlation ID to trace requests across services */
  requestId?: string;

  /** User session ID */
  sessionId?: string;

  /** User ID for multi-user systems */
  userId?: string;

  /** Log level for filtering */
  level?: EventLevel;

  /** Duration in milliseconds (for completed operations) */
  durationMs?: number;

  /** Event-specific payload */
  data?: Record<string, unknown>;
}

/**
 * Event types by category
 * Used for type-safe event publishing
 */
export const EventTypes = {
  // Core lifecycle
  CORE_STARTED: 'core.started',
  CORE_SHUTDOWN: 'core.shutdown',

  // Memory events
  MEMORY_CAPTURED: 'memory.captured',
  MEMORY_SEARCHED: 'memory.searched',
  MEMORY_INDEXED: 'memory.indexed',

  // LLM events
  LLM_REQUEST_STARTED: 'llm.request.started',
  LLM_REQUEST_COMPLETED: 'llm.request.completed',
  LLM_REQUEST_FAILED: 'llm.request.failed',

  // Agent events
  AGENT_STARTED: 'agent.started',
  AGENT_COMPLETED: 'agent.completed',
  AGENT_FAILED: 'agent.failed',
  AGENT_DESIRE_CREATED: 'agent.desire.created',
  AGENT_DESIRE_TRANSITIONED: 'agent.desire.transitioned',

  // Graph execution events
  GRAPH_EXECUTION_STARTED: 'graph.execution.started',
  GRAPH_NODE_STARTED: 'graph.node.started',
  GRAPH_NODE_COMPLETED: 'graph.node.completed',
  GRAPH_NODE_ERROR: 'graph.node.error',
  GRAPH_EXECUTION_COMPLETED: 'graph.execution.completed',

  // Big Brother events
  BIG_BROTHER_ESCALATION_STARTED: 'bigbrother.escalation.started',
  BIG_BROTHER_TOOL_INVOKED: 'bigbrother.tool.invoked',
  BIG_BROTHER_ESCALATION_COMPLETED: 'bigbrother.escalation.completed',

  // Web events
  WEB_REQUEST_STARTED: 'web.request.started',
  WEB_REQUEST_COMPLETED: 'web.request.completed',
  WEB_SSE_CONNECTED: 'web.sse.connected',
  WEB_SSE_DISCONNECTED: 'web.sse.disconnected',

  // Audit events (forwarded from audit system)
  AUDIT_DECISION: 'audit.decision',
  AUDIT_ACTION: 'audit.action',
  AUDIT_SECURITY: 'audit.security',
  AUDIT_DATA_CHANGE: 'audit.data_change',

  // Voice events
  VOICE_STT_STARTED: 'voice.stt.started',
  VOICE_STT_COMPLETED: 'voice.stt.completed',
  VOICE_TTS_STARTED: 'voice.tts.started',
  VOICE_TTS_COMPLETED: 'voice.tts.completed',

  // Ollama events
  OLLAMA_CHAT_STARTED: 'ollama.chat.started',
  OLLAMA_CHAT_COMPLETED: 'ollama.chat.completed',
  OLLAMA_CHAT_FAILED: 'ollama.chat.failed',
  OLLAMA_GENERATE_STARTED: 'ollama.generate.started',
  OLLAMA_GENERATE_COMPLETED: 'ollama.generate.completed',
  OLLAMA_EMBEDDINGS_STARTED: 'ollama.embeddings.started',
  OLLAMA_EMBEDDINGS_COMPLETED: 'ollama.embeddings.completed',
  OLLAMA_SERVICE_STARTED: 'ollama.service.started',
  OLLAMA_SERVICE_STOPPED: 'ollama.service.stopped',
  OLLAMA_MODEL_LOADED: 'ollama.model.loaded',
  OLLAMA_MODEL_UNLOADED: 'ollama.model.unloaded',

  // vLLM events
  VLLM_CHAT_STARTED: 'vllm.chat.started',
  VLLM_CHAT_COMPLETED: 'vllm.chat.completed',
  VLLM_CHAT_FAILED: 'vllm.chat.failed',
  VLLM_SERVER_STARTED: 'vllm.server.started',
  VLLM_SERVER_STOPPED: 'vllm.server.stopped',
  VLLM_MODEL_LOADED: 'vllm.model.loaded',

  // Open Interpreter events
  INTERPRETER_TASK_STARTED: 'interpreter.task.started',
  INTERPRETER_TASK_COMPLETED: 'interpreter.task.completed',
  INTERPRETER_TASK_FAILED: 'interpreter.task.failed',
  INTERPRETER_SERVER_STARTED: 'interpreter.server.started',
  INTERPRETER_SERVER_STOPPED: 'interpreter.server.stopped',

  // Whisper STT events
  WHISPER_TRANSCRIBE_STARTED: 'whisper.transcribe.started',
  WHISPER_TRANSCRIBE_COMPLETED: 'whisper.transcribe.completed',
  WHISPER_TRANSCRIBE_FAILED: 'whisper.transcribe.failed',
  WHISPER_SERVER_STARTED: 'whisper.server.started',
  WHISPER_SERVER_STOPPED: 'whisper.server.stopped',

  // Kokoro TTS events
  KOKORO_SYNTHESIZE_STARTED: 'kokoro.synthesize.started',
  KOKORO_SYNTHESIZE_COMPLETED: 'kokoro.synthesize.completed',
  KOKORO_SYNTHESIZE_FAILED: 'kokoro.synthesize.failed',
  KOKORO_SERVER_STARTED: 'kokoro.server.started',
  KOKORO_SERVER_STOPPED: 'kokoro.server.stopped',

  // RVC voice events
  RVC_CONVERT_STARTED: 'rvc.convert.started',
  RVC_CONVERT_COMPLETED: 'rvc.convert.completed',
  RVC_CONVERT_FAILED: 'rvc.convert.failed',

  // GPT-SoVITS events
  SOVITS_SYNTHESIZE_STARTED: 'sovits.synthesize.started',
  SOVITS_SYNTHESIZE_COMPLETED: 'sovits.synthesize.completed',
  SOVITS_SYNTHESIZE_FAILED: 'sovits.synthesize.failed',
} as const;

/**
 * Generate a unique request ID for tracing
 */
export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `req-${timestamp}-${random}`;
}

/**
 * Create a properly formatted event
 */
export function createEvent(
  source: EventSource,
  event: string,
  options: Partial<Omit<MetaHumanEvent, 'timestamp' | 'source' | 'event'>> = {}
): MetaHumanEvent {
  return {
    timestamp: new Date().toISOString(),
    source,
    event,
    level: options.level ?? 'info',
    ...options,
  };
}
