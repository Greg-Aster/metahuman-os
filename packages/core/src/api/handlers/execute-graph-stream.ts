/**
 * Streaming Execute Graph API Handler
 *
 * POST execute a cognitive graph with SSE streaming of node execution status.
 * Lightweight event emission - doesn't affect execution performance.
 */

import type { UnifiedHandler } from '../types.js';
import { streamResponse } from '../types.js';
import type { ExecutionEvent } from '../../graph-executor.js';
import {
  collectNodeOutputs,
  extractGraphOutput,
  listSkippedNodes,
  namedSse,
  runGraph,
} from '../../graph-runtime.js';
import { beginTTSUserTurn } from '../../tts/delivery-queue.js';

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
 * - node_complete: { nodeId, durationMs }
 * - node_skip: { nodeId, reason }
 * - node_error: { nodeId, error, durationMs }
 * - graph_complete: { response, duration }
 * - graph_waiting: { response, status, executionId, durationMs }
 * - graph_error: { error }
 */
async function executeGraphWithEvents(
  graph: any,
  sessionId: string,
  userMessage: string | undefined,
  username: string,
  onEvent: (chunk: string) => void
): Promise<void> {
  const startTime = Date.now();
  try {
    const ttsGeneration = username && userMessage?.trim()
      ? beginTTSUserTurn(username, 'user-input')?.generation
      : undefined;

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
            durationMs: event.data?.durationMs,
            timestamp: event.timestamp,
          }));
          break;

        case 'node_skip':
          onEvent(formatSSE('node_skip', {
            nodeId: event.nodeId,
            reason: event.data?.reason,
            timestamp: event.timestamp,
          }));
          break;

        case 'node_error':
          onEvent(formatSSE('node_error', {
            nodeId: event.nodeId,
            error: event.data?.error,
            durationMs: event.data?.durationMs,
            timestamp: event.timestamp,
          }));
          break;

        case 'graph_complete':
          // Don't send here - we'll send with response after getGraphOutput
          break;

        case 'graph_error':
          // The returned state or thrown runtime error is reported once below.
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
      ttsGeneration,
    }, eventHandler });
    if (graphState.status === 'failed' || graphState.error) {
      throw graphState.error ?? new Error('Graph execution failed');
    }

    const durationMs = Date.now() - startTime;

    // Extract the final output
    const output = extractGraphOutput(graphState);
    const response = output?.response || output?.output || null;

    // Build node outputs map for display nodes (output_viewer, etc.)
    const nodeOutputs = collectNodeOutputs(graphState);
    const skippedNodes = listSkippedNodes(graphState);

    // End this stream without labelling a persisted wait as task completion.
    onEvent(formatSSE(graphState.status === 'waiting' ? 'graph_waiting' : 'graph_complete', {
      response,
      durationMs,
      status: graphState.status,
      executionId: graphState.executionId,
      nodeOutputs,
      skippedNodes,
    }));

    console.log('[execute-graph-stream] Streaming execution returned:', {
      status: graphState.status,
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

/** Disconnect ends observation; the existing durable graph owner retains admitted work. */
export const handleExecuteGraphStream: UnifiedHandler = async (req) => {
  const { graph, sessionId, userMessage } = req.body || {};
  async function* events(): AsyncGenerator<string> {
    const pending: string[] = [];
    let wake: (() => void) | undefined;
    let closed = false;
    let completed = false;
    const close = () => { closed = true; pending.length = 0; wake?.(); wake = undefined; };
    req.signal?.addEventListener('abort', close, { once: true });
    try {
      if (req.signal?.aborted) return;
      const execution = executeGraphWithEvents(graph, sessionId, userMessage, req.user.username, chunk => {
        if (closed) return;
        pending.push(chunk);
        wake?.();
        wake = undefined;
      }).finally(() => { completed = true; wake?.(); wake = undefined; });
      while (!closed) {
        while (pending.length && !closed) yield pending.shift()!;
        if (completed) { await execution; break; }
        if (!closed) await new Promise<void>(resolve => { wake = resolve; });
      }
    } finally {
      req.signal?.removeEventListener('abort', close);
      close();
    }
  }
  const response = streamResponse(events());
  return { ...response, headers: { ...response.headers, 'X-Accel-Buffering': 'no' } };
};
