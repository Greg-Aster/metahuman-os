/**
 * Shared Type Definitions for Node Executors
 */

export interface ProgressEvent {
  type: 'model_loading' | 'model_waiting' | 'model_ready' | 'model_switch' | 'status';
  message: string;
  model?: string;
  currentModel?: string;
  elapsedMs?: number;
}

export interface NodeExecutionContext {
  sessionId?: string;
  userId?: string;
  userMessage?: string;
  cognitiveMode?: 'dual' | 'agent' | 'emulation';
  conversationHistory?: any[];
  contextPackage?: any;
  contextInfo?: string;
  allowMemoryWrites?: boolean;
  useOperator?: boolean;
  /**
   * Emit progress events (model loading, status updates) to the SSE stream
   * This is injected by the graph executor and forwarded to the chat stream
   */
  emitProgress?: (event: ProgressEvent) => void;
  [key: string]: any;
}

export type NodeExecutor = (
  inputs: Record<string, any>,
  context: NodeExecutionContext,
  nodeProperties?: Record<string, any>
) => Promise<Record<string, any>>;
