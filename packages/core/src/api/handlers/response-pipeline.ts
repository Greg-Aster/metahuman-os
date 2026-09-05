/**
 * Response Pipeline API Handler
 *
 * Handles card-based responses through a dedicated, focused pipeline.
 * Unlike full conversation modes, this uses a focused seven-node graph:
 *   Card Input → Context → LLM → Action Router → Response Context
 *   → Conversation Buffer → Conversation Memory Saver
 *
 * Key differences from /api/persona_chat:
 * - No memory search (loads only card context)
 * - No conversation buffer loading
 * - Single-pass LLM (no iterative refinement)
 * - Card-type-specific prompts
 * - Separate response buffer for multi-turn tracking
 * - Uses a card-specific response buffer while canonical conversation nodes own
 *   short- and long-term conversation persistence
 */

import type { UnifiedRequest, UnifiedResponse, UnifiedUser } from '../types.js';
import {
  canWriteMemory as modeAllowsMemoryWrites,
  loadCognitiveMode,
  type CognitiveModeId,
} from '../../cognitive-mode.js';
import {
  cognitiveGraphPath,
  getFirstFailedNode,
  listFailedNodes,
  loadGraphFile,
  requireGraphNodeOutput,
  runGraph,
  sseData,
  type CachedGraphEntry,
} from '../../graph-runtime.js';
import type { SvelteFlowGraph } from '../../cognitive-graph-schema.js';
import type { GraphExecutionState } from '../../graph-executor.js';
import type { NodeExecutionContext } from '../../nodes/types.js';
import { beginTTSUserTurn } from '../../tts/delivery-queue.js';

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
  sessionId: string;
  /** Speech generation captured when this user turn was admitted. */
  ttsGeneration?: number;
}

export interface ResponsePipelineResult {
  success: boolean;
  response?: string;
  responseBufferId?: string;
  actionTaken?: string;
  pipelineTriggered?: boolean;
  nextStatus?: string;
  error?: string;
  errorDetails?: string;
  suggestion?: string;
  failedNode?: string | null;
  failedNodes?: Array<{ nodeId: string; error: string }>;
  executionTimeMs?: number;
}

export const RESPONSE_PIPELINE_CARD_TYPES = [
  'curiosity_response',
  'desire_rejection',
  'clarifying_questions',
  'desire_plan',
] as const;

const RESPONSE_PIPELINE_CARD_TYPE_SET = new Set<string>(RESPONSE_PIPELINE_CARD_TYPES);

export function validateResponsePipelineRequest(request: ResponsePipelineRequest): string | null {
  if (!request.message || typeof request.message !== 'string' || !request.message.trim()) {
    return 'Message is required';
  }
  if (!request.cardType || typeof request.cardType !== 'string') {
    return 'Card type is required';
  }
  if (!RESPONSE_PIPELINE_CARD_TYPE_SET.has(request.cardType)) {
    return `Unsupported response pipeline card type: ${request.cardType}`;
  }
  if (!request.cardData || typeof request.cardData !== 'object' || Array.isArray(request.cardData)) {
    return 'Card data is required';
  }
  if (request.cardType === 'curiosity_response') {
    if (typeof request.cardData.questionId !== 'string' || !request.cardData.questionId.trim()) {
      return 'Curiosity response requires a questionId';
    }
  } else if (typeof request.cardData.desireId !== 'string' || !request.cardData.desireId.trim()) {
    return `${request.cardType} requires a desireId`;
  }
  if (typeof request.sessionId !== 'string' || !request.sessionId.trim()) {
    return 'Session ID is required';
  }
  return null;
}

export function buildResponsePipelineExecutionContext(
  request: ResponsePipelineRequest,
  username: string,
  cognitiveMode: CognitiveModeId,
  signal?: AbortSignal,
  userRole?: UnifiedUser['role'],
): NodeExecutionContext {
  return {
    sessionId: request.sessionId.trim(),
    userMessage: request.message.trim(),
    userId: username,
    username,
    userRole,
    cardType: request.cardType,
    cardData: request.cardData,
    responseBufferId: request.responseBufferId,
    cognitiveMode,
    allowMemoryWrites: modeAllowsMemoryWrites(cognitiveMode),
    recordPersonaMemory: true,
    environment: 'server',
    ttsGeneration: request.ttsGeneration,
    abortSignal: signal,
  };
}

// ============================================================================
// Graph Loading
// ============================================================================

const graphCache: Record<string, CachedGraphEntry | null> = {};

/**
 * Load the response pipeline graph with caching
 */
async function loadResponsePipelineGraph(): Promise<SvelteFlowGraph | null> {
  const loaded = await loadGraphFile(cognitiveGraphPath('response-pipeline.json'), {
    cache: graphCache,
    cacheKey: 'response-pipeline',
    logPrefix: '[response-pipeline]',
  });
  return loaded?.graph ?? null;
}

// ============================================================================
// Error Suggestion Helper
// ============================================================================

/**
 * Generate actionable error suggestions based on error type and failed node
 */
function getErrorSuggestion(error: string, failedNode: string | null): string {
  // Big Brother provider errors
  if (error.includes('Big Brother') || error.includes('Claude') || error.includes('claude_cli')) {
    return 'The selected Big Brother provider may have crashed or become unresponsive. Try:\n• Check the visible Big Brother terminal for errors\n• Close the terminal tab to cancel the process\n• Send the request again';
  }

  // Node-specific failures
  if (failedNode === 'card_input') {
    return 'Failed to parse card input. Try:\n• Refresh the page\n• Check if the card data is valid\n• Report this issue if it persists';
  }

  if (failedNode === 'card_context_loader') {
    return 'Failed to load card context. Try:\n• Refresh the page\n• Check if the card still exists\n• Verify your profile storage is accessible\n• Check file permissions on your profile directory';
  }

  if (failedNode === 'response_llm') {
    return 'LLM generation failed. Try:\n• Check if Ollama/vLLM is running\n• Verify models are loaded (check Settings → Backend)\n• Check Big Brother status in the terminal\n• Try using a different model\n• Check system resources (CPU/Memory)';
  }

  if (failedNode === 'response_action_router') {
    return 'Failed to update desire status. Try:\n• Check profile storage permissions\n• Verify desire file exists and is not corrupted\n• Check disk space\n• Try refreshing the desire in the UI';
  }

  if (failedNode === 'response_context_writer' || failedNode === 'conversation_buffer') {
    return 'Failed to save response. Try:\n• Check disk space\n• Verify profile storage is writable\n• Check file permissions\n• Look for file system errors in logs';
  }

  // LLM/Model errors
  if (error.includes('model') || error.includes('ollama') || error.includes('vllm')) {
    return 'Model or LLM backend issue. Try:\n• Check if your LLM backend is running (Settings → Backend)\n• Verify the model is loaded\n• Try switching to a different model\n• Restart your LLM backend';
  }

  // Memory/Resource errors
  if (error.includes('memory') || error.includes('out of memory') || error.includes('OOM')) {
    return 'System resource issue. Try:\n• Close other applications to free memory\n• Use a smaller model\n• Restart the LLM backend\n• Check system resource usage';
  }

  // File system errors
  if (error.includes('ENOENT') || error.includes('file not found') || error.includes('cannot find')) {
    return 'File not found. Try:\n• Refresh the page\n• Check if your profile storage is mounted/accessible\n• Verify file permissions\n• Check if the desire or card was deleted';
  }

  if (error.includes('EACCES') || error.includes('permission denied')) {
    return 'Permission denied. Try:\n• Check file permissions on your profile directory\n• Ensure the server has write access\n• Check if files are locked by another process';
  }

  // Network/Connection errors
  if (error.includes('connect') || error.includes('ECONNREFUSED') || error.includes('timeout')) {
    return 'Connection issue. Try:\n• Check if the backend server is running\n• Verify network connectivity\n• Restart the backend service\n• Check firewall settings';
  }

  // Generic fallback
  return 'An unexpected error occurred. Try:\n• Check the terminal/console for detailed error logs\n• Refresh the page\n• Restart the server\n• Report this issue with logs if it persists';
}

function failedNodeType(graphState: GraphExecutionState, nodeId: string | null): string | null {
  return nodeId ? graphState.nodes.get(nodeId)?.definition?.type || nodeId : null;
}

export function extractResponsePipelineResult(
  graphState: GraphExecutionState,
): Omit<ResponsePipelineResult, 'success' | 'executionTimeMs'> {
  if (graphState.status !== 'completed') {
    const failed = listFailedNodes(graphState);
    const detail = failed.map(node => `${node.nodeId}: ${node.error}`).join('; ');
    throw new Error(detail || `Response pipeline graph ended with status ${graphState.status}`);
  }

  const action = requireGraphNodeOutput(graphState, 'response_action_router');
  const responseContext = requireGraphNodeOutput(graphState, 'response_context_writer');
  const conversation = requireGraphNodeOutput(graphState, 'conversation_buffer');
  const memory = requireGraphNodeOutput(graphState, 'memory_capture');

  const response = typeof action.response === 'string' ? action.response.trim() : '';
  const responseBufferId = typeof responseContext.responseBufferId === 'string'
    ? responseContext.responseBufferId.trim()
    : '';
  const actionTaken = typeof action.actionTaken === 'string' ? action.actionTaken.trim() : '';

  if (!response) throw new Error('Response Action Router produced no response');
  if (!responseBufferId) throw new Error('Response Context Writer produced no response buffer ID');
  if (responseContext.persisted !== true || responseContext.exchangeCount !== 2) {
    throw new Error('Response Context Writer did not persist the complete card exchange');
  }
  if (conversation.persisted !== true || conversation.messageCount !== 2) {
    throw new Error('Conversation Buffer did not persist the complete user/assistant exchange');
  }
  if (memory.saved !== true || memory.savedCount !== conversation.messageCount) {
    throw new Error('Conversation Memory Saver did not persist every admitted conversation entry');
  }
  if (!actionTaken) throw new Error('Response Action Router produced no action receipt');
  if (typeof action.pipelineTriggered !== 'boolean') {
    throw new Error('Response Action Router produced an invalid pipeline receipt');
  }
  if (action.nextStatus !== null && action.nextStatus !== undefined && typeof action.nextStatus !== 'string') {
    throw new Error('Response Action Router produced an invalid next status');
  }

  return {
    response,
    responseBufferId,
    actionTaken,
    pipelineTriggered: action.pipelineTriggered,
    nextStatus: action.nextStatus || undefined,
  };
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Execute the response pipeline for a card response
 */
export async function handleResponsePipeline(
  request: ResponsePipelineRequest,
  username: string,
  signal?: AbortSignal,
  userRole?: UnifiedUser['role'],
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

    const { message, cardType, cardData, responseBufferId, sessionId, ttsGeneration } = request;

    // Step 2: Validate inputs
    logStep(2, 'Validating inputs');
    const validationError = validateResponsePipelineRequest(request);
    if (validationError) {
      console.error(`${LOG} Validation failed: ${validationError}`);
      return { success: false, error: validationError };
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
    const executionContext = buildResponsePipelineExecutionContext(
      { message, cardType, cardData, responseBufferId, sessionId, ttsGeneration },
      username,
      loadCognitiveMode().currentMode,
      signal,
      userRole,
    );

    logStep(4, 'Context built', {
      sessionId: executionContext.sessionId,
      cardType,
      userId: username,
    });

    // Step 5: Execute the graph
    logStep(5, 'Starting graph execution');
    let nodeExecutionCount = 0;
    const graphState = await runGraph({ graph, context: executionContext, signal, eventHandler: (event) => {
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
    } });

    const executionTimeMs = Date.now() - startTime;
    logStep(5, 'Graph execution complete', { nodeExecutionCount, executionTimeMs });

    // Step 5.5: Validate graph execution status
    logStep(5.5, 'Validating graph execution status', { status: graphState.status });

    if (graphState.status === 'failed') {
      console.error(`${LOG} FAILED: Graph execution failed`);

      // Find which node(s) failed and collect error details
      const failedNodes = listFailedNodes(graphState);
      const firstFailedNode = getFirstFailedNode(graphState);
      const failedNode = failedNodeType(graphState, firstFailedNode?.nodeId ?? null);
      const failedNodeError = firstFailedNode?.error ?? null;

      logStep(5.5, 'Graph failed - nodes with errors', { failedNodes });

      return {
        success: false,
        error: `Pipeline failed at node: ${failedNode || 'unknown'}`,
        errorDetails: failedNodeError || 'No error details available',
        suggestion: getErrorSuggestion(failedNodeError || '', failedNode),
        failedNode,
        failedNodes: failedNodes.length > 1 ? failedNodes : undefined,
        executionTimeMs,
      };
    }

    // Step 6: Extract output
    logStep(6, 'Extracting output from graph state');
    const output = extractResponsePipelineResult(graphState);

    logStep(6, 'Output extracted', { outputKeys: Object.keys(output) });

    // Step 7: Build result
    logStep(7, 'Building response result');
    const response = output.response || '';
    const responseBufferIdResult = output.responseBufferId;
    const actionTaken = output.actionTaken || '';
    const pipelineTriggered = output.pipelineTriggered === true;
    const nextStatus = output.nextStatus || undefined;

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
  username: string,
  signal?: AbortSignal,
  userRole?: UnifiedUser['role'],
): Response {
  const { message, cardType, cardData, responseBufferId, sessionId, ttsGeneration } = request;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const push = (type: string, data: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sseData(type, data)));
        } catch (err) {
          console.error('[response-pipeline-stream] Push error:', err);
          closed = true;
        }
      };

      try {
        const validationError = validateResponsePipelineRequest(request);
        if (validationError) throw new Error(validationError);

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
        const executionContext = buildResponsePipelineExecutionContext(
          { message, cardType, cardData, responseBufferId, sessionId, ttsGeneration },
          username,
          loadCognitiveMode().currentMode,
          signal,
          userRole,
        );

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
        const graphState = await runGraph({ graph, context: executionContext, eventHandler, signal });
        const duration = Date.now() - startedAt;
        if (graphState.status !== 'completed') {
          const failedNodes = listFailedNodes(graphState);
          const firstFailedNode = getFirstFailedNode(graphState);
          const failedNode = failedNodeType(graphState, firstFailedNode?.nodeId ?? null);
          const message = firstFailedNode?.error
            || (signal?.aborted ? 'Response pipeline cancelled' : `Pipeline ended with status ${graphState.status}`);
          push('error', {
            message,
            failedNode,
            failedNodes,
            suggestion: getErrorSuggestion(message, failedNode),
          });
          closed = true;
          try { controller.close(); } catch {}
          return;
        }

        const output = extractResponsePipelineResult(graphState);

        // Send result
        push('progress', { step: 'complete', message: `Completed in ${duration}ms` });

        push('answer', {
          response: output.response || '',
          responseBufferId: output.responseBufferId,
          actionTaken: output.actionTaken || '',
          pipelineTriggered: output.pipelineTriggered === true,
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

async function* responseToChunks(response: Response): AsyncIterable<string> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }

    const tail = decoder.decode();
    if (tail) {
      yield tail;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * POST /api/response-pipeline
 */
export async function handleResponsePipelineApi(req: UnifiedRequest): Promise<UnifiedResponse> {
  if (!req.user.isAuthenticated) {
    return {
      status: 401,
      data: { error: 'Authentication required.' },
    };
  }

  const body = req.body as (ResponsePipelineRequest & { streaming?: boolean }) | undefined;
  const { message, cardType, cardData, responseBufferId, sessionId, streaming } = body || {};

  try {
    const pipelineRequest: ResponsePipelineRequest = {
      message: message as string,
      cardType: cardType as string,
      cardData: cardData as ResponsePipelineRequest['cardData'],
      responseBufferId,
      sessionId: sessionId as string,
    };
    const validationError = validateResponsePipelineRequest(pipelineRequest);
    if (validationError) {
      return { status: 400, data: { error: validationError } };
    }
    const inheritedTTSGeneration = typeof req.metadata?.ttsGeneration === 'number'
      ? req.metadata.ttsGeneration
      : undefined;
    pipelineRequest.ttsGeneration = inheritedTTSGeneration
      ?? beginTTSUserTurn(req.user.username, 'user-input')?.generation;

    if (streaming) {
      const response = streamResponsePipeline(pipelineRequest, req.user.username, req.signal, req.user.role);
      return {
        status: response.status,
        stream: responseToChunks(response),
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      };
    }

    const result = await handleResponsePipeline(pipelineRequest, req.user.username, req.signal, req.user.role);

    if (!result.success) {
      return {
        status: 500,
        data: { error: result.error },
      };
    }

    return {
      status: 200,
      data: result,
    };
  } catch (error) {
    return {
      status: 500,
      data: { error: error instanceof Error ? error.message : 'Unknown error' },
    };
  }
}
