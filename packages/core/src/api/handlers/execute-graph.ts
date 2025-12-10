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

async function ensureGraphExecutor(): Promise<boolean> {
  try {
    const mod = await import('../../graph-executor.js');
    executeGraph = mod.executeGraph;
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

    if (!graph || !graph.nodes || !graph.links) {
      return { status: 400, error: 'Invalid graph structure' };
    }

    console.log('[execute-graph] Starting graph execution:', {
      nodeCount: graph.nodes.length,
      linkCount: graph.links.length,
      sessionId,
      hasUserMessage: !!userMessage,
    });

    // Audit the execution request
    await audit({
      level: 'info',
      category: 'system',
      event: 'graph_execution_start',
      details: {
        sessionId,
        nodeCount: graph.nodes.length,
        linkCount: graph.links.length,
        hasUserMessage: !!userMessage,
      },
    });

    // Execute the graph with real node implementations
    const result = await executeGraph(graph, {
      sessionId,
      userMessage,
      environment: 'server', // Force server-side execution
    });

    const durationMs = Date.now() - startTime;

    // Audit successful completion
    await audit({
      level: 'info',
      category: 'system',
      event: 'graph_execution_complete',
      details: {
        sessionId,
        durationMs,
        nodeCount: result.executedNodes?.length || 0,
        success: true,
      },
    });

    console.log('[execute-graph] Execution completed:', {
      durationMs,
      executedNodes: result.executedNodes?.length || 0,
    });

    return successResponse({
      success: true,
      result,
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
