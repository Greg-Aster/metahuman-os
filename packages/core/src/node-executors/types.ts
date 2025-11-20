/**
 * Shared Type Definitions for Node Executors
 */

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
  [key: string]: any;
}

export type NodeExecutor = (
  inputs: Record<string, any>,
  context: NodeExecutionContext,
  nodeProperties?: Record<string, any>
) => Promise<Record<string, any>>;
