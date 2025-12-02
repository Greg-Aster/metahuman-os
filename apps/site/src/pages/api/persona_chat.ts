import type { APIRoute } from 'astro';
// Core imports - only what's needed for graph pipeline
import {
  ROOT,
  audit,
  getPersonaContext,
  getActiveFacet,
  loadPersonaWithFacet,
  executeGraph,
  getGraphOutput,
  withUserContext,
  loadGraphForMode,
  checkCancellation,
  clearCancellation
} from '@metahuman/core';
import { loadCognitiveMode, canWriteMemory as modeAllowsMemoryWrites } from '@metahuman/core/cognitive-mode';
import { canWriteMemory as policyCanWriteMemory } from '@metahuman/core/memory-policy';
import { loadChatSettings } from '@metahuman/core/chat-settings';
import { getUserOrAnonymous, getProfilePaths } from '@metahuman/core';
import { readFileSync, existsSync, appendFileSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveNodePipelineFlag } from '../../utils/node-pipeline';
// Proactively import node executors to ensure they're loaded before graph execution
// This forces the registry to load all executors (including conditionalRerouteExecutor) at module init
import { nodeExecutors } from '@metahuman/core';

type Role = 'system' | 'user' | 'assistant';
type Mode = 'inner' | 'conversation';
type ConversationMessage = { role: Role; content: string; meta?: any; timestamp?: number };

// DISABLED: Skills not used by cognitive graph pipeline
// initializeSkills();

// Force node executor registry to load (imported for side effects)
void nodeExecutors;

// Pre-warm the graph executor by forcing the dynamic import to happen now
// BLOCKING version - ensures executors are loaded before handling any requests
let executorsReady = false;
const executorsReadyPromise = (async () => {
  const startTime = Date.now();
  try {
    const { getNodeExecutor } = await import('@metahuman/core/node-executors');
    // Test that executors are loaded
    if (getNodeExecutor('user_input')) {
      const loadTime = Date.now() - startTime;
      console.log(`[persona_chat] ✅ Node executors pre-warmed successfully in ${loadTime}ms`);
      executorsReady = true;
    }
  } catch (error) {
    console.error('[persona_chat] ⚠️ Failed to pre-warm node executors:', error);
    executorsReady = true; // Don't block forever on error
  }
})();

// Cancellation functions are now imported from @metahuman/core/graph-streaming
// Re-export for backward compatibility with other modules that import from here
export { requestCancellation, checkCancellation, clearCancellation } from '@metahuman/core';

/**
 * Retrieve curiosity question from audit logs
 * Questions are stored in audit logs until user replies
 */
async function retrieveCuriosityQuestion(questionId: string): Promise<{ questionText: string; curiosityData: any } | null> {
  try {
    const auditDir = path.join(ROOT, 'logs', 'audit');
    const today = new Date().toISOString().split('T')[0];
    const auditFile = path.join(auditDir, `${today}.ndjson`);

    if (!existsSync(auditFile)) {
      console.warn(`[retrieveCuriosityQuestion] Audit file not found: ${auditFile}`);
      return null;
    }

    const auditContent = readFileSync(auditFile, 'utf-8');
    const lines = auditContent.split('\n').filter(Boolean);

    // Search backwards (most recent first) for the question
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (
          entry.actor === 'curiosity-service' &&
          entry.event === 'chat_assistant' &&
          entry.details?.curiosityQuestionId === questionId &&
          entry.details?.curiosityData
        ) {
          return {
            questionText: entry.details.curiosityData.questionText,
            curiosityData: entry.details.curiosityData
          };
        }
      } catch {
        // Skip malformed lines
      }
    }

    console.warn(`[retrieveCuriosityQuestion] Question not found: ${questionId}`);
    return null;
  } catch (error) {
    console.error(`[retrieveCuriosityQuestion] Error:`, error);
    return null;
  }
}

// In-memory message histories per session
// NOTE: These are automatically pruned to stay within token limits (max 80 messages / ~32k tokens)
// Extended for qwen3:14b's 40k context window - triggers summarization at 64 messages (80% capacity)
// Key format: "${mode}:${sessionId}" for complete session isolation
const histories: Map<string, ConversationMessage[]> = new Map();

// Track username per session for buffer persistence (replaces deprecated getUserContext)
// Key format: "${mode}:${sessionId}" → username
// DELETED: sessionUsernames, sessionUsingGraph, and related functions - BufferManager handles ALL persistence

function getHistoryKey(mode: Mode, sessionId: string): string {
  return `${mode}:${sessionId}`;
}

function getHistory(mode: Mode, sessionId: string): ConversationMessage[] {
  const key = getHistoryKey(mode, sessionId);
  if (!histories.has(key)) {
    histories.set(key, []);
  }
  return histories.get(key)!;
}

// Graph loading and caching is now handled by @metahuman/core/graph-streaming
// loadGraphForMode is imported from @metahuman/core

function getConversationHistorySnapshot(mode: Mode, sessionId: string): Array<{ role: Role; content: string; meta?: any; timestamp?: number }> {
  const history = getHistory(mode, sessionId);
  return history.map(entry => ({
    role: entry.role,
    content: entry.content,
    meta: entry.meta,
    timestamp: entry.meta?.timestamp,
  }));
}

/**
 * Stream graph execution with real-time progress updates
 */
function streamGraphExecutionWithProgress(params: GraphPipelineParams) {
  console.log('[streamGraphExecutionWithProgress] ============ FUNCTION CALLED ============');
  console.log('[streamGraphExecutionWithProgress] mode:', params.mode);
  console.log('[streamGraphExecutionWithProgress] message:', params.message?.substring(0, 50));
  console.log('[streamGraphExecutionWithProgress] cognitiveMode:', params.cognitiveMode);

  const { mode, message, sessionId } = params;

  const stream = new ReadableStream({
    async start(controller) {
      console.log('[streamGraphExecutionWithProgress] Stream start() called');
      const encoder = new TextEncoder();
      let closed = false;
      const push = (type: string, data: any) => {
        if (closed) return;
        try {
          console.log(`[streamGraphExecutionWithProgress] Pushing event: ${type}`, data);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
        } catch (err) {
          console.error('[streamGraphExecutionWithProgress] Error pushing event:', err);
          closed = true;
        }
      };

      try {
        console.log('[streamGraphExecutionWithProgress] Starting graph execution...');
        const { cognitiveMode, userContext, conversationHistory, contextPackage, contextInfo, allowMemoryWrites, useOperator, yoloMode } = params;
        const graphKey = cognitiveMode || mode;
        const timeoutMs = 300000; // 5 minutes - very long timeout, user can interrupt manually

        // Load graph
        push('progress', { step: 'loading_graph', message: 'Loading cognitive workflow...' });
        const loaded = await loadGraphForMode(graphKey);
        if (!loaded) {
          push('error', { message: 'Failed to load cognitive graph' });
          if (!closed) {
            closed = true;
            try { controller.close(); } catch {}
          }
          return;
        }

        push('progress', { step: 'graph_loaded', message: `Executing ${loaded.graph.name} (${loaded.graph.nodes.length} nodes)` });

        // Create emitProgress function that forwards to SSE stream
        // This allows node executors (especially LLM nodes) to emit model loading status
        const emitProgress = (event: { type: string; message: string; model?: string; currentModel?: string; elapsedMs?: number }) => {
          if (closed) return;
          const emoji = event.type === 'model_loading' ? '⏳' :
                       event.type === 'model_waiting' ? '⏱️' :
                       event.type === 'model_switch' ? '🔄' :
                       event.type === 'model_ready' ? '✅' : '📡';
          push('progress', {
            step: event.type,
            message: `${emoji} ${event.message}`,
            model: event.model,
            currentModel: event.currentModel,
            elapsedMs: event.elapsedMs,
          });
        };

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
          emitProgress, // Inject progress emitter for model loading notifications
        };

        const startedAt = Date.now();
        const executionEvents: any[] = [];
        let lastProgressTime = Date.now();
        let timedOut = false;
        let timeoutHandle: NodeJS.Timeout | null = null;

        const eventHandler = (event: any) => {
          executionEvents.push(event);

          // Check for cancellation on every event
          const cancellationStatus = checkCancellation(sessionId);
          if (cancellationStatus.cancelled) {
            console.warn(`[streamGraphExecutionWithProgress] Cancellation detected: ${cancellationStatus.reason}`);
            push('cancelled', {
              message: `⏸️ Request cancelled: ${cancellationStatus.reason}`,
              reason: cancellationStatus.reason
            });
            throw new Error('CANCELLATION_REQUESTED');
          }

          const now = Date.now();
          if (now - lastProgressTime > 200 || event.type === 'node_error' || event.type === 'graph_complete') {
            lastProgressTime = now;

            if (event.type === 'node_start') {
              const node = loaded.graph.nodes.find(n => n.id === event.nodeId);
              const nodeName = node?.title || node?.type || `Node ${event.nodeId}`;
              const nodeType = node?.type || '';

              let friendlyMessage = nodeName;
              if (nodeType.includes('react_planner')) {
                friendlyMessage = '🧠 Planning next action...';
              } else if (nodeType.includes('skill_executor')) {
                friendlyMessage = '⚙️ Executing skill...';
              } else if (nodeType.includes('scratchpad_updater')) {
                friendlyMessage = '📝 Updating scratchpad...';
              } else if (nodeType.includes('completion_checker')) {
                friendlyMessage = '✓ Checking completion...';
              } else if (nodeType.includes('conditional_router')) {
                friendlyMessage = '🔀 Routing decision...';
              } else if (nodeType.includes('semantic_search')) {
                friendlyMessage = '🔍 Searching memories...';
              } else if (nodeType.includes('response_synthesizer')) {
                friendlyMessage = '✍️ Synthesizing response...';
              } else if (nodeType.includes('persona_llm')) {
                friendlyMessage = '💭 Generating response...';
              }

              push('progress', {
                step: 'node_executing',
                message: friendlyMessage,
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

              // Extract and show actual thoughts from react_planner
              if (nodeType.includes('react_planner') && event.data?.outputs) {
                const outputs = event.data.outputs;
                const planText = typeof outputs === 'object' ? outputs.plan : outputs;

                if (planText && typeof planText === 'string') {
                  // Extract the thought portion
                  const thoughtMatch = planText.match(/Thought:\s*(.+?)(?=\nAction:|$)/is);
                  if (thoughtMatch) {
                    const thought = thoughtMatch[1].trim();
                    push('progress', {
                      step: 'thinking',
                      message: `💭 ${thought}`,
                      nodeId: event.nodeId,
                      nodeType,
                    });
                  }
                }
              }
            }
          }
        };

        // CRITICAL FIX: Wrap executeGraph in withUserContext to ensure AsyncLocalStorage context
        // persists throughout the entire graph execution (skills need this for getSecurityPolicy())
        console.log('[streamGraphExecutionWithProgress] Setting user context:', {
          userId: userContext?.userId,
          username: userContext?.username,
          role: userContext?.role,
        });

        const graphPromise = withUserContext(
          {
            userId: userContext?.userId || 'anonymous',
            username: userContext?.username || 'anonymous',
            role: (userContext?.role || 'anonymous') as any,
          },
          async () => {
            // Verify context is set inside the async scope
            const { getUserContext } = await import('@metahuman/core');
            const ctx = getUserContext();
            console.log('[streamGraphExecutionWithProgress] Context inside withUserContext:', {
              hasContext: !!ctx,
              username: ctx?.username,
              role: ctx?.role,
            });

            return executeGraph(loaded.graph, contextData, eventHandler);
          }
        );

        const timeoutPromise = new Promise<null>(resolve => {
          timeoutHandle = setTimeout(() => {
            if (closed) {
              resolve(null);
              return;
            }
            timedOut = true;
            console.warn(`[streamGraphExecutionWithProgress] Timeout after ${timeoutMs}ms`);
            push('error', { message: `Graph execution timed out after ${timeoutMs}ms`, events: executionEvents.slice(-10) });
            closed = true;
            try {
              controller.close();
            } catch {}
            resolve(null);
          }, timeoutMs);
        });

        const raceResult = await Promise.race([
          graphPromise.then(() => 'completed' as const).catch(() => 'failed' as const),
          timeoutPromise.then(() => 'timeout' as const),
        ]);

        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }

        if (timedOut || raceResult === 'timeout') {
          console.log('[streamGraphExecutionWithProgress] Graph was timed out; skipping late results');
          return;
        }

        let graphState: Awaited<ReturnType<typeof executeGraph>> | null = null;
        try {
          graphState = await graphPromise;
        } catch (error) {
          console.error('[streamGraphExecutionWithProgress] Graph execution failed:', error);
          push('error', { message: (error as Error)?.message || 'Graph execution failed' });
          if (!closed) {
            closed = true;
            try { controller.close(); } catch {}
          }
          return;
        }

        if (!graphState) {
          console.error('[streamGraphExecutionWithProgress] Graph execution returned no state; aborting response');
          push('error', { message: 'Graph execution returned no state' });
          if (!closed) {
            closed = true;
            try { controller.close(); } catch {}
          }
          return;
        }

        const duration = Date.now() - startedAt;

        // Log trace
        try {
          const traceLogPath = path.join(ROOT, 'logs', 'graph-traces.ndjson');
          const traceEntry = JSON.stringify({
            timestamp: new Date().toISOString(),
            mode: graphKey,
            graph: loaded.source,
            sessionId,
            status: graphState.status,
            durationMs: duration,
            eventCount: executionEvents.length,
            events: executionEvents.slice(-50),
          });
          appendFileSync(traceLogPath, traceEntry + '\n', 'utf-8');
        } catch {}

        const output = getGraphOutput(graphState);
        const responseText = output?.output || output?.response;

        if (!responseText) {
          push('error', { message: 'Graph executed but produced no response' });
          if (!closed) {
            closed = true;
            try { controller.close(); } catch {}
          }
          return;
        }

        push('progress', {
          step: 'graph_complete',
          message: `Graph completed in ${duration}ms`,
          events: executionEvents.slice(-10),
        });

        // Send final answer
        const facet = getActiveFacet();
        push('answer', { response: responseText, facet, saved: null, executionTime: duration });

        // Update history (pass push as stream notifier for summarization status)
        pushMessage(mode, { role: 'user', content: message }, sessionId, push);
        pushMessage(mode, { role: 'assistant', content: responseText, meta: { facet, graphPipeline: true } }, sessionId, push);
        lastAssistantReplies[mode].push(responseText);

        // Close stream
        await new Promise(resolve => setTimeout(resolve, 100));
        if (!closed) {
          closed = true;
          try { controller.close(); } catch {}
        }

      } catch (error) {
        console.error('[streamGraphExecutionWithProgress] Error:', error);

        // Handle cancellation specially
        if ((error as Error).message === 'CANCELLATION_REQUESTED') {
          // Already sent cancelled event, just close gracefully
          console.log('[streamGraphExecutionWithProgress] Request was cancelled by user');
        } else {
          push('error', { message: (error as Error).message });
        }

        if (!closed) {
          closed = true;
          try { controller.close(); } catch {}
        }
      } finally {
        // Clean up cancellation tracking
        clearCancellation(sessionId);
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

function streamGraphAnswer(mode: Mode, message: string, sessionId: string, response: string) {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const push = (type: string, data: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
        } catch {
          closed = true;
        }
      };

      const facet = getActiveFacet();

      push('answer', { response, facet, saved: null });

      // Update history (pass push as stream notifier for summarization status)
      pushMessage(mode, { role: 'user', content: message }, sessionId, push);
      pushMessage(mode, { role: 'assistant', content: response, meta: { facet, graphPipeline: true } }, sessionId, push);
      lastAssistantReplies[mode].push(response);

      // Close stream asynchronously to ensure client receives the data
      await new Promise(resolve => setTimeout(resolve, 100));

      closed = true;
      try {
        controller.close();
      } catch {}
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

interface GraphPipelineResult {
  response: string;
  rawOutput: any;
  graphSource: string;
}

interface GraphPipelineParams {
  mode: Mode;
  message: string;
  sessionId: string;
  cognitiveMode: string;
  userContext: { userId: string; username: string; role: string };
  conversationHistory: Array<{ role: Role; content: string; meta?: any; timestamp?: number }>;
  contextPackage: any;
  contextInfo: string;
  allowMemoryWrites: boolean;
  useOperator: boolean;
  yoloMode: boolean;
}

async function tryExecuteGraphPipeline(params: GraphPipelineParams): Promise<GraphPipelineResult | null> {
  const { mode, message, sessionId, cognitiveMode, userContext, conversationHistory, contextPackage, contextInfo, allowMemoryWrites, useOperator, yoloMode } = params;

  try {
    const graphKey = cognitiveMode || mode;
    const loaded = await loadGraphForMode(graphKey);
    if (!loaded) {
      return null;
    }

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
    };

    const startedAt = Date.now();
    const executionEvents: any[] = [];
    const graphState = await executeGraph(loaded.graph, contextData, event => {
      executionEvents.push(event);
      if (event.type === 'node_error') {
        console.warn(`[GraphPipeline] Node ${event.nodeId} error: ${event.data?.error}`);
      }
    });
    const duration = Date.now() - startedAt;

    console.log(`[GraphPipeline] Executed ${path.basename(loaded.source)} in ${duration}ms (${graphState.status}) for ${graphKey}`);
    try {
      const traceLogPath = path.join(ROOT, 'logs', 'graph-traces.ndjson');
      const traceEntry = JSON.stringify({
        timestamp: new Date().toISOString(),
        mode: graphKey,
        graph: loaded.source,
        sessionId,
        status: graphState.status,
        durationMs: duration,
        eventCount: executionEvents.length,
        events: executionEvents.slice(-50), // cap size
      });
      appendFileSync(traceLogPath, traceEntry + '\n', 'utf-8');
    } catch (error) {
      console.warn('[persona_chat] Failed to log graph trace:', error);
    }

    const output = getGraphOutput(graphState);
    const responseText = output?.output || output?.response;
    if (!responseText) {
      console.warn('[persona_chat] Graph executed but produced no response');
      return null;
    }

    return {
      response: responseText,
      rawOutput: output,
      graphSource: loaded.source,
    };
  } catch (error) {
    const graphKey = cognitiveMode || mode;
    console.error('[persona_chat] Graph pipeline execution failed:', error);
    audit({
      level: 'warn',
      category: 'system',
      event: 'graph_pipeline_failure',
      details: {
        mode: graphKey,
        message: message.substring(0, 160),
        error: (error as Error).message,
      },
      actor: userContext?.userId || 'anonymous',
    });
    try {
      const traceLogPath = path.join(ROOT, 'logs', 'graph-traces.ndjson');
      const traceEntry = JSON.stringify({
        timestamp: new Date().toISOString(),
        mode: graphKey,
        graph: 'error',
        sessionId,
        status: 'failed',
        error: (error as Error).message,
      });
      appendFileSync(traceLogPath, traceEntry + '\n', 'utf-8');
    } catch (traceError) {
      console.warn('[persona_chat] Failed to log graph failure trace:', traceError);
    }
    return null;
  }
}

// Track which sessions have had their history loaded from disk
// Key format: "${mode}:${sessionId}"
const historyLoadedForSession: Set<string> = new Set();

const bufferMeta: Record<Mode, { lastSummarizedIndex: number | null }> = {
  inner: { lastSummarizedIndex: null },
  conversation: { lastSummarizedIndex: null }
};

function metadataScore(message: ConversationMessage): number {
  const metaKeys = message.meta && typeof message.meta === 'object'
    ? Object.keys(message.meta).length
    : 0;
  const hasTimestamp = typeof message.timestamp === 'number' ? 1 : 0;
  return metaKeys * 2 + hasTimestamp;
}

function dedupeConversationMessages(
  messages: ConversationMessage[]
): { deduped: ConversationMessage[]; removed: number } {
  const deduped: ConversationMessage[] = [];
  let removed = 0;

  for (const msg of messages) {
    const last = deduped[deduped.length - 1];
    if (
      last &&
      last.role === msg.role &&
      last.content === msg.content
    ) {
      removed++;
      if (metadataScore(msg) > metadataScore(last)) {
        deduped[deduped.length - 1] = msg;
      }
      continue;
    }

    deduped.push(msg);
  }

  return { deduped, removed };
}

function getBufferPath(mode: Mode, username: string): string | null {
  try {
    const profilePaths = getProfilePaths(username);
    return path.join(profilePaths.state, `conversation-buffer-${mode}.json`);
  } catch (error) {
    console.warn('[persona_chat] Failed to determine buffer path:', error);
    return null;
  }
}


function upsertSummaryMarker(
  mode: Mode,
  summary: { sessionId: string; summary: string; messageCount: number }
): void {
  if (!summary.summary) return;

  const rangeEnd = Math.max(summary.messageCount - 1, 0);
  const createdAt = new Date().toISOString();
  const marker = {
    role: 'system' as Role,
    content: [
      '## Context Summary (read-only)',
      `Messages covered: 0-${rangeEnd}`,
      '',
      summary.summary,
      '',
      '_Use this summary only for background. Always prioritize the most recent user messages when responding._'
    ].join('\n'),
    meta: {
      summaryMarker: true,
      sessionId: summary.sessionId,
      createdAt,
      range: { start: 0, end: rangeEnd },
      summaryCount: summary.messageCount
    }
  };

  const history = getHistory(mode, summary.sessionId);
  const filtered = history.filter(
    (msg: ConversationMessage) => !(msg.meta?.summaryMarker && msg.meta.sessionId === summary.sessionId)
  );
  history.length = 0;
  history.push(...filtered);

  const insertionIndex =
    history.length > 0 &&
    history[0].role === 'system' &&
    !history[0].meta?.summaryMarker
      ? 1
      : 0;

  history.splice(insertionIndex, 0, marker);
  bufferMeta[mode].lastSummarizedIndex = summary.messageCount;
  // DELETED: persistBuffer call - BufferManager handles this
}

/**
 * Push message to in-memory history for context continuity
 * BufferManager node handles disk persistence, but we need in-memory updates
 * for getConversationHistorySnapshot() to return current context
 */
function pushMessage(
  mode: Mode,
  message: ConversationMessage,
  sessionId: string,
  _streamNotifier?: (type: string, data: any) => void
): void {
  const history = getHistory(mode, sessionId);
  history.push(message);

  // Prune to max 80 messages to prevent memory bloat
  const MAX_HISTORY = 80;
  if (history.length > MAX_HISTORY) {
    // Keep system prompt (first message) and last MAX_HISTORY-1 messages
    const systemPrompt = history[0]?.role === 'system' ? history.shift() : null;
    const recentMessages = history.slice(-(MAX_HISTORY - (systemPrompt ? 1 : 0)));
    history.length = 0;
    if (systemPrompt) history.push(systemPrompt);
    history.push(...recentMessages);
  }
}

// Dedup and retry guards
const lastUserTurn: Record<Mode, { text: string; ts: number } | null> = { inner: null, conversation: null };
const lastAssistantReplies: Record<Mode, string[]> = { inner: [], conversation: [] };
// Track recently used memory IDs to avoid repeating the same snippets turn after turn
const recentMemoryIds: Record<Mode, string[]> = { inner: [], conversation: [] };

/**
 * Build the system prompt with current persona/facet
 */
function buildSystemPrompt(mode: Mode, includePersonaSummary = true): string {
  let systemPrompt = '';
  if (includePersonaSummary) {
    try {
      const persona = loadPersonaWithFacet();

      // Phase 5: Add persona cache context (long-term themes and facts)
      const personaCache = getPersonaContext();

      const communicationStyle = persona.personality?.communicationStyle ?? {};
      const tone = communicationStyle.tone;
      const toneText = Array.isArray(tone) ? tone.join(', ') : tone || 'adaptive';

      const values = Array.isArray(persona.values?.core)
        ? persona.values.core.map((v: any) => v.value || v).filter(Boolean)
        : [];

      systemPrompt = `
You are ${persona.identity.name}, an autonomous digital personality extension.
Your role is: ${persona.identity.role}.
Your purpose is: ${persona.identity.purpose}.

Your personality is defined by these traits:
- Communication Style: ${toneText}.
- Values: ${values.join(', ') || 'Not specified'}.

${personaCache ? `Long-term context:\n${personaCache}\n` : ''}
You are having a ${mode}.
      `.trim();
    } catch (error) {
      console.warn('[persona_chat] Failed to load persona; using generic system prompt', (error as Error).message);
      systemPrompt = '';
    }
  } else {
    systemPrompt = mode === 'inner'
      ? 'You are having an internal dialogue with yourself.'
      : 'You are having a conversation.';
  }

  // Fallback for anonymous/unauthenticated sessions where persona cannot be loaded
  if (!systemPrompt) {
    systemPrompt = mode === 'inner'
      ? 'You are having an internal dialogue with yourself.'
      : 'You are having a conversation.';
  }
  return systemPrompt;
}

function initializeChat(mode: Mode, sessionId: string, reason = false, usingLora = false, includePersonaSummary = true): void {
  const systemPrompt = buildSystemPrompt(mode, includePersonaSummary);
  const history = getHistory(mode, sessionId);
  history.length = 0; // Clear existing
  history.push({ role: 'system', content: systemPrompt });
  bufferMeta[mode].lastSummarizedIndex = null;
  // DELETED: persistBuffer call - BufferManager handles this
}

// GET handler - no middleware bullshit, simple and explicit
export const GET: APIRoute = async ({ request, cookies }) => {
  // Wait for node executors to be pre-warmed (prevents 50-second first request delay)
  if (!executorsReady) {
    console.log('[persona_chat] Waiting for executors to finish loading...');
    await executorsReadyPromise;
  }

  console.log('========================================');
  console.log('[persona_chat] GET HANDLER ENTERED');
  console.log('[persona_chat] Request URL:', request.url);
  try {
    const dbg = new URL(request.url);
    console.log('[persona_chat] Query params:', dbg.searchParams.toString());
  } catch (err) {
    console.warn('[persona_chat] Failed to parse request URL for logging', err);
  }
  console.log('========================================');

  // Simple, explicit auth - no middleware magic
  const user = getUserOrAnonymous(cookies);
  const userPaths = user.role !== 'anonymous' ? getProfilePaths(user.username) : null;


  const url = new URL(request.url);
  const message = url.searchParams.get('message') || '';
  console.log('[persona_chat GET] Message:', message.substring(0, 100));

  const mode = url.searchParams.get('mode') || 'inner';
  const newSession = url.searchParams.get('newSession') === 'true';
  const questionId = url.searchParams.get('questionId') || undefined;
  const audience = url.searchParams.get('audience') || undefined;
  const length = url.searchParams.get('length') || 'auto';
  const reason = url.searchParams.get('reason') === 'true';
  const graphParam = url.searchParams.get('graph');
  const graphOverride = graphParam === 'true' ? true : graphParam === 'false' ? false : undefined;
  const depthParam = url.searchParams.get('reasoningDepth') || url.searchParams.get('reasonDepth');
  let reasoningDepth = Number(depthParam);
  if (!Number.isFinite(reasoningDepth)) {
    reasoningDepth = reason ? 1 : 0;
  }
  reasoningDepth = Math.max(0, Math.min(3, Math.round(reasoningDepth)));
  const llmRaw = url.searchParams.get('llm');
  const forceOperator = url.searchParams.get('forceOperator') === 'true' || url.searchParams.get('operator') === 'true';
  const yolo = url.searchParams.get('yolo') === 'true';
  const replyToQuestionId = url.searchParams.get('replyToQuestionId') || undefined;
  const replyToContent = url.searchParams.get('replyToContent') || undefined;
  // Extract conversation session ID for memory continuity
  let sessionId = url.searchParams.get('sessionId') || url.searchParams.get('conversationId') || '';
  if (!sessionId) {
    // Generate session ID if not provided
    sessionId = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  let llm = {};
  if (llmRaw) {
    try {
      llm = JSON.parse(llmRaw);
    } catch (e) {
      console.error('Failed to parse "llm" query param:', e);
      llm = {};
    }
  }

  // MIGRATED: 2025-11-20 - Removed withUserContext wrapper
  // handleChatRequest receives cookies and can do its own authentication
  return handleChatRequest({ message, mode, newSession, audience, length, reason, reasoningDepth, llm, forceOperator, yolo, sessionId, replyToQuestionId, replyToContent, origin: url.origin, cookies, graphPipelineOverride: graphOverride });
};

// MIGRATED: 2025-11-20 - Explicit authentication pattern
// Removed withUserContext wrapper - handleChatRequest does explicit authentication internally
export const POST: APIRoute = async ({ request, cookies }) => {
  console.log('========================================');
  console.log('[persona_chat] POST HANDLER ENTERED');
  console.log('[persona_chat] Request URL:', request.url);
  console.log('========================================');

  // Simple, explicit auth
  const user = getUserOrAnonymous(cookies);

  try {
    const url = new URL(request.url);
    const body = await request.json();
    console.log('[persona_chat] Request body keys:', Object.keys(body));
    console.log('[persona_chat] Message:', body.message?.substring(0, 50));

    const graphParam = typeof body?.graphPipelineOverride === 'boolean' ? body.graphPipelineOverride : undefined;

    // handleChatRequest does its own authentication (no withUserContext wrapper)
    return await handleChatRequest({ ...body, origin: url.origin, cookies, graphPipelineOverride: graphParam });
  } catch (error) {
    console.error('[persona_chat] POST handler error:', error);
    return new Response(JSON.stringify({ error: 'Request handler failed: ' + (error as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

async function handleChatRequest({ message, mode = 'inner', newSession = false, audience, length, reason, reasoningDepth, llm, forceOperator = false, yolo = false, sessionId, replyToQuestionId, replyToContent, origin, cookies, graphPipelineOverride }: { message: string; mode?: string; newSession?: boolean; audience?: string; length?: string; reason?: boolean; reasoningDepth?: number; llm?: any; forceOperator?: boolean; yolo?: boolean; sessionId?: string; replyToQuestionId?: string; replyToContent?: string; origin?: string; cookies?: any; graphPipelineOverride?: boolean }) {
  console.log(`\n[CHAT_REQUEST] Received: "${message}"`);

  // Get user ID from cookies (no middleware)
  const user = getUserOrAnonymous(cookies);
  const userId = user.id;
  const username = user.username || 'anonymous';

  const m: Mode = mode === 'conversation' ? 'conversation' : 'inner';
  sessionId = sessionId || `conv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  // DELETED:   ensureHistoryLoaded(m, sessionId, username);

  // Reasoning depth settings
  const depthCandidate = Number(reasoningDepth);
  let depthLevel = Number.isFinite(depthCandidate) ? Math.max(0, Math.min(3, Math.round(depthCandidate))) : undefined;
  if (depthLevel === undefined) {
    depthLevel = reason ? 1 : 0;
  }
  const reasoningRequested = depthLevel > 0;

  // Authentication and cognitive mode setup
  let sessionCookie, isAuthenticated, userRole, operatorRoleAllowed, cognitiveMode, allowMemoryWrites;

  try {
    sessionCookie = cookies?.get('mh_session');
    isAuthenticated = !!sessionCookie;

    // Resolve user context up front so downstream routing can respect role-based restrictions
    // (No middleware - user already resolved at top of function)
    userRole = user.role;
    // Allow operator ONLY for the profile owner
    // Guests and anonymous users get chat-only mode (no skill execution)
    operatorRoleAllowed = userRole === 'owner';

    // Load cognitive mode context once for consistent routing and memory policies
    // For unauthenticated users, force emulation mode (read-only, safe for guests)
    const cognitiveConfig = loadCognitiveMode();
    const loadedMode = cognitiveConfig.currentMode;
    cognitiveMode = isAuthenticated ? loadedMode : 'emulation';
    allowMemoryWrites = isAuthenticated ? modeAllowsMemoryWrites(loadedMode) : false;

    console.log(`[CHAT_REQUEST] ✅ Graph-only mode - model resolution handled by model_resolver node`);
  } catch (error) {
    console.error('[persona_chat] Fatal: Failed to initialize chat context:', error);
    return new Response(JSON.stringify({ error: 'Failed to initialize chat context: ' + (error as Error).message }), { status: 500 });
  }
  const trimmedMessage = String(message ?? '').trim();
  const history = getHistory(m, sessionId);
  const recentDialogue = history
    .filter((turn: ConversationMessage) => turn.role !== 'system')
    .slice(-8)
    .map((turn: ConversationMessage) => {
      if (turn.role === 'assistant') return `Assistant: ${turn.content}`;
      if (turn.role === 'user') return `User: ${turn.content}`;
      return '';
    })
    .filter(Boolean)
    .join('\n');
  const routingContext = trimmedMessage
    ? [recentDialogue, `User: ${trimmedMessage}`].filter(Boolean).join('\n')
    : recentDialogue;

  // UNIFIED REASONING: Only use ReAct operator when user + mode permit it
  // Emulation mode users or restricted roles (guest/anonymous) get chat-only
  const useOperator = isAuthenticated && cognitiveMode !== 'emulation' && operatorRoleAllowed;

  console.log(`[CHAT_REQUEST] Cognitive Mode: ${cognitiveMode}`);
  console.log(`[CHAT_REQUEST] Authenticated: ${isAuthenticated}`);
  console.log(`[CHAT_REQUEST] Routing decision: ${useOperator ? 'REACT_OPERATOR (unified)' : 'CHAT_ONLY (emulation)'}`);

  // Determine if graph pipeline should be used
  const graphEnabled = graphPipelineOverride !== undefined ? graphPipelineOverride : resolveNodePipelineFlag();
  console.log(`[CHAT_REQUEST] graphEnabled=${graphEnabled} (override=${graphPipelineOverride})`);

  // Build reply-to context BEFORE retrieving memories
  // This ensures the LLM knows what the user is responding to
  let replyToMessage: string | undefined = undefined;
  let curiosityData: any = null; // Store full curiosity metadata for later

  // Priority 1: Curiosity question (fetch from audit logs)
  if (replyToQuestionId) {
    const questionData = await retrieveCuriosityQuestion(replyToQuestionId);
    if (questionData) {
      replyToMessage = questionData.questionText;
      curiosityData = questionData.curiosityData; // Save for capture later
      console.log(`[CHAT_REQUEST] Replying to curiosity question: "${replyToMessage.substring(0, 100)}..."`);
    } else {
      console.warn(`[CHAT_REQUEST] Could not retrieve curiosity question: ${replyToQuestionId}`);
    }
  }

  // Priority 2: Regular message (from selected message in UI)
  if (!replyToMessage && replyToContent) {
    replyToMessage = replyToContent;
    console.log(`[CHAT_REQUEST] Replying to selected message: "${replyToMessage.substring(0, 100)}..."`);
  }

  // ============================================================================
  // CONTEXT RETRIEVAL
  // ============================================================================
  // IMPORTANT: Graph pipeline (graphEnabled=true) handles semantic search internally
  // via the semantic_search node with proper timeout protection.
  // Context variables (populated by graph nodes, not handler)
  const contextInfo = '';
  const usedSemantic = false;
  const contextPackage: any = {};

  console.log(`[CHAT_REQUEST] ✅ Graph-only mode - semantic search handled by graph nodes`);

  // currentCtx resolved earlier for routing and logging

  // Phase 5: Memory Miss Detection - Log when no memories found for non-trivial queries
  if (contextPackage && contextPackage.memoryCount === 0 && message.length > 20) {
    const missLogPath = path.join(ROOT, 'logs', 'memory-misses.ndjson');

    try {
      const missEntry = JSON.stringify({
        timestamp: new Date().toISOString(),
        query: message.substring(0, 200),
        mode: cognitiveMode,
        indexStatus: contextPackage.indexStatus || 'unknown',
        username: user.username,
        sessionId: sessionId || 'unknown'
      });

      appendFileSync(missLogPath, missEntry + '\n', 'utf-8');
    } catch (error) {
      console.warn('[persona_chat] Failed to log memory miss:', error);
    }
  }

  // Log when operator is blocked due to lack of authentication
  if (!isAuthenticated) {
    console.log('[CHAT_REQUEST] Operator blocked - user not authenticated (emulation mode)');

    // Add a system message to inform the user about limited capabilities
    const authWarning = `_Note: I'm currently in **Emulation Mode** (read-only) because you're not authenticated. Some features like file operations, task management, and code execution require authentication. [Learn more about modes](/user-guide) or contact the owner for access._`;

    history.push({
      role: 'system',
      content: authWarning
    });
  }

  // ============================================================================
  // REMOVED: Legacy operator early-return block (2025-11-20)
  // All modes now attempt graph pipeline first (see line 1634+)
  // Legacy operator code preserved in git history for reference only
  // ============================================================================

  // Proceed with graph pipeline or chat-only flow (below)
  console.log(`[${new Date().toISOString()}] handleChatRequest: mode=${m}, history length=${history.length}, sessionId=${sessionId}`);
  console.log(JSON.stringify(history, null, 2));

  if (newSession || history.length === 0) {
    initializeChat(m, sessionId, reasoningRequested);
    if (!message) {
      return new Response(JSON.stringify({ response: 'Chat session initialized.' }), { status: 200 });
    }
  }

  if (!message) {
    return new Response(JSON.stringify({ error: 'Message is required' }), { status: 400 });
  }

  // Debounce duplicate user messages within a short window
  const nowTs = Date.now();
  const lastU = lastUserTurn[m];
  if (lastU && lastU.text === trimmedMessage && (nowTs - lastU.ts) < 1500) {
    const lastA = (lastAssistantReplies[m][lastAssistantReplies[m].length - 1]) || '';
    return new Response(JSON.stringify({ response: lastA, duplicate: true }), { status: 200 });
  }
  lastUserTurn[m] = { text: trimmedMessage, ts: nowTs };

  const conversationHistorySnapshot = getConversationHistorySnapshot(m, sessionId);

  // ============================================================================
  // PRIORITY 1: Try graph-based node pipeline (for all modes when enabled)
  // ============================================================================
  console.log(`[persona_chat] graphEnabled=${graphEnabled}, cognitiveMode=${cognitiveMode}, useOperator=${useOperator}`);

  if (graphEnabled) {
    console.log(`[persona_chat] 🔄 Attempting graph pipeline for mode: ${cognitiveMode}`);

    // Mark session as using graph mode (prevents legacy persistBuffer from overwriting BufferManager's data)
    // DELETED: markSessionUsingGraph - all sessions use graph mode now

    // Use streaming version that shows real-time progress
    const streamResult = streamGraphExecutionWithProgress({
      mode: m,
      message,
      sessionId,
      cognitiveMode,
      userContext: { userId: user.id, username: user.username, role: user.role },
      conversationHistory: conversationHistorySnapshot,
      contextPackage,
      contextInfo,
      allowMemoryWrites,
      useOperator,
      yoloMode: yolo,
    });

    return streamResult;
  }

  // Legacy fallback removed (2025-11-29) - Graph pipeline is now required
  // If you see this error, ensure etc/runtime.json has cognitive.useNodePipeline: true
  console.error('[persona_chat] ERROR: Graph pipeline disabled but legacy fallback has been removed');
  audit({
    level: 'error',
    category: 'system',
    event: 'legacy_fallback_removed',
    details: { cognitiveMode, message: 'Graph pipeline is required' },
    actor: 'system'
  });
  return new Response(JSON.stringify({
    error: 'Graph pipeline is required. Please enable it in etc/runtime.json (cognitive.useNodePipeline: true)'
  }), { status: 500 });
};
