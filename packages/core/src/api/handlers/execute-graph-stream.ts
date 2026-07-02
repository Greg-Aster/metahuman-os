/**
 * Streaming Execute Graph API Handler
 *
 * POST execute a cognitive graph with SSE streaming of node execution status.
 * Lightweight event emission - doesn't affect execution performance.
 */

import type { ExecutionEvent } from '../../graph-executor.js';
import { collectNodeOutputs, extractGraphOutput, namedSse, runGraph } from '../../graph-runtime.js';

/**
 * Format SSE message
 */
function formatSSE(event: string, data: any): string {
  return namedSse(event, data);
}

/**
 * POST /api/execute-graph-stream - Execute a cognitive graph with streaming status
 *
 * Returns SSE stream with events:
 * - node_start: { nodeId, nodeType }
 * - node_complete: { nodeId }
 * - node_error: { nodeId, error }
 * - graph_complete: { response, duration }
 * - graph_error: { error }
 */
export async function handleExecuteGraphStream(
  graph: any,
  sessionId: string,
  userMessage: string | undefined,
  username: string,
  onEvent: (chunk: string) => void
): Promise<void> {
  const startTime = Date.now();

  try {
    if (!graph || !graph.nodes || !graph.edges) {
      onEvent(formatSSE('error', { error: 'Invalid graph structure' }));
      return;
    }

    console.log('[execute-graph-stream] Starting streaming execution:', {
      nodeCount: graph.nodes.length,
      sessionId,
      username,
    });

    // Event handler that streams to client
    const eventHandler = (event: ExecutionEvent) => {
      switch (event.type) {
        case 'node_start':
          onEvent(formatSSE('node_start', {
            nodeId: event.nodeId,
            nodeType: event.data?.nodeType,
            timestamp: event.timestamp,
          }));
          break;

        case 'node_complete':
          onEvent(formatSSE('node_complete', {
            nodeId: event.nodeId,
            timestamp: event.timestamp,
          }));
          break;

        case 'node_error':
          onEvent(formatSSE('node_error', {
            nodeId: event.nodeId,
            error: event.data?.error,
            timestamp: event.timestamp,
          }));
          break;

        case 'graph_complete':
          // Don't send here - we'll send with response after getGraphOutput
          break;

        case 'graph_error':
          onEvent(formatSSE('graph_error', {
            error: event.data?.error,
            timestamp: event.timestamp,
          }));
          break;
      }
    };

    // Execute the graph with streaming events - include username/userId for auth and memory access
    const graphState = await runGraph({ graph, context: {
      sessionId,
      userMessage,
      username,
      userId: username, // auth_check node expects userId
      environment: 'server',
    }, eventHandler });

    const durationMs = Date.now() - startTime;

    // Extract the final output
    const output = extractGraphOutput(graphState);
    const response = output?.response || output?.output || null;

    // Build node outputs map for display nodes (output_viewer, etc.)
    const nodeOutputs = collectNodeOutputs(graphState);

    // Send final completion event with response and node outputs
    onEvent(formatSSE('graph_complete', {
      response,
      durationMs,
      status: graphState.status,
      nodeOutputs,
    }));

    console.log('[execute-graph-stream] Streaming execution completed:', {
      durationMs,
      hasResponse: !!response,
    });

  } catch (error: any) {
    console.error('[execute-graph-stream] Streaming execution failed:', error);
    onEvent(formatSSE('graph_error', {
      error: error?.message || 'Graph execution failed',
    }));
  }
}
