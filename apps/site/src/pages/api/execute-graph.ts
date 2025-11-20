import type { APIRoute } from 'astro';
import { executeGraph } from '@metahuman/core/graph-executor';
import { audit } from '@metahuman/core';

export const POST: APIRoute = async ({ request }) => {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { graph, sessionId, userMessage } = body;

    if (!graph || !graph.nodes || !graph.links) {
      return new Response(
        JSON.stringify({ error: 'Invalid graph structure' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log('[execute-graph] Starting graph execution:', {
      nodeCount: graph.nodes.length,
      linkCount: graph.links.length,
      sessionId,
      hasUserMessage: !!userMessage,
    });

    // Audit the execution request
    await audit({
      category: 'system',
      action: 'graph_execution_start',
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
      category: 'system',
      action: 'graph_execution_complete',
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

    return new Response(
      JSON.stringify({
        success: true,
        result,
        durationMs,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    const durationMs = Date.now() - startTime;

    console.error('[execute-graph] Execution failed:', error);

    // Audit failure
    await audit({
      category: 'system',
      action: 'graph_execution_failed',
      details: {
        error: error?.message || 'Unknown error',
        durationMs,
      },
      level: 'error',
    });

    return new Response(
      JSON.stringify({
        error: error?.message || 'Graph execution failed',
        details: error?.stack || error?.toString(),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
