/**
 * Error boundaries and fallback handling for graph execution
 * Provides graceful degradation when nodes fail
 */

import type { CognitiveGraph } from './cognitive-graph-schema.js';
import type { NodeExecutionContext } from './nodes/index.js';
import { audit } from './audit.js';

export interface ErrorBoundaryOptions {
  maxRetries?: number;
  fallbackToSimpleChat?: boolean;
  logErrors?: boolean;
  throwOnCriticalFailure?: boolean;
}

export interface ExecutionError {
  nodeId?: number;
  nodeType?: string;
  error: Error;
  timestamp: number;
  recoverable: boolean;
}

export interface ErrorBoundaryResult {
  success: boolean;
  output?: any;
  errors: ExecutionError[];
  fallbackUsed: boolean;
  criticalFailure: boolean;
}

/**
 * Wraps graph execution with error boundaries
 * Provides retry logic and fallback handling
 */
export async function executeWithErrorBoundary(
  executeFn: () => Promise<any>,
  options: ErrorBoundaryOptions = {}
): Promise<ErrorBoundaryResult> {
  const {
    maxRetries = 3,
    fallbackToSimpleChat = true,
    logErrors = true,
    throwOnCriticalFailure = false,
  } = options;

  const errors: ExecutionError[] = [];
  let retries = 0;
  let fallbackUsed = false;

  while (retries < maxRetries) {
    try {
      const output = await executeFn();

      // Success!
      if (errors.length > 0 && logErrors) {
        audit({
          level: 'info',
          category: 'system',
          event: 'graph_execution_recovered',
          details: {
            retries,
            errorsRecovered: errors.length,
          },
        });
      }

      return {
        success: true,
        output,
        errors,
        fallbackUsed,
        criticalFailure: false,
      };
    } catch (error) {
      retries++;

      const executionError: ExecutionError = {
        error: error as Error,
        timestamp: Date.now(),
        recoverable: retries < maxRetries,
      };

      errors.push(executionError);

      if (logErrors) {
        console.error(`[ErrorBoundary] Execution failed (attempt ${retries}/${maxRetries}):`, error);
      }

      // Wait before retry (exponential backoff)
      if (retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries) * 100));
      }
    }
  }

  // All retries exhausted
  if (logErrors) {
    audit({
      level: 'error',
      category: 'system',
      event: 'graph_execution_failed',
      details: {
        retries,
        errors: errors.map(e => ({
          message: e.error.message,
          timestamp: e.timestamp,
          nodeId: e.nodeId,
          nodeType: e.nodeType,
        })),
      },
    });
  }

  // Determine if this is a critical failure
  const criticalFailure = !fallbackToSimpleChat;

  if (throwOnCriticalFailure && criticalFailure) {
    throw new Error(`Graph execution failed after ${retries} retries: ${errors[errors.length - 1].error.message}`);
  }

  return {
    success: false,
    errors,
    fallbackUsed,
    criticalFailure,
  };
}

/**
 * Simple chat fallback when graph execution fails
 * Uses direct LLM call without graph processing
 */
export async function simpleChatFallback(
  userMessage: string,
  context: NodeExecutionContext
): Promise<string> {
  try {
    console.log('[Fallback] Using simple chat fallback');

    const { callLLM } = await import('./model-router.js');
    const { loadPersonaCore } = await import('./identity.js');

    const persona = loadPersonaCore();

    const response = await callLLM({
      role: 'persona',
      messages: [
        {
          role: 'system',
          content: `You are ${persona.identity.name}. Respond naturally to the user's message.`,
        },
        {
          role: 'user',
          content: userMessage,
        },
      ],
      cognitiveMode: context.cognitiveMode || 'emulation',
    });

    audit({
      level: 'info',
      category: 'system',
      event: 'fallback_chat_used',
      details: {
        userMessage,
        responseLength: response.content.length,
      },
    });

    return response.content;
  } catch (error) {
    console.error('[Fallback] Simple chat fallback also failed:', error);

    audit({
      level: 'error',
      category: 'system',
      event: 'fallback_chat_failed',
      details: {
        error: (error as Error).message,
      },
    });

    return "I'm experiencing technical difficulties and cannot process your message right now. Please try again later.";
  }
}

/**
 * Validates a graph before execution
 * Catches structural errors early
 */
export function validateGraph(graph: CognitiveGraph): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for required fields
  if (!graph.nodes || !Array.isArray(graph.nodes)) {
    errors.push('Graph must have a nodes array');
  }

  if (!graph.links || !Array.isArray(graph.links)) {
    errors.push('Graph must have a links array');
  }

  // Check for nodes with duplicate IDs
  if (graph.nodes) {
    const nodeIds = new Set<number>();
    graph.nodes.forEach(node => {
      if (nodeIds.has(node.id)) {
        errors.push(`Duplicate node ID: ${node.id}`);
      }
      nodeIds.add(node.id);
    });
  }

  // Check for invalid links
  if (graph.nodes && graph.links) {
    const nodeIds = new Set(graph.nodes.map(n => n.id));
    graph.links.forEach((link, index) => {
      if (!nodeIds.has(link.origin_id)) {
        errors.push(`Link ${index}: origin node ${link.origin_id} does not exist`);
      }
      if (!nodeIds.has(link.target_id)) {
        errors.push(`Link ${index}: target node ${link.target_id} does not exist`);
      }
    });
  }

  // Check for cycles (basic check - could be more sophisticated)
  if (graph.nodes && graph.links) {
    const hasUserInput = graph.nodes.some(n => n.type === 'user_input');
    const hasOutput = graph.nodes.some(n =>
      n.type === 'stream_writer' || n.type === 'memory_capture'
    );

    if (!hasUserInput) {
      errors.push('Graph should have at least one user_input node');
    }
    if (!hasOutput) {
      errors.push('Graph should have at least one output node (stream_writer or memory_capture)');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
