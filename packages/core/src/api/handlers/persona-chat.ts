/**
 * Persona Chat Handler - UNIFIED
 *
 * Full cognitive graph pipeline for chat - SAME CODE for web and mobile.
 * Supports SSE streaming with real-time progress updates.
 *
 * This replaces the stopgap /api/chat handler with the full cognitive system.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { streamResponse, badRequestResponse } from '../types.js';
import {
  getPersonaContext,
  getActiveFacet,
  loadPersonaWithFacet,
  executeGraph,
  getGraphOutput,
  withUserContext,
  loadGraphForMode,
  checkCancellation,
  clearCancellation,
} from '../../index.js';
import { loadCognitiveMode, canWriteMemory as modeAllowsMemoryWrites } from '../../cognitive-mode.js';
import { scheduler } from '../../agent-scheduler.js';
import { isActiveOperatorEnabled } from '../../active-operator/index.js';
import { recordSystemActivity } from '../../system-activity.js';
// Buffer persistence removed - handled by buffer_manager node in graph

// ============================================================================
// Types
// ============================================================================

type Role = 'system' | 'user' | 'assistant';
type Mode = 'inner' | 'conversation';
type ConversationMessage = { role: Role; content: string; meta?: any; timestamp?: number };

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
  replyToQuestionId?: string;
  replyToContent?: string;
}

// ============================================================================
// In-memory State (shared across requests)
// ============================================================================

const histories: Map<string, ConversationMessage[]> = new Map();
const bufferMeta: Record<Mode, { lastSummarizedIndex: number | null }> = {
  inner: { lastSummarizedIndex: null },
  conversation: { lastSummarizedIndex: null }
};

// Pre-warm executors flag
let executorsReady = false;
const executorsReadyPromise = (async () => {
  try {
    const { getNodeExecutor } = await import('../../nodes/index.js');
    if (getNodeExecutor('user_input')) {
      console.log('[persona-chat] ✅ Node executors pre-warmed');
      executorsReady = true;
    }
  } catch (error) {
    console.error('[persona-chat] ⚠️ Failed to pre-warm node executors:', error);
    executorsReady = true;
  }
})();

// ============================================================================
// Helper Functions
// ============================================================================

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

function getConversationHistorySnapshot(mode: Mode, sessionId: string): Array<{ role: Role; content: string; meta?: any; timestamp?: number }> {
  const history = getHistory(mode, sessionId);
  return history.map(entry => ({
    role: entry.role,
    content: entry.content,
    meta: entry.meta,
    timestamp: entry.meta?.timestamp,
  }));
}

function pushMessage(mode: Mode, message: ConversationMessage, sessionId: string): void {
  const history = getHistory(mode, sessionId);
  history.push(message);

  // Prune to max 80 messages
  const MAX_HISTORY = 80;
  if (history.length > MAX_HISTORY) {
    const systemPrompt = history[0]?.role === 'system' ? history.shift() : null;
    const recentMessages = history.slice(-(MAX_HISTORY - (systemPrompt ? 1 : 0)));
    history.length = 0;
    if (systemPrompt) history.push(systemPrompt);
    history.push(...recentMessages);
  }
}

function buildSystemPrompt(mode: Mode, includePersonaSummary = true): string {
  let systemPrompt = '';
  if (includePersonaSummary) {
    try {
      const persona = loadPersonaWithFacet();

      // Inactive persona: no system prompt, rely entirely on LoRA
      if (persona === null) {
        console.log('[persona-chat] Persona inactive - LoRA-only mode, no system prompt');
        return '';
      }

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
      console.warn('[persona-chat] Failed to load persona:', (error as Error).message);
    }
  }

  if (!systemPrompt) {
    // Only add fallback prompt if persona wasn't explicitly set to inactive
    systemPrompt = mode === 'inner'
      ? 'You are having an internal dialogue with yourself.'
      : 'You are having a conversation.';
  }
  return systemPrompt;
}

function initializeChat(mode: Mode, sessionId: string, includePersonaSummary = true): void {
  const systemPrompt = buildSystemPrompt(mode, includePersonaSummary);
  const history = getHistory(mode, sessionId);
  history.length = 0;
  // Only add system prompt if not empty (inactive persona = LoRA-only mode)
  if (systemPrompt) {
    history.push({ role: 'system', content: systemPrompt });
  }
  bufferMeta[mode].lastSummarizedIndex = null;
}

// ============================================================================
// Graph Execution with SSE Streaming
// ============================================================================

async function* streamGraphExecution(params: GraphPipelineParams): AsyncGenerator<string> {
  const { mode, message, sessionId, cognitiveMode, userContext, conversationHistory, contextPackage, contextInfo, allowMemoryWrites, useOperator, yoloMode, replyToQuestionId, replyToContent } = params;

  const push = (type: string, data: any) => {
    return `data: ${JSON.stringify({ type, data })}\n\n`;
  };

  try {
    // Load graph
    yield push('progress', { step: 'loading_graph', message: 'Loading cognitive workflow...' });

    const graphKey = cognitiveMode || mode;
    const loaded = await loadGraphForMode(graphKey);
    if (!loaded) {
      yield push('error', { message: 'Failed to load cognitive graph' });
      return;
    }

    yield push('progress', { step: 'graph_loaded', message: `Executing ${loaded.graph.name} (${loaded.graph.nodes.length} nodes)` });

    const timeoutMs = 300000; // 5 minutes
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
      // Reply-to context for responding to selected messages (curiosity questions, etc.)
      replyToQuestionId,
      replyToContent,
    };

    const startedAt = Date.now();
    const executionEvents: any[] = [];
    let lastProgressTime = Date.now();

    // Collect events we need to yield
    const pendingEvents: string[] = [];

    const eventHandler = (event: any) => {
      executionEvents.push(event);

      // Check cancellation
      const cancellationStatus = checkCancellation(sessionId);
      if (cancellationStatus.cancelled) {
        throw new Error('CANCELLATION_REQUESTED');
      }

      const now = Date.now();
      if (now - lastProgressTime > 200 || event.type === 'node_error' || event.type === 'graph_complete') {
        lastProgressTime = now;

        if (event.type === 'node_start') {
          const node = loaded.graph.nodes.find((n: any) => n.id === event.nodeId);
          const nodeName = node?.title || node?.type || `Node ${event.nodeId}`;
          const nodeType = node?.type || '';

          let friendlyMessage = nodeName;
          if (nodeType.includes('react_planner')) {
            friendlyMessage = '🧠 Planning next action...';
          } else if (nodeType.includes('skill_executor')) {
            friendlyMessage = '⚙️ Executing skill...';
          } else if (nodeType.includes('semantic_search')) {
            friendlyMessage = '🔍 Searching memories...';
          } else if (nodeType.includes('response_synthesizer')) {
            friendlyMessage = '✍️ Synthesizing response...';
          } else if (nodeType.includes('persona_llm')) {
            friendlyMessage = '💭 Generating response...';
          }

          pendingEvents.push(push('progress', {
            step: 'node_executing',
            message: friendlyMessage,
            nodeId: event.nodeId,
            nodeType,
          }));
        } else if (event.type === 'node_error') {
          pendingEvents.push(push('progress', {
            step: 'node_error',
            message: `Error in node ${event.nodeId}`,
            error: event.data?.error,
          }));
        } else if (event.type === 'node_complete') {
          const node = loaded.graph.nodes.find((n: any) => n.id === event.nodeId);
          const nodeType = node?.type || '';

          // Extract thoughts from react_planner
          if (nodeType.includes('react_planner') && event.data?.outputs) {
            const outputs = event.data.outputs;
            const planText = typeof outputs === 'object' ? outputs.plan : outputs;

            if (planText && typeof planText === 'string') {
              const thoughtMatch = planText.match(/Thought:\s*(.+?)(?=\nAction:|$)/is);
              if (thoughtMatch) {
                const thought = thoughtMatch[1].trim();
                pendingEvents.push(push('progress', {
                  step: 'thinking',
                  message: `💭 ${thought}`,
                  nodeId: event.nodeId,
                  nodeType,
                }));
              }
            }
          }
        }
      }
    };

    // Execute graph with user context
    const graphState = await withUserContext(
      {
        userId: userContext?.userId || 'anonymous',
        username: userContext?.username || 'anonymous',
        role: (userContext?.role || 'anonymous') as any,
      },
      async () => {
        return executeGraph(loaded.graph, contextData, eventHandler);
      }
    );

    // Yield any pending progress events
    for (const event of pendingEvents) {
      yield event;
    }

    if (!graphState) {
      yield push('error', { message: 'Graph execution returned no state' });
      return;
    }

    const duration = Date.now() - startedAt;
    const output = getGraphOutput(graphState);
    const responseText = output?.output || output?.response;
    const graphError = output?.error;

    if (graphError) {
      yield push('error', { message: graphError });
      return;
    }

    if (!responseText) {
      yield push('error', { message: 'Graph executed but produced no response' });
      return;
    }

    yield push('progress', {
      step: 'graph_complete',
      message: `Graph completed in ${duration}ms`,
    });

    // Update in-memory history
    pushMessage(mode, { role: 'user', content: message }, sessionId);
    pushMessage(mode, { role: 'assistant', content: responseText, meta: { graphPipeline: true } }, sessionId);

    // NOTE: Buffer persistence is handled by buffer_manager node in the graph
    // Don't double-write here - that causes duplicate messages in the UI

    // Send final answer
    const facet = getActiveFacet();
    yield push('answer', { response: responseText, facet, saved: null, executionTime: duration });

  } catch (error) {
    if ((error as Error).message === 'CANCELLATION_REQUESTED') {
      yield push('cancelled', { message: '⏸️ Request cancelled' });
    } else {
      console.error('[persona-chat] Error:', error);
      yield push('error', { message: (error as Error).message });
    }
  } finally {
    clearCancellation(sessionId);
  }
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * GET /api/persona_chat - SSE streaming chat endpoint
 * POST /api/persona_chat - Same but with body
 */
export async function handlePersonaChat(req: UnifiedRequest): Promise<UnifiedResponse> {
  // Wait for executors
  if (!executorsReady) {
    await executorsReadyPromise;
  }

  const { user, query, body } = req;

  // Parse params from query (GET) or body (POST)
  const params = req.method === 'GET' ? query || {} : body || {};

  // Ensure message is always a string (mobile may send different types)
  const message = typeof params.message === 'string' ? params.message : String(params.message || '');
  const mode: Mode = params.mode === 'conversation' ? 'conversation' : 'inner';
  const newSession = params.newSession === 'true' || params.newSession === true;
  const sessionId = params.sessionId || `conv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const yolo = params.yolo === 'true' || params.yolo === true;
  // Reply-to context for responding to selected messages (e.g., curiosity questions)
  const replyToQuestionId = typeof params.replyToQuestionId === 'string' ? params.replyToQuestionId : undefined;
  const replyToContent = typeof params.replyToContent === 'string' ? params.replyToContent : undefined;
  // stream=false returns complete JSON response instead of SSE (for mobile compatibility)
  const useStreaming = params.stream !== 'false' && params.stream !== false;

  // Resolve cognitive mode and permissions
  const isAuthenticated = user.isAuthenticated;
  const cognitiveConfig = loadCognitiveMode();
  const loadedMode = cognitiveConfig.currentMode;
  const cognitiveMode = isAuthenticated ? loadedMode : 'emulation';
  const allowMemoryWrites = isAuthenticated ? modeAllowsMemoryWrites(loadedMode) : false;
  const useOperator = isAuthenticated && cognitiveMode !== 'emulation' && user.role === 'owner';

  console.log(`[persona-chat] mode=${mode}, cognitiveMode=${cognitiveMode}, user=${user.username}`);

  // Record user activity for agent scheduler (so agents know which user to run for)
  if (isAuthenticated && user.username) {
    scheduler.recordActivity(user.username);

    // If Active Operator is enabled, record activity so it knows to pause background tasks
    // and prioritize user interactions
    if (isActiveOperatorEnabled()) {
      recordSystemActivity(Date.now(), user.username);
    }
  }

  // Initialize chat if needed
  const history = getHistory(mode, sessionId);
  if (newSession || history.length === 0) {
    initializeChat(mode, sessionId);
    if (!message) {
      return { status: 200, data: { response: 'Chat session initialized.' } };
    }
  }

  if (!message) {
    return badRequestResponse('Message is required');
  }

  const trimmedMessage = message.trim();

  const conversationHistorySnapshot = getConversationHistorySnapshot(mode, sessionId);

  // Create streaming generator
  const streamGen = streamGraphExecution({
    mode,
    message: trimmedMessage,
    sessionId,
    cognitiveMode,
    userContext: { userId: user.userId, username: user.username, role: user.role },
    conversationHistory: conversationHistorySnapshot,
    contextPackage: {},
    contextInfo: '',
    allowMemoryWrites,
    useOperator,
    yoloMode: yolo,
    replyToQuestionId,
    replyToContent,
  });

  // Non-streaming mode: collect all events and return as JSON
  // This is used by mobile where CapacitorHttp doesn't support streaming
  if (!useStreaming) {
    const events: Array<{ type: string; data: any }> = [];
    let finalResponse = '';
    let finalFacet = null;
    let executionTime = 0;
    let errorMessage = null;

    for await (const chunk of streamGen) {
      // Parse SSE format: "data: {...}\n\n"
      const match = chunk.match(/^data: (.+)\n\n$/);
      if (match) {
        try {
          const parsed = JSON.parse(match[1]);
          events.push(parsed);

          // Extract final answer
          if (parsed.type === 'answer' && parsed.data) {
            finalResponse = parsed.data.response || '';
            finalFacet = parsed.data.facet || null;
            executionTime = parsed.data.executionTime || 0;
          }
          if (parsed.type === 'error' && parsed.data) {
            errorMessage = parsed.data.message || 'Unknown error';
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    if (errorMessage) {
      return { status: 500, error: errorMessage };
    }

    return {
      status: 200,
      data: {
        response: finalResponse,
        facet: finalFacet,
        executionTime,
        events, // Include all events for debugging/progress if needed
      },
    };
  }

  // Streaming mode: return SSE stream
  return streamResponse(streamGen);
}

/**
 * DELETE /api/persona_chat - Clear chat history
 */
export async function handleClearPersonaChat(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body } = req;
  const mode: Mode = body?.mode === 'conversation' ? 'conversation' : 'inner';
  const sessionId = body?.sessionId || 'default';

  const key = getHistoryKey(mode, sessionId);
  histories.delete(key);

  return { status: 200, data: { cleared: true } };
}

/**
 * POST /api/persona_chat/cancel - Cancel ongoing request
 */
export async function handleCancelPersonaChat(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { body } = req;
  const sessionId = body?.sessionId;

  if (!sessionId) {
    return badRequestResponse('sessionId is required');
  }

  // Import cancellation function
  const { requestCancellation } = await import('../../graph-streaming.js');
  requestCancellation(sessionId, 'User requested cancellation');

  return { status: 200, data: { cancelled: true } };
}
