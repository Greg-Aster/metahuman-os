/**
 * Graph Streaming Module
 *
 * Provides streaming graph execution with real-time progress updates.
 * Extracted from persona_chat.ts to be reusable across endpoints.
 */

import { executeGraph, getGraphOutput } from './graph-executor.js';
import { validateCognitiveGraph, type CognitiveGraph } from './cognitive-graph-schema.js';
import { withUserContext } from './context.js';
import { paths } from './paths.js';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface GraphStreamingParams {
  /** Cognitive mode key (dual, agent, emulation, etc.) */
  cognitiveMode: string;
  /** User message to process */
  message: string;
  /** Session identifier */
  sessionId: string;
  /** User context for authentication */
  userContext?: {
    userId?: string;
    username?: string;
    role?: string;
  };
  /** Pre-loaded conversation history */
  conversationHistory?: any[];
  /** Context package from semantic search */
  contextPackage?: any;
  /** Context info for debugging */
  contextInfo?: any;
  /** Whether to allow memory writes */
  allowMemoryWrites?: boolean;
  /** Whether to use operator */
  useOperator?: boolean;
  /** YOLO mode flag */
  yoloMode?: boolean;
  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeoutMs?: number;
}

export interface StreamEvent {
  type: 'progress' | 'answer' | 'error' | 'cancelled';
  data: any;
}

export interface GraphStreamingCallbacks {
  /** Called when the stream produces an event */
  onEvent?: (event: StreamEvent) => void;
  /** Called when the final answer is ready */
  onAnswer?: (response: string, metadata: { facet?: string; executionTime: number }) => void;
  /** Called on error */
  onError?: (error: Error) => void;
}

export interface LoadedGraph {
  graph: CognitiveGraph;
  source: string;
}

// ============================================================================
// Cancellation Management
// ============================================================================

const activeCancellations = new Map<string, { cancelled: boolean; reason?: string }>();

/**
 * Request cancellation of a streaming operation
 */
export function requestCancellation(requestId: string, reason: string = 'User requested stop'): void {
  activeCancellations.set(requestId, { cancelled: true, reason });
  console.log(`[graph-streaming] Request ${requestId} marked for cancellation: ${reason}`);
}

/**
 * Check if a request has been cancelled
 */
export function checkCancellation(requestId: string): { cancelled: boolean; reason?: string } {
  return activeCancellations.get(requestId) || { cancelled: false };
}

/**
 * Clear cancellation status for a request
 */
export function clearCancellation(requestId: string): void {
  activeCancellations.delete(requestId);
}

// ============================================================================
// Graph Loading & Caching
// ============================================================================

interface GraphCacheEntry {
  source: string;
  mtimeMs: number;
  graph: CognitiveGraph;
}

const graphCache: Record<string, GraphCacheEntry | null> = {};

/**
 * Read and validate a cognitive graph from a file
 */
async function readGraphFromFile(filePath: string): Promise<CognitiveGraph | null> {
  try {
    console.log(`[graph-streaming] Reading graph: ${filePath}`);
    const raw = await readFile(filePath, 'utf-8');
    console.log(`[graph-streaming] File size: ${raw.length} bytes`);
    const parsed = JSON.parse(raw);
    console.log(`[graph-streaming] Parsed: ${parsed.nodes?.length || 0} nodes`);
    const validated = validateCognitiveGraph(parsed);
    console.log(`[graph-streaming] Validation PASSED`);
    return validated;
  } catch (error) {
    console.error('[graph-streaming] Read error:', error);
    return null;
  }
}

/**
 * Load a cognitive graph by mode name with caching
 */
export async function loadGraphForMode(graphKey: string): Promise<LoadedGraph | null> {
  if (!graphKey) {
    console.log('[graph-streaming] No graphKey provided');
    return null;
  }

  const normalizedKey = graphKey.toLowerCase();

  // Check if Big Brother Mode is enabled for dual mode
  let useBigBrotherGraph = false;
  if (normalizedKey === 'dual') {
    try {
      const { loadOperatorConfig } = await import('./config.js');
      const { isClaudeSessionReady } = await import('./claude-session.js');
      const operatorConfig = loadOperatorConfig();
      const bigBrotherEnabled = operatorConfig.bigBrotherMode?.enabled === true;

      if (bigBrotherEnabled) {
        const claudeSessionReady = isClaudeSessionReady();
        if (claudeSessionReady) {
          useBigBrotherGraph = true;
          console.log('[graph-streaming] Big Brother Mode active');
        }
      }
    } catch (error) {
      console.warn('[graph-streaming] Could not check Big Brother status:', error);
    }
  }

  const baseName = useBigBrotherGraph ? `${normalizedKey}-mode-bigbrother` : `${normalizedKey}-mode`;
  const pathsToCheck = [
    path.join(paths.root, 'etc', 'cognitive-graphs', 'custom', `${baseName}.json`),
    path.join(paths.root, 'etc', 'cognitive-graphs', `${baseName}.json`),
  ];

  console.log(`[graph-streaming] Loading graph: "${graphKey}" (${useBigBrotherGraph ? 'Big Brother' : 'standard'})`);

  for (const filePath of pathsToCheck) {
    try {
      if (!existsSync(filePath)) continue;

      const stats = await stat(filePath);
      const cached = graphCache[normalizedKey];

      // Use cache if valid
      if (cached && cached.source === filePath && cached.mtimeMs === stats.mtimeMs) {
        console.log(`[graph-streaming] Using cached graph`);
        return { graph: cached.graph, source: filePath };
      }

      // Load fresh
      const graph = await readGraphFromFile(filePath);
      if (graph) {
        graphCache[normalizedKey] = { source: filePath, mtimeMs: stats.mtimeMs, graph };
        return { graph, source: filePath };
      }
    } catch (error) {
      console.error(`[graph-streaming] Failed to load ${filePath}:`, error);
    }
  }

  console.warn(`[graph-streaming] No valid graph found for "${graphKey}"`);
  return null;
}

/**
 * Clear the graph cache (useful for hot-reloading)
 */
export function clearGraphCache(): void {
  Object.keys(graphCache).forEach(key => delete graphCache[key]);
}

// ============================================================================
// Progress Message Formatting
// ============================================================================

/**
 * Get a friendly progress message for a node type
 */
function getFriendlyNodeMessage(nodeType: string, nodeName: string): string {
  if (nodeType.includes('react_planner')) return 'Planning next action...';
  if (nodeType.includes('skill_executor')) return 'Executing skill...';
  if (nodeType.includes('scratchpad_updater')) return 'Updating scratchpad...';
  if (nodeType.includes('completion_checker')) return 'Checking completion...';
  if (nodeType.includes('conditional_router')) return 'Routing decision...';
  if (nodeType.includes('semantic_search')) return 'Searching memories...';
  if (nodeType.includes('response_synthesizer')) return 'Synthesizing response...';
  if (nodeType.includes('persona_llm')) return 'Generating response...';
  return nodeName;
}

// ============================================================================
// Streaming Graph Execution
// ============================================================================

/**
 * Execute a cognitive graph with streaming progress updates
 *
 * Returns a ReadableStream for SSE (Server-Sent Events) streaming.
 */
export function streamGraphExecution(params: GraphStreamingParams): Response {
  const {
    cognitiveMode,
    message,
    sessionId,
    userContext,
    conversationHistory,
    contextPackage,
    contextInfo,
    allowMemoryWrites,
    useOperator,
    yoloMode,
    timeoutMs = 300000,
  } = params;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const push = (type: string, data: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
        } catch (err) {
          console.error('[graph-streaming] Push error:', err);
          closed = true;
        }
      };

      try {
        // Load graph
        push('progress', { step: 'loading_graph', message: 'Loading cognitive workflow...' });
        const loaded = await loadGraphForMode(cognitiveMode);

        if (!loaded) {
          push('error', { message: 'Failed to load cognitive graph' });
          closed = true;
          try { controller.close(); } catch {}
          return;
        }

        push('progress', {
          step: 'graph_loaded',
          message: `Executing ${loaded.graph.name} (${loaded.graph.nodes.length} nodes)`,
        });

        // Build context
        const contextData = {
          sessionId,
          userMessage: message,
          cognitiveMode,
          userId: userContext?.userId || 'anonymous',
          username: userContext?.username,
          userRole: userContext?.role,
          user: userContext
            ? { id: userContext.userId, username: userContext.username, role: userContext.role }
            : undefined,
          conversationHistory,
          contextPackage,
          contextInfo,
          allowMemoryWrites,
          useOperator,
          yoloMode,
          timeoutMs,
        };

        const startedAt = Date.now();
        const executionEvents: any[] = [];
        let lastProgressTime = Date.now();
        let timedOut = false;
        let timeoutHandle: NodeJS.Timeout | null = null;

        // Event handler for graph execution
        const eventHandler = (event: any) => {
          executionEvents.push(event);

          // Check for cancellation
          const cancellationStatus = checkCancellation(sessionId);
          if (cancellationStatus.cancelled) {
            push('cancelled', {
              message: `Request cancelled: ${cancellationStatus.reason}`,
              reason: cancellationStatus.reason,
            });
            throw new Error('CANCELLATION_REQUESTED');
          }

          // Throttle progress updates (200ms)
          const now = Date.now();
          if (now - lastProgressTime > 200 || event.type === 'node_error' || event.type === 'graph_complete') {
            lastProgressTime = now;

            if (event.type === 'node_start') {
              const node = loaded.graph.nodes.find(n => n.id === event.nodeId);
              const nodeName = node?.title || node?.type || `Node ${event.nodeId}`;
              const nodeType = node?.type || '';

              push('progress', {
                step: 'node_executing',
                message: getFriendlyNodeMessage(nodeType, nodeName),
                nodeId: event.nodeId,
                nodeType,
              });
            } else if (event.type === 'node_error') {
              push('progress', {
                step: 'node_error',
                message: `Error in node ${event.nodeId}`,
                error: event.data?.error,
              });
            } else if (event.type === 'node_complete') {
              const node = loaded.graph.nodes.find(n => n.id === event.nodeId);
              const nodeType = node?.type || '';

              // Extract thoughts from react_planner
              if (nodeType.includes('react_planner') && event.data?.outputs) {
                const planText = typeof event.data.outputs === 'object'
                  ? event.data.outputs.plan
                  : event.data.outputs;

                if (planText && typeof planText === 'string') {
                  const thoughtMatch = planText.match(/Thought:\s*(.+?)(?=\nAction:|$)/is);
                  if (thoughtMatch) {
                    push('progress', {
                      step: 'thinking',
                      message: thoughtMatch[1].trim(),
                      nodeId: event.nodeId,
                      nodeType,
                    });
                  }
                }
              }
            }
          }
        };

        // Execute graph with user context
        const graphPromise = withUserContext(
          {
            userId: userContext?.userId || 'anonymous',
            username: userContext?.username || 'anonymous',
            role: (userContext?.role || 'anonymous') as any,
          },
          () => executeGraph(loaded.graph, contextData, eventHandler)
        );

        // Timeout handling
        const timeoutPromise = new Promise<null>(resolve => {
          timeoutHandle = setTimeout(() => {
            if (closed) {
              resolve(null);
              return;
            }
            timedOut = true;
            push('error', { message: `Graph execution timed out after ${timeoutMs}ms` });
            closed = true;
            try { controller.close(); } catch {}
            resolve(null);
          }, timeoutMs);
        });

        // Race execution vs timeout
        const raceResult = await Promise.race([
          graphPromise.then(() => 'completed' as const).catch(() => 'failed' as const),
          timeoutPromise.then(() => 'timeout' as const),
        ]);

        if (timeoutHandle) clearTimeout(timeoutHandle);

        if (timedOut || raceResult === 'timeout') {
          return;
        }

        // Get result
        let graphState: Awaited<ReturnType<typeof executeGraph>> | null = null;
        try {
          graphState = await graphPromise;
        } catch (error) {
          push('error', { message: (error as Error)?.message || 'Graph execution failed' });
          closed = true;
          try { controller.close(); } catch {}
          return;
        }

        if (!graphState) {
          push('error', { message: 'Graph execution returned no state' });
          closed = true;
          try { controller.close(); } catch {}
          return;
        }

        const duration = Date.now() - startedAt;
        const output = getGraphOutput(graphState);
        const responseText = output?.output || output?.response;

        if (!responseText) {
          push('error', { message: 'Graph executed but produced no response' });
          closed = true;
          try { controller.close(); } catch {}
          return;
        }

        push('progress', {
          step: 'graph_complete',
          message: `Graph completed in ${duration}ms`,
        });

        // Send final answer
        push('answer', {
          response: responseText,
          executionTime: duration,
          graphStatus: graphState.status,
        });

        // Allow client to receive data before closing
        await new Promise(resolve => setTimeout(resolve, 100));
        closed = true;
        try { controller.close(); } catch {}

      } catch (error) {
        if ((error as Error).message === 'CANCELLATION_REQUESTED') {
          console.log('[graph-streaming] Request cancelled');
        } else {
          push('error', { message: (error as Error).message });
        }
        closed = true;
        try { controller.close(); } catch {}
      } finally {
        clearCancellation(sessionId);
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
