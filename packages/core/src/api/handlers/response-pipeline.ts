/**
 * Response Pipeline API Handler
 *
 * Handles card-based responses through a dedicated, focused pipeline.
 * Unlike dual-consciousness (34 nodes), this uses a simple 5-node graph:
 *   CardInput → CardContextLoader → ResponseLLM → ResponseActionRouter → DualWriter
 *
 * Key differences from /api/persona_chat:
 * - No memory search (loads only card context)
 * - No conversation buffer loading
 * - Single-pass LLM (no iterative refinement)
 * - Card-type-specific prompts
 * - Separate response buffer for multi-turn tracking
 * - Saves as 'card_response' memory type for LoRA training
 */

import { executeGraph, getGraphOutput } from '../../graph-executor.js';
import { validateSvelteFlowGraph, type SvelteFlowGraph } from '../../cognitive-graph-schema.js';
import { ROOT } from '../../path-builder.js';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface ResponsePipelineRequest {
  /** User's response message */
  message: string;
  /** Type of card being responded to */
  cardType: string;
  /** Card metadata (desireId, questionId, content, etc.) */
  cardData: {
    desireId?: string;
    questionId?: string;
    content?: string;
    desireTitle?: string;
    [key: string]: unknown;
  };
  /** Existing response buffer ID for multi-turn */
  responseBufferId?: string;
  /** Session ID */
  sessionId?: string;
}

export interface ResponsePipelineResult {
  success: boolean;
  response?: string;
  responseBufferId?: string;
  actionTaken?: string;
  pipelineTriggered?: boolean;
  nextStatus?: string;
  error?: string;
  executionTimeMs?: number;
}

// ============================================================================
// Graph Loading
// ============================================================================

interface GraphCacheEntry {
  source: string;
  mtimeMs: number;
  graph: SvelteFlowGraph;
}

let graphCache: GraphCacheEntry | null = null;

/**
 * Load the response pipeline graph with caching
 */
async function loadResponsePipelineGraph(): Promise<SvelteFlowGraph | null> {
  const filePath = path.join(ROOT, 'etc', 'cognitive-graphs', 'response-pipeline.json');

  try {
    if (!existsSync(filePath)) {
      console.error('[response-pipeline] Graph file not found:', filePath);
      return null;
    }

    const stats = await stat(filePath);

    // Use cache if valid
    if (graphCache && graphCache.source === filePath && graphCache.mtimeMs === stats.mtimeMs) {
      console.log('[response-pipeline] Using cached graph');
      return graphCache.graph;
    }

    // Load fresh
    console.log('[response-pipeline] Loading graph from:', filePath);
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const validated = validateSvelteFlowGraph(parsed);

    graphCache = { source: filePath, mtimeMs: stats.mtimeMs, graph: validated };
    console.log('[response-pipeline] Graph loaded:', validated.name);

    return validated;
  } catch (error) {
    console.error('[response-pipeline] Failed to load graph:', error);
    return null;
  }
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Execute the response pipeline for a card response
 */
export async function handleResponsePipeline(
  request: ResponsePipelineRequest,
  username: string
): Promise<ResponsePipelineResult> {
  const startTime = Date.now();
  const LOG = '[response-pipeline-handler]';

  // Step-by-step logging helper
  const logStep = (step: number, msg: string, data?: any) => {
    const elapsed = Date.now() - startTime;
    console.log(`${LOG} [${elapsed}ms] Step ${step}: ${msg}`, data ? JSON.stringify(data, null, 2) : '');
  };

  try {
    logStep(1, 'HANDLER STARTED', { username, requestKeys: Object.keys(request) });

    const { message, cardType, cardData, responseBufferId, sessionId } = request;

    // Step 2: Validate inputs
    logStep(2, 'Validating inputs');
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      console.error(`${LOG} Validation failed: Message is required`);
      return { success: false, error: 'Message is required' };
    }

    if (!cardType || typeof cardType !== 'string') {
      console.error(`${LOG} Validation failed: Card type is required`);
      return { success: false, error: 'Card type is required' };
    }

    logStep(2, 'Inputs validated', {
      cardType,
      desireId: cardData?.desireId,
      hasExistingBuffer: !!responseBufferId,
      messageLength: message.length,
    });

    // Step 3: Load the graph
    logStep(3, 'Loading response pipeline graph');
    const graph = await loadResponsePipelineGraph();
    if (!graph) {
      console.error(`${LOG} FAILED: Could not load graph`);
      return { success: false, error: 'Failed to load response pipeline graph' };
    }
    logStep(3, 'Graph loaded', { graphName: graph.name, nodeCount: graph.nodes?.length });

    // Step 4: Build execution context
    logStep(4, 'Building execution context');
    const executionContext = {
      sessionId: sessionId || `response-${Date.now()}`,
      userMessage: message.trim(),
      userId: username,
      username,
      cardType,
      cardData,
      responseBufferId,
      cognitiveMode: 'response_pipeline',
      allowMemoryWrites: true,
      environment: 'server',
    };

    logStep(4, 'Context built', {
      sessionId: executionContext.sessionId,
      cardType,
      userId: username,
    });

    // Step 5: Execute the graph
    logStep(5, 'Starting graph execution');
    let nodeExecutionCount = 0;
    const graphState = await executeGraph(graph, executionContext, (event) => {
      // Log ALL events for comprehensive debugging
      if (event.type === 'node_start') {
        nodeExecutionCount++;
        console.log(`${LOG}   [node ${nodeExecutionCount}] STARTED: ${event.nodeId} (${event.data?.nodeType || 'unknown'})`);
      } else if (event.type === 'node_complete') {
        console.log(`${LOG}   [node ${nodeExecutionCount}] COMPLETE: ${event.nodeId}`);
      } else if (event.type === 'node_error') {
        console.error(`${LOG}   [node ${nodeExecutionCount}] ERROR: ${event.nodeId}`, event.data?.error);
      } else {
        console.log(`${LOG}   [event] ${event.type}:`, event.nodeId);
      }
    });

    const executionTimeMs = Date.now() - startTime;
    logStep(5, 'Graph execution complete', { nodeExecutionCount, executionTimeMs });

    // Step 6: Extract output
    logStep(6, 'Extracting output from graph state');
    const output = getGraphOutput(graphState);

    if (!output) {
      console.error(`${LOG} FAILED: Graph produced no output`);
      console.error(`${LOG} Graph state keys:`, Object.keys(graphState || {}));
      return {
        success: false,
        error: 'Pipeline produced no output',
        executionTimeMs,
      };
    }

    logStep(6, 'Output extracted', { outputKeys: Object.keys(output) });

    // Step 7: Build result
    logStep(7, 'Building response result');
    const response = output.response || output.output || '';
    const responseBufferIdResult = output.responseBufferId || responseBufferId;
    const actionTaken = output.actionTaken || '';
    const pipelineTriggered = output.pipelineTriggered || false;
    const nextStatus = output.nextStatus || null;

    logStep(7, 'Result ready', {
      hasResponse: !!response,
      responseLength: response.length,
      responseBufferId: responseBufferIdResult,
      actionTaken,
      pipelineTriggered,
      nextStatus,
      executionTimeMs,
    });

    console.log(`${LOG} ========== SUCCESS ==========`);
    console.log(`${LOG} Total execution time: ${executionTimeMs}ms`);
    console.log(`${LOG} Response preview: ${response.substring(0, 100)}${response.length > 100 ? '...' : ''}`);

    return {
      success: true,
      response,
      responseBufferId: responseBufferIdResult,
      actionTaken,
      pipelineTriggered,
      nextStatus,
      executionTimeMs,
    };

  } catch (error) {
    const executionTimeMs = Date.now() - startTime;
    console.error(`${LOG} ========== FATAL ERROR ==========`);
    console.error(`${LOG} Error type:`, (error as Error).constructor?.name);
    console.error(`${LOG} Error message:`, (error as Error).message);
    console.error(`${LOG} Stack trace:`, (error as Error).stack);
    console.error(`${LOG} Execution time before error: ${executionTimeMs}ms`);
    return {
      success: false,
      error: (error as Error).message || 'Unknown error',
      executionTimeMs,
    };
  }
}

// ============================================================================
// Streaming Handler (for SSE)
// ============================================================================

/**
 * Execute the response pipeline with SSE streaming
 */
export function streamResponsePipeline(
  request: ResponsePipelineRequest,
  username: string
): Response {
  const { message, cardType, cardData, responseBufferId, sessionId } = request;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const push = (type: string, data: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
        } catch (err) {
          console.error('[response-pipeline-stream] Push error:', err);
          closed = true;
        }
      };

      try {
        push('progress', { step: 'loading', message: 'Loading response pipeline...' });

        // Load graph
        const graph = await loadResponsePipelineGraph();
        if (!graph) {
          push('error', { message: 'Failed to load response pipeline graph' });
          closed = true;
          try { controller.close(); } catch {}
          return;
        }

        push('progress', { step: 'loaded', message: 'Pipeline loaded, processing...' });

        // Build context
        const executionContext = {
          sessionId: sessionId || `response-${Date.now()}`,
          userMessage: message.trim(),
          userId: username,
          username,
          cardType,
          cardData,
          responseBufferId,
          cognitiveMode: 'response_pipeline',
          allowMemoryWrites: true,
          environment: 'server',
        };

        const startedAt = Date.now();

        // Event handler
        const eventHandler = (event: any) => {
          if (event.type === 'node_start') {
            push('progress', {
              step: 'node_executing',
              nodeId: event.nodeId,
              message: `Executing ${event.data?.nodeType || event.nodeId}...`,
            });
          } else if (event.type === 'node_error') {
            push('progress', {
              step: 'node_error',
              nodeId: event.nodeId,
              error: event.data?.error,
            });
          }
        };

        // Execute
        const graphState = await executeGraph(graph, executionContext, eventHandler);
        const duration = Date.now() - startedAt;
        const output = getGraphOutput(graphState);

        if (!output) {
          push('error', { message: 'Pipeline produced no output' });
          closed = true;
          try { controller.close(); } catch {}
          return;
        }

        // Send result
        push('progress', { step: 'complete', message: `Completed in ${duration}ms` });

        push('answer', {
          response: output.response || output.output || '',
          responseBufferId: output.responseBufferId || responseBufferId,
          actionTaken: output.actionTaken || '',
          pipelineTriggered: output.pipelineTriggered || false,
          nextStatus: output.nextStatus || null,
          executionTime: duration,
        });

        // Small delay before closing
        await new Promise(resolve => setTimeout(resolve, 100));
        closed = true;
        try { controller.close(); } catch {}

      } catch (error) {
        push('error', { message: (error as Error).message || 'Unknown error' });
        closed = true;
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
