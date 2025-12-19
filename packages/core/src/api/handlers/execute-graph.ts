/**
 * Execute Graph API Handlers
 *
 * POST execute a cognitive graph.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { audit } from '../../audit.js';

// Dynamic import for graph executor
let executeGraph: any;
let getGraphOutput: any;

async function ensureGraphExecutor(): Promise<boolean> {
  try {
    const mod = await import('../../graph-executor.js');
    executeGraph = mod.executeGraph;
    getGraphOutput = mod.getGraphOutput;
    return !!executeGraph;
  } catch {
    return false;
  }
}

/**
 * POST /api/execute-graph - Execute a cognitive graph
 */
export async function handleExecuteGraph(req: UnifiedRequest): Promise<UnifiedResponse> {
  const startTime = Date.now();

  try {
    const available = await ensureGraphExecutor();
    if (!available) {
      return { status: 501, error: 'Graph executor not available' };
    }

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
    const graphState = await executeGraph(graph, {
      sessionId,
      userMessage,
      environment: 'server', // Force server-side execution
    });

    const durationMs = Date.now() - startTime;

    // Extract the final output from the graph execution
    const output = getGraphOutput(graphState);
    const response = output?.response || output?.output || null;

    // Build node outputs map for debugging
    const nodeOutputs: Record<string, any> = {};
    graphState.nodes.forEach((nodeState: any, nodeId: string) => {
      if (nodeState.outputs) {
        nodeOutputs[nodeId] = nodeState.outputs;
      }
    });

    // Get list of executed nodes
    const executedNodes = Array.from(graphState.nodes.keys());

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
