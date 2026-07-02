/**
 * Execute Graph API Handlers
 *
 * POST execute a cognitive graph.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { audit } from '../../audit.js';
import { collectNodeOutputs, extractGraphOutput, listExecutedNodes, runGraph } from '../../graph-runtime.js';

/**
 * POST /api/execute-graph - Execute a cognitive graph
 */
export async function handleExecuteGraph(req: UnifiedRequest): Promise<UnifiedResponse> {
  const startTime = Date.now();

  try {
    const { body } = req;
    const { graph, sessionId, userMessage } = body || {};

    // Svelte Flow format only - requires nodes and edges
    if (!graph || !graph.nodes || !graph.edges) {
      return { status: 400, error: 'Invalid graph structure - requires nodes and edges (Svelte Flow format)' };
    }

    console.log('[execute-graph] Starting graph execution:', {
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      sessionId,
      hasUserMessage: !!userMessage,
    });

    // Audit the execution request
    audit({
      level: 'info',
      category: 'system',
      event: 'graph_execution_start',
      details: {
        sessionId,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        hasUserMessage: !!userMessage,
      },
    });

    // Execute the graph with real node implementations
    const graphState = await runGraph({ graph, context: {
      sessionId,
      userMessage,
      environment: 'server', // Force server-side execution
    } });

    const durationMs = Date.now() - startTime;

    // Extract the final output from the graph execution
    const output = extractGraphOutput(graphState);
    const response = output?.response || output?.output || null;

    // Build node outputs map for debugging
    const nodeOutputs = collectNodeOutputs(graphState);

    // Get list of executed nodes
    const executedNodes = listExecutedNodes(graphState);

    // Audit successful completion
    await audit({
      level: 'info',
      category: 'system',
      event: 'graph_execution_complete',
      details: {
        sessionId,
        durationMs,
        nodeCount: executedNodes.length,
        hasResponse: !!response,
        success: true,
      },
    });

    console.log('[execute-graph] Execution completed:', {
      durationMs,
      executedNodes: executedNodes.length,
      hasResponse: !!response,
      responsePreview: response ? response.substring(0, 100) : null,
    });

    return successResponse({
      success: true,
      result: {
        status: graphState.status,
        response,
        nodeOutputs,
        executedNodes,
      },
      durationMs,
    });
  } catch (error: any) {
    const durationMs = Date.now() - startTime;

    console.error('[execute-graph] Execution failed:', error);

    // Audit failure
    await audit({
      category: 'system',
      event: 'graph_execution_failed',
      level: 'error',
      details: {
        error: error?.message || 'Unknown error',
        durationMs,
      },
    });

    return {
      status: 500,
      error: error?.message || 'Graph execution failed',
    };
  }
}
