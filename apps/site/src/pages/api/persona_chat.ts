import type { APIRoute } from 'astro';
import { loadPersonaCore, loadPersonaWithFacet, getActiveFacet, ollama, captureEvent, ROOT, listActiveTasks, audit, getIndexStatus, queryIndex, buildRagContext, searchMemory, loadTrustLevel, callLLM, type ModelRole, type RouterMessage, getOrchestratorContext, getPersonaContext, updateConversationContext, updateCurrentFocus, resolveModelForCognitiveMode, buildContextPackage, formatContextForPrompt, PersonalityCoreLayer, checkResponseSafety, refineResponseSafely, executeGraph, getGraphOutput, type CognitiveGraph, validateCognitiveGraph, withUserContext } from '@metahuman/core';
import { loadCognitiveMode, getModeDefinition, canWriteMemory as modeAllowsMemoryWrites, canUseOperator } from '@metahuman/core/cognitive-mode';
import { canWriteMemory as policyCanWriteMemory } from '@metahuman/core/memory-policy';
import { loadChatSettings } from '@metahuman/core/chat-settings';
import { getUserOrAnonymous, getUserPaths, getProfilePaths } from '@metahuman/core';
import { readFileSync, existsSync, appendFileSync, writeFileSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { initializeSkills } from '@brain/skills/index.js';
import { getAvailableSkills, executeSkill, type SkillManifest } from '@metahuman/core/skills';
import { resolveNodePipelineFlag } from '../../utils/node-pipeline';
// Proactively import node executors to ensure they're loaded before graph execution
// This forces the registry to load all executors (including conditionalRerouteExecutor) at module init
import { nodeExecutors } from '@metahuman/core';

type Role = 'system' | 'user' | 'assistant';
type Mode = 'inner' | 'conversation';
type ConversationMessage = { role: Role; content: string; meta?: any; timestamp?: number };

// Ensure skill registry is ready for any inline tool invocations from persona_chat.
initializeSkills();

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

/**
 * Cancellation Manager
 * Tracks active requests that can be interrupted by the user
 */
const activeCancellations = new Map<string, { cancelled: boolean; reason?: string }>();

export function requestCancellation(requestId: string, reason: string = 'User requested stop'): void {
  activeCancellations.set(requestId, { cancelled: true, reason });
  console.log(`[cancellation] Request ${requestId} marked for cancellation: ${reason}`);
}

export function checkCancellation(requestId: string): { cancelled: boolean; reason?: string } {
  return activeCancellations.get(requestId) || { cancelled: false };
}

export function clearCancellation(requestId: string): void {
  activeCancellations.delete(requestId);
}

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

// Feature flag: Use cognitive pipeline Layer 2 wrapper (Phase 4.1a)
// Set to true to enable PersonalityCoreLayer wrapper around LLM calls
const USE_COGNITIVE_PIPELINE = process.env.USE_COGNITIVE_PIPELINE === 'true';

// Feature flag: Enable safety validation (Phase 4.2)
// When true and USE_COGNITIVE_PIPELINE is true, runs non-blocking safety checks
// Default: true (enabled when pipeline is enabled)
const ENABLE_SAFETY_CHECKS = process.env.ENABLE_SAFETY_CHECKS !== 'false';

// Feature flag: Enable response refinement (Phase 4.3)
// When true, auto-sanitizes detected safety issues (non-blocking test mode)
// Both original and refined are logged, ORIGINAL still sent to user
// Default: true (enabled when pipeline is enabled)
const ENABLE_RESPONSE_REFINEMENT = process.env.ENABLE_RESPONSE_REFINEMENT !== 'false';

// Feature flag: Enable blocking mode (Phase 4.4)
// When true, sends REFINED responses to users (instead of original)
// IMPORTANT: Only enable after validating refinement quality in Phase 4.3 logs
// Default: false (non-blocking mode, explicit opt-in required for safety)
const ENABLE_BLOCKING_MODE = process.env.ENABLE_BLOCKING_MODE === 'true';

// Feature flag: Enable auto-summarization (Phase 3)
// When true, automatically summarizes conversations when buffer overflows
// Disable if experiencing GPU memory issues or lockups during summarization
// Default: true (enabled)
const ENABLE_AUTO_SUMMARIZATION = process.env.ENABLE_AUTO_SUMMARIZATION !== 'false';

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

type GraphCacheEntry = { source: string; mtimeMs: number; graph: CognitiveGraph };
const graphCache: Record<string, GraphCacheEntry | null> = {};

async function readGraphFromFile(filePath: string): Promise<CognitiveGraph | null> {
  try {
    console.log(`[readGraphFromFile] Reading: ${filePath}`);
    const raw = await fs.readFile(filePath, 'utf-8');
    console.log(`[readGraphFromFile] File size: ${raw.length} bytes`);
    const parsed = JSON.parse(raw);
    console.log(`[readGraphFromFile] JSON parsed: ${parsed.nodes?.length || 0} nodes`);
    const validated = validateCognitiveGraph(parsed);
    console.log(`[readGraphFromFile] Validation PASSED`);
    return validated;
  } catch (error) {
    console.error('[readGraphFromFile] ERROR:', error);
    if (error instanceof Error) {
      console.error('[readGraphFromFile] Error message:', error.message);
      console.error('[readGraphFromFile] Error stack:', error.stack);
    }
    return null;
  }
}

async function loadGraphForMode(graphKey: string): Promise<{ graph: CognitiveGraph; source: string } | null> {
  if (!graphKey) {
    console.log('[loadGraphForMode] No graphKey provided');
    return null;
  }

  const normalizedKey = graphKey.toLowerCase();

  // Check if Big Brother Mode is enabled for dual mode
  let useBigBrotherGraph = false;
  if (normalizedKey === 'dual') {
    try {
      const { loadOperatorConfig } = await import('@metahuman/core');
      const operatorConfig = loadOperatorConfig();
      const bigBrotherEnabled = operatorConfig.bigBrotherMode?.enabled === true;

      if (bigBrotherEnabled) {
        const { isClaudeSessionReady } = await import('@metahuman/core');
        const claudeSessionReady = isClaudeSessionReady();
        if (claudeSessionReady) {
          useBigBrotherGraph = true;
          console.log('[loadGraphForMode] 🤖 Big Brother Mode active - loading Big Brother graph');
        } else {
          console.log('[loadGraphForMode] ⚠️ Big Brother enabled but Claude session not ready - using standard dual graph');
        }
      }
    } catch (error) {
      console.warn('[loadGraphForMode] Could not check Big Brother status:', error);
    }
  }

  const baseName = useBigBrotherGraph ? `${normalizedKey}-mode-bigbrother` : `${normalizedKey}-mode`;
  const pathsToCheck = [
    path.join(ROOT, 'etc', 'cognitive-graphs', 'custom', `${baseName}.json`),
    path.join(ROOT, 'etc', 'cognitive-graphs', `${baseName}.json`),
  ];

  console.log(`[loadGraphForMode] Looking for graph: "${graphKey}" (normalized: "${normalizedKey}"${useBigBrotherGraph ? ', Big Brother variant' : ''})`);
  console.log(`[loadGraphForMode] Paths to check:`, pathsToCheck);

  for (const filePath of pathsToCheck) {
    try {
      console.log(`[loadGraphForMode] Checking: ${filePath}`);
      if (!existsSync(filePath)) {
        console.log(`[loadGraphForMode] ❌ File not found: ${filePath}`);
        continue;
      }
      console.log(`[loadGraphForMode] ✅ File exists: ${filePath}`);
      const stats = await fs.stat(filePath);
      const cached = graphCache[normalizedKey];
      if (cached && cached.source === filePath && cached.mtimeMs === stats.mtimeMs) {
        console.log(`[loadGraphForMode] 🎯 Using cached graph from ${filePath}`);
        return { graph: cached.graph, source: filePath };
      }
      console.log(`[loadGraphForMode] 📖 Reading graph file (not cached or stale)`);
      const graph = await readGraphFromFile(filePath);
      if (graph) {
        console.log(`[loadGraphForMode] ✅ Graph loaded successfully: ${graph.nodes.length} nodes, ${graph.links.length} links`);
        graphCache[normalizedKey] = {
          source: filePath,
          mtimeMs: stats.mtimeMs,
          graph,
        };
        return { graph, source: filePath };
      } else {
        console.warn(`[loadGraphForMode] ❌ readGraphFromFile returned null for ${filePath}`);
      }
    } catch (error) {
      console.error(`[loadGraphForMode] ❌ Failed to load graph ${filePath}:`, error);
    }
  }

  console.warn(`[loadGraphForMode] ❌ No valid graph found for "${graphKey}"`);
  return null;
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
 * Add message to history and automatically prune to stay within limits
 * PROACTIVE SUMMARIZATION: Triggers at 80% capacity (16/20 messages) to avoid interrupting conversation
 */
/**
 * DEPRECATED: pushMessage is now a no-op
 * BufferManager node in cognitive graph handles ALL message persistence and capacity management
 * Keeping function signature for backwards compatibility with legacy code paths
 */
function pushMessage(
  _mode: Mode,
  _message: ConversationMessage,
  _sessionId: string,
  _streamNotifier?: (type: string, data: any) => void
): void {
  // NO-OP: BufferManager handles:
  // - Message persistence to buffer file
  // - Capacity checking (64/80 threshold)
  // - Pruning (max 80 messages)
  // - Summarization flagging (needsSummarization field)
}

/**
 * Trigger background summarization for a conversation session
 * PROACTIVE: Now triggers at 80% capacity instead of waiting for overflow
 *
 * PERFORMANCE FIX: Cooldown mechanism prevents repeated triggers for the same session
 * within a 60-second window to avoid GPU memory spikes from concurrent LLM calls
 */
const summarizationCooldown = new Map<string, number>();
const SUMMARIZATION_COOLDOWN_MS = 60_000; // 60 seconds

async function triggerAutoSummarization(
  sessionId: string,
  mode: Mode,
  streamNotifier?: (type: string, data: any) => void
): Promise<void> {
  try {
    // Check if auto-summarization is enabled (kill switch)
    if (!ENABLE_AUTO_SUMMARIZATION) {
      console.log('[auto-summarization] Disabled via ENABLE_AUTO_SUMMARIZATION flag');
      return;
    }

    // Check cooldown to prevent rapid repeated triggers (race condition fix)
    const now = Date.now();
    const lastTrigger = summarizationCooldown.get(sessionId);

    if (lastTrigger && now - lastTrigger < SUMMARIZATION_COOLDOWN_MS) {
      const remainingSeconds = Math.ceil((SUMMARIZATION_COOLDOWN_MS - (now - lastTrigger)) / 1000);
      console.log(`[auto-summarization] Cooldown active for session ${sessionId} (${remainingSeconds}s remaining)`);
      return;
    }

    // Set cooldown timestamp BEFORE triggering to prevent concurrent calls
    summarizationCooldown.set(sessionId, now);

    // Clean up old cooldown entries (older than 5 minutes)
    for (const [key, timestamp] of summarizationCooldown.entries()) {
      if (now - timestamp > 300_000) {
        summarizationCooldown.delete(key);
      }
    }

    // Import summarizer dynamically to avoid circular dependencies
    const { summarizeSession } = await import('@brain/agents/summarizer.js');

    console.log(`[auto-summarization] Triggering summarization for session: ${sessionId}`);

    // Run summarization in background (don't await - let it run async)
    void summarizeSession(sessionId, { bufferMode: mode })
      .then(summary => {
        if (summary) {
          upsertSummaryMarker(mode, summary);

          // Notify user of successful summarization
          if (streamNotifier) {
            streamNotifier('system_message', {
              content: '✓ Conversation summarized successfully'
            });
          }
        }
        console.log(`[auto-summarization] Successfully summarized session: ${sessionId}`);
      })
      .catch(error => {
        console.error(`[auto-summarization] Summarization failed for session ${sessionId}:`, error);

        // Notify user of failure
        if (streamNotifier) {
          streamNotifier('system_message', {
            content: '⚠️ Summarization failed (conversation continues normally)'
          });
        }

        // Clear cooldown on error so it can be retried later
        summarizationCooldown.delete(sessionId);
      });
  } catch (error) {
    console.error('[auto-summarization] Failed to import summarizer:', error);
    // Clear cooldown on error
    summarizationCooldown.delete(sessionId);
  }
}

// Dedup and retry guards
const lastUserTurn: Record<Mode, { text: string; ts: number } | null> = { inner: null, conversation: null };
const lastAssistantReplies: Record<Mode, string[]> = { inner: [], conversation: [] };
// Track recently used memory IDs to avoid repeating the same snippets turn after turn
const recentMemoryIds: Record<Mode, string[]> = { inner: [], conversation: [] };

function extractEventIdFromFile(filePath: string): string | undefined {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    return typeof data.id === 'string' ? data.id : undefined;
  } catch (error) {
    console.warn('[persona_chat] Failed to extract event id:', error);
    return undefined;
  }
}

async function appendResponseToEvent(filePath: string, response: string): Promise<void> {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    data.response = response;
    data.metadata = {
      ...(data.metadata || {}),
      timestamp: data.metadata?.timestamp || new Date().toISOString(),
    };
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.warn('[persona_chat] Failed to append response to memory event:', error);
  }
}

/**
 * Helper to load cognitive mode context and compute derived flags.
 * Returns mode, defaults, and permission flags for consistent behavior.
 */
function getCognitiveModeContext() {
  const cognitiveConfig = loadCognitiveMode();
  const mode = cognitiveConfig.currentMode;
  const modeDefinition = getModeDefinition(mode);
  const defaults = modeDefinition.defaults;

  return {
    mode,
    config: cognitiveConfig,
    definition: modeDefinition,
    defaults,
    allowMemoryWrites: modeAllowsMemoryWrites(mode),
    allowOperator: canUseOperator(mode),
  };
}

/**
 * Load persona summary and recent reflections as fallback grounding context.
 * Used in dual mode when semantic index is unavailable.
 */
async function loadPersonaFallbackContext(persona: any): Promise<string> {
  try {
    const fallbackParts: string[] = [];

    // Add core identity
    if (persona?.identity) {
      const { name, role, purpose } = persona.identity;
      fallbackParts.push(`I am ${name}. ${role}. ${purpose}`);
    }

    // Add key personality traits
    if (persona?.personality?.communicationStyle) {
      const tone = persona.personality.communicationStyle.tone || [];
      if (Array.isArray(tone) && tone.length > 0) {
        fallbackParts.push(`Communication style: ${tone.join(', ')}`);
      }
    }

    // Add core values
    if (persona?.values?.core) {
      const values = persona.values.core.map((v: any) => v.value).filter(Boolean);
      if (values.length > 0) {
        fallbackParts.push(`Core values: ${values.join(', ')}`);
      }
    }

    // Try to load recent reflections as lightweight grounding
    try {
      const reflectionsPath = path.join(ROOT, 'memory/reflections');
      if (existsSync(reflectionsPath)) {
        const files = await fs.readdir(reflectionsPath);
        const jsonFiles = files.filter(f => f.endsWith('.json')).sort().reverse().slice(0, 2);

        for (const file of jsonFiles) {
          try {
            const content = await fs.readFile(path.join(reflectionsPath, file), 'utf-8');
            const reflection = JSON.parse(content);
            if (reflection.content) {
              fallbackParts.push(`Recent reflection: ${reflection.content.substring(0, 200)}`);
            }
          } catch {}
        }
      }
    } catch {}

    return fallbackParts.join('\n\n');
  } catch (error) {
    console.error('[loadPersonaFallbackContext] Error:', error);
    return 'Core identity available but details unavailable.';
  }
}

function stripChainOfThought(raw: string): string {
  if (!raw) return '';
  let text = raw;

  // Remove explicit <think> blocks often emitted by Qwen-style models
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // If the model used fenced "thinking" code blocks, drop them
  text = text.replace(/```(?:thought|thinking|plan)?[\s\S]*?```/gi, '').trim();

  // Peel off common "Final Answer" style markers, preferring the last occurrence
  const markers = [
    '**Final Answer**:',
    '**Final Answer**',
    'Final Answer:',
    'Final answer:',
    'User-facing response:',
    'User-Facing Response:',
    'Answer:',
    'Response:',
  ];
  for (const marker of markers) {
    const idx = text.lastIndexOf(marker);
    if (idx !== -1) {
      text = text.slice(idx + marker.length).trim();
      break;
    }
  }

  // Remove leftover markdown emphasis artifacts
  text = text.replace(/^\*\*\s*/g, '').replace(/\s*\*\*$/g, '').trim();

  // Collapse excessive spacing
  text = text.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  return text.trim();
}



/**
 * @deprecated LEGACY CODE - DO NOT USE FOR NEW FEATURES
 *
 * This function performs synchronous semantic search that can hang for minutes.
 * It's only kept for backward compatibility when graphEnabled=false.
 *
 * **The graph pipeline should be used instead** - it has:
 * - Proper timeout protection (30s)
 * - Progress streaming
 * - Full logging visibility
 * - Modular workflow
 *
 * TODO: Remove this function entirely once graph pipeline is stable
 */
async function getRelevantContext(
  userMessage: string,
  mode: Mode,
  sessionId: string,
  opts?: { usingLora?: boolean; includePersonaSummary?: boolean; replyToMessage?: string }
): Promise<{ context: string; usedSemantic: boolean; contextPackage: any }> {
  try {
    console.warn('[getRelevantContext] ⚠️ DEPRECATED: Using legacy context retrieval - this can hang!');

    // Load chat settings to configure context retrieval
    const chatSettings = loadChatSettings();

    // Load cognitive mode to enforce mode-specific retrieval behavior
    const cognitiveContext = getCognitiveModeContext();
    const cognitiveMode = cognitiveContext.mode;

    // Determine if user is asking about tasks
    const wantsTasks = /\b(task|tasks|todo|to[- ]do|project|projects|what am i working|current work)\b/i.test(userMessage);

    // Smart filtering: Don't filter dreams/reflections if user is explicitly asking about them
    const askingAboutDreams = /\b(dream|dreams|dreamed|dreaming|nightmare)\b/i.test(userMessage);
    const askingAboutReflections = /\b(reflect|reflection|reflections|thought about|thinking about)\b/i.test(userMessage);
    const shouldFilterReflections = !askingAboutDreams && !askingAboutReflections;

    // Lower similarity threshold when asking about dreams/reflections
    // Dreams often have abstract/poetic language that doesn't match literal queries well
    // Use configured threshold as baseline, with special handling for dreams/reflections
    const baseThreshold = chatSettings.semanticSearchThreshold;
    const threshold = (askingAboutDreams || askingAboutReflections) ? Math.max(0.45, baseThreshold - 0.1) : baseThreshold;

    // HYBRID SEARCH: When asking about dreams/reflections, add metadata filter
    // This ensures we get the right type of memories, not just semantically similar chat messages
    const metadataFilters = (askingAboutDreams || askingAboutReflections) ? {
      type: askingAboutDreams ? ['dream'] : ['reflection', 'reflection_summary']
    } : undefined;

    // When using metadata filters, lower threshold significantly since we're filtering by type
    // The filter ensures correctness, semantic search just ranks within that type
    const effectiveThreshold = metadataFilters ? 0.0 : threshold;

    // Build context package using context builder
    // NOTE: Memories are NOT auto-retrieved - operator uses search_index skill on-demand
    const contextPackage = await buildContextPackage(userMessage, cognitiveMode, {
      searchDepth: 'normal',          // 8 results (matching old topK: 8)
      similarityThreshold: effectiveThreshold,  // Skip threshold when filtering by metadata
      // Let memory-policy enforce per-role caps instead of pinning to 2
      maxMemories: undefined,
      maxContextChars: chatSettings.maxContextChars,  // Use configured context limit
      metadataFilters,                // Hybrid search: filter by type when user explicitly asks
      filterInnerDialogue: true,      // Matching old filtering
      filterReflections: shouldFilterReflections,  // Smart filter: allow dreams/reflections when user asks for them
      includeShortTermState: true,    // Include orchestrator state
      includePersonaCache: opts?.includePersonaSummary !== false,
      includeTaskContext: wantsTasks, // Only include tasks if mentioned
      detectPatterns: false,          // Skip pattern detection for now
      forceSemanticSearch: false,     // FIXED: Don't auto-inject memories - let operator decide via search_index skill
      usingLoRA: opts?.usingLora || false,
      conversationId: sessionId
    });

    // Format context for prompt
    let context = formatContextForPrompt(contextPackage, {
      maxChars: contextPackage.maxContextChars,
      includePersona: opts?.includePersonaSummary !== false && !opts?.usingLora
    });

    // INJECT reply-to context at the top if provided
    if (opts?.replyToMessage) {
      const replyToSection = `# User is Replying To\n${opts.replyToMessage}\n\n`;
      context = replyToSection + context;
      console.log('[context-builder] Injected reply-to context:', opts.replyToMessage.substring(0, 100));
    }

    // Track used semantic search
    const usedSemantic = contextPackage.indexStatus === 'available' && contextPackage.memoryCount > 0;

    // Legacy audit event for compatibility
    audit({
      level: 'info',
      category: 'action',
      event: 'chat_context_retrieved',
      details: {
        query: userMessage,
        tasks: contextPackage.activeTasks.length,
        indexUsed: usedSemantic,
        cognitiveMode,
        usedFallback: contextPackage.fallbackUsed,
        memoryCount: contextPackage.memoryCount,
        hasReplyTo: !!opts?.replyToMessage,
      },
      actor: 'system',
    });

    return { context, usedSemantic, contextPackage };
  } catch (error) {
    console.error('Error retrieving context:', error);
    return { context: '', usedSemantic: false, contextPackage: {} };
  }
}

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

function ensureSystemPrompt(mode: Mode, sessionId: string, includePersonaSummary = true): void {
  const history = getHistory(mode, sessionId);
  if (history.length === 0) {
    initializeChat(mode, sessionId, false, false, includePersonaSummary);
    return;
  }

  if (history[0].role !== 'system') {
    history.unshift({
      role: 'system',
      content: buildSystemPrompt(mode, includePersonaSummary)
    });
  }
}

/**
 * Update the system prompt with current facet (refreshes persona without clearing history)
 */
function refreshSystemPrompt(mode: Mode, sessionId: string, includePersonaSummary = true): void {
  const history = getHistory(mode, sessionId);
  if (history.length === 0 || history[0].role !== 'system') {
    ensureSystemPrompt(mode, sessionId, includePersonaSummary);
    return;
  }

  history[0].content = buildSystemPrompt(mode, includePersonaSummary);
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

// DEPRECATED: This function is no longer used.
// The unified reasoning layer (ReAct operator) now handles ALL requests from authenticated users.
// The operator intelligently chooses whether to use skills or conversational_response.
// This eliminates the need for hardcoded routing patterns and LLM-based routing decisions.

function formatOperatorResult(result: any): string {
  // Handle ReAct operator response format
  if (result.iterations !== undefined && result.result !== undefined) {
    // ReAct operator response
    if (result.error) {
      // Format structured error gracefully (Phase 1: Graceful Failure Handling)
      let errorMsg = `⚠️ **Task encountered an issue**\n\n`;

      if (result.error.type === 'stuck') {
        errorMsg += `**Reason:** ${result.error.reason}\n\n`;

        if (result.error.context) {
          errorMsg += `**Details:**\n`;
          if (result.error.context.failedActions) {
            errorMsg += `- Failed actions: ${result.error.context.failedActions.join(', ')}\n`;
          }
          if (result.error.context.errors && result.error.context.errors.length > 0) {
            errorMsg += `- Recent errors:\n`;
            result.error.context.errors.slice(0, 3).forEach((err: string) => {
              errorMsg += `  - ${err}\n`;
            });
          }
          if (result.error.context.iterations) {
            errorMsg += `- Iterations completed: ${result.error.context.iterations}\n`;
          }
        }

        if (result.error.suggestions && result.error.suggestions.length > 0) {
          errorMsg += `\n**Suggestions:**\n`;
          result.error.suggestions.forEach((suggestion: string) => {
            errorMsg += `- ${suggestion}\n`;
          });
        }
      } else if (result.error.type === 'exception') {
        errorMsg += `**Reason:** ${result.error.reason}\n\n`;
        errorMsg += `**Message:** ${result.error.message || 'Unknown error'}\n\n`;

        if (result.error.suggestions && result.error.suggestions.length > 0) {
          errorMsg += `**Suggestions:**\n`;
          result.error.suggestions.forEach((suggestion: string) => {
            errorMsg += `- ${suggestion}\n`;
          });
        }
      } else {
        // Fallback for legacy string errors
        errorMsg = `Task failed after ${result.iterations} iteration(s): ${result.error}`;
      }

      return errorMsg;
    }
    // Return the synthesized result directly
    return result.result;
  }

  // Handle legacy operator response format
  let output = `### Operator Execution Report\n\n**Task:** ${result.task?.goal || result.goal}\n\n**Outcome:** ${result.success ? '✅ Success' : '❌ Failed'}\n`;

  // Check if operator produced a file write with conversational content (e.g., greeting response)
  // If so, extract the content to return directly to chat instead of just showing the file path
  let extractedContent = '';
  if (result.results && Array.isArray(result.results)) {
    for (const res of result.results) {
      if (res.success && res.output && res.skillId === 'fs_write') {
        // Try to read the file content if it's a conversational response
        const filePath = res.output.path;
        if (filePath && typeof filePath === 'string') {
          try {
            const content = readFileSync(path.join(ROOT, filePath), 'utf-8').trim();
            // If content looks conversational (not code/json), extract it
            if (content && !content.startsWith('{') && !content.startsWith('[')) {
              extractedContent = content;
            }
          } catch {
            // Ignore file read errors
          }
        }
      }
    }
  }

  // If we extracted conversational content, return it directly for synthesis
  if (extractedContent) {
    return extractedContent;
  }

  if (result.plan && result.plan.steps) {
    output += '\n**Plan:**\n';
    result.plan.steps.forEach((step: any) => {
      output += `- **Step ${step.id}:** ${step.description} (Skill: ${step.skillId})\n`;
    });
  }

  if (result.results) {
    output += '\n**Execution:**\n';
    result.results.forEach((res: any) => {
      output += `- **Step ${res.stepId}:** ${res.success ? 'SUCCESS' : 'FAILED'}\n`;
      if (res.error) {
        output += `  - _Error: ${res.error}_\n`;
      }
      if (res.output) {
        const items = res.output?.results;
        if (Array.isArray(items) && items.length) {
          output += '  - _Results:_\n';
          items.forEach((item: any) => {
            const title = item?.title || item?.url;
            if (title && item?.url) {
              output += `    • [${title}](${item.url})\n`;
            }
            if (item?.snippet) {
              output += `      ${item.snippet}\n`;
            }
            if (item?.image) {
              output += `      ![](${item.image})\n`;
            }
            if (Array.isArray(item?.deepLinks) && item.deepLinks.length) {
              item.deepLinks.slice(0, 4).forEach((link: any) => {
                if (link?.title && link?.url) {
                  output += `      ↳ [${link.title}](${link.url})\n`;
                }
              });
            }
          });
        } else {
          output += `  - _Output: ${JSON.stringify(res.output, null, 2)}_\n`;
        }
      }
    });
  }

  if (result.critique) {
    output += `\n**Critique:** ${result.critique.feedback}\n`;
    if (result.critique.shouldRetry) {
      output += `**Suggestion:** Retry recommended. ${result.critique.suggestedFixes || ''}\n`;
    }
  }

  if (result.error) {
    output += `\n**Error:** ${result.error}\n`;
  }

  return output;
}

async function synthesizeOperatorAnswer(model: string, userMessage: string, operatorReport: string, cognitiveMode = 'dual'): Promise<string> {
  // Load current persona with active facet
  const persona = loadPersonaWithFacet();
  const activeFacet = getActiveFacet();

  console.log(`[synthesizeOperatorAnswer] Using persona facet: ${activeFacet}`);

  // Build persona-aware instructions that incorporate the facet's personality
  const tonePref = persona?.personality?.communicationStyle?.tone;
  const toneList = Array.isArray(tonePref)
    ? tonePref
    : tonePref
      ? [tonePref]
      : ['adaptive'];

  const coreValues = Array.isArray(persona?.values?.core)
    ? persona.values.core.map((v: any) => (typeof v === 'string' ? v : v?.value || '')).filter(Boolean)
    : [];

  const personaContext = `You are ${persona.identity.name}.
Your role: ${persona.identity.role}
Your purpose: ${persona.identity.purpose}

Your communication style: ${toneList.join(', ')}
Your values: ${coreValues.join(', ')}`;

  const instructions = `${personaContext}

You are synthesizing the results from an autonomous operator that fetched data for the user.
Respond in your natural voice and personality - don't sound robotic or generic.
Present the findings naturally:
- Open with a direct answer in your characteristic style
- Share relevant details that matter to the user
- If useful links are present, weave them into your response naturally
- Close in a way that invites further exploration

Stay true to your personality. Don't mention "the operator" or technical details. If nothing useful was found, say so in your own way.`;

  const prompt = [
    { role: 'system', content: instructions },
    {
      role: 'user',
      content: `The user asked:\n${userMessage}\n\nHere is the raw operator report:\n${operatorReport}`,
    },
  ];

  const summaryResp = await callLLM({
    role: 'persona', // Changed from 'summarizer' to 'persona' to use persona model
    messages: prompt as RouterMessage[],
    cognitiveMode,
    options: {
      temperature: 0.7, // Increased from 0.35 to allow more personality
      topP: 0.9,
      repeatPenalty: 1.2,
      maxTokens: 768,
    },
  });

  const text = summaryResp.content.trim();
  return text || operatorReport;
}

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
  let sessionCookie, isAuthenticated, userRole, operatorRoleAllowed, cognitiveContext, cognitiveMode, allowMemoryWrites;

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
    cognitiveContext = getCognitiveModeContext();
    cognitiveMode = isAuthenticated ? cognitiveContext.mode : 'emulation';
    allowMemoryWrites = isAuthenticated ? cognitiveContext.allowMemoryWrites : false;

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

  // ============================================================================
  // PRIORITY 2 (FALLBACK): Legacy operator or chat-only
  // ============================================================================
  // @deprecated This entire code path should be removed once graph pipeline is stable
  // The graph pipeline replaces all of this with modular nodes
  console.warn(`[persona_chat] ⚠️ FALLBACK TO LEGACY PATH - Graph pipeline not available`);

  if (m === 'conversation' && audience && forceOperator) {
    pushMessage(m, { role: 'system', content: `Audience/context: ${audience}` }, sessionId);
  }

  // Note: Context already retrieved earlier via legacy getRelevantContext() and available as contextInfo, usedSemantic, contextPackage

  // Load chat settings to configure response behavior
  const chatSettings = loadChatSettings();

  // Add user message to history (NOT context - we'll inject that per-request)
  // This keeps history clean with only user/assistant turns
  pushMessage(m, { role: 'user', content: message }, sessionId);

  try {
    // Use configured temperature (with slight reduction for inner dialogue)
    const temperature = m === 'inner' ? Math.max(0.1, chatSettings.temperature - 0.1) : chatSettings.temperature;
    // Merge LLM options from request (clamped)
    const llmOpts: Record<string, number> = {};
    try {
      const rawCtx = Number(llm?.num_ctx);
      if (Number.isFinite(rawCtx) && rawCtx > 0) {
        const num_ctx = Math.max(4096, Math.min(131072, rawCtx));
        llmOpts.num_ctx = num_ctx;
      }
      const rawPredict = Number(llm?.num_predict);
      if (Number.isFinite(rawPredict) && rawPredict > 0) {
        const num_predict = Math.max(256, Math.min(8192, rawPredict));
        llmOpts.num_predict = num_predict;
      }
    } catch {}

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let isClosed = false;

        // Safe enqueue that checks if controller is still open
        const push = (type: string, data: any) => {
          if (!isClosed) {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`));
            } catch (error) {
              // Controller was closed, ignore
              isClosed = true;
            }
          }
        };

        const emitReasoningStage = (stage: string, round: number, content: string) => {
          if (!content) return;
          push('reasoning', {
            stage,
            round,
            content,
          });
        };

        try {
          // Remove all artificial token limits - let the model decide output length
          // Only set a reasonable max to prevent runaway generation
          if (llmOpts && (llmOpts as any).num_predict == null) {
            (llmOpts as any).num_predict = 4096; // Generous limit
          }

          let assistantResponse = '';
          if (reasoningRequested) {
            const plannerConfigs = [
              { instruction: 'Provide 2-3 concise steps focused on the immediate response.', maxTokens: 512 },
              { instruction: 'Provide 4-6 detailed steps with rationale, assumptions, and potential risks.', maxTokens: 1024 },
              { instruction: 'Deliberate thoroughly: explore alternatives, flag uncertainties, and outline contingency or evaluation criteria.', maxTokens: 1536 },
            ];
            const configIdx = Math.max(1, Math.min(depthLevel, plannerConfigs.length));
            const planConfig = plannerConfigs[configIdx - 1];
            const basePlannerPrompt = `You are my private planner. Your task is to create a detailed and thoughtful plan to answer the user's last message.\n\n1.  **Analyze the User's Intent:** What is the user *really* asking? What is their underlying goal?\n2.  **Review the Context:** Consider the recent conversation history and any provided memories or context. How does this information influence the response?\n3.  **Identify Ambiguities:** Are there any parts of the user's message that are unclear or could be interpreted in multiple ways?\n4.  **Formulate a Strategy:** Based on your analysis, create a step-by-step plan to construct a comprehensive and helpful response.\n5.  **Output:** Respond ONLY as JSON with keys: \`analysis\` (your analysis of the user's intent and context), \`ambiguities\` (any identified ambiguities), and \`plan\` (an array of detailed steps to take). Do NOT include the final answer.`;
            const roundsRequested = Math.max(1, Math.min(depthLevel, 3));
            let guidance = '';
            let finalPlan = '';
            let finalCritique = '';
            let finalConfidence = 0;
            let roundsCompleted = 0;

            for (let round = 1; round <= roundsRequested; round++) {
              roundsCompleted = round;
              const plannerPrompt = guidance
                ? `${basePlannerPrompt}\n6.  **Refinement Requirement:** Address the following critique when producing the updated plan.\n${guidance}`
                : `${basePlannerPrompt}\n6.  **Depth Requirement:** ${planConfig?.instruction ?? 'Provide the best possible plan.'}`;

              const plannerOpts: Record<string, number> = { ...llmOpts };
              if (planConfig?.maxTokens) {
                plannerOpts.num_predict = planConfig.maxTokens;
              } else if (plannerOpts.num_predict == null) {
                plannerOpts.num_predict = 768;
              }
              const plannerTemperature = Math.min(temperature, round >= 3 ? 0.3 : configIdx >= 3 ? 0.35 : configIdx === 2 ? 0.4 : 0.5);

              const planResp = await callLLM({
                role: 'planner',
                messages: [...history, { role: 'system', content: plannerPrompt }] as RouterMessage[],
                cognitiveMode: mode,
                options: {
                  temperature: plannerTemperature,
                  topP: 0.9,
                  repeatPenalty: 1.3,
                  maxTokens: plannerOpts.num_predict,
                },
              });
              const rawPlan = planResp.content.trim();
              let planSummary = '';
              try {
                const obj = JSON.parse(rawPlan);
                const analysis = Array.isArray(obj?.analysis)
                  ? obj.analysis.map((a: any) => String(a)).join('\n')
                  : typeof obj?.analysis === 'string'
                    ? obj.analysis
                    : '';
                const ambiguitiesList = Array.isArray(obj?.ambiguities)
                  ? obj.ambiguities.map((a: any) => String(a))
                  : obj?.ambiguities
                    ? [String(obj.ambiguities)]
                    : [];
                const steps: string[] = Array.isArray(obj?.plan)
                  ? obj.plan.map((s: any) => String(s))
                  : [];
                const considerations: string[] = Array.isArray(obj?.considerations)
                  ? obj.considerations.map((c: any) => String(c))
                  : [];
                const sections: string[] = [];
                if (analysis) sections.push(`Analysis:\n${analysis}`);
                if (ambiguitiesList.length) sections.push(`Ambiguities:\n${ambiguitiesList.map((a: string) => `- ${a}`).join('\n')}`);
                if (steps.length) sections.push(`Plan:\n${steps.map((s, idx) => `${idx + 1}. ${s}`).join('\n')}`);
                if (considerations.length) sections.push(`Considerations:\n${considerations.map(c => `- ${c}`).join('\n')}`);
                planSummary = sections.filter(Boolean).join('\n\n');
              } catch {
                planSummary = rawPlan.slice(0, 2000);
              }
              if (!planSummary) {
                planSummary = rawPlan.slice(0, 2000);
              }

              finalPlan = planSummary;
              emitReasoningStage('plan', round, planSummary);

              const criticPrompt = `You are a rigorous critique assistant evaluating the plan below for a conversational AI. Review the plan carefully. Respond ONLY as JSON with keys: \`approve\` (boolean), \`issues\` (array of strings describing problems), \`questions\` (array of follow-up questions or missing info), \`suggestions\` (array of improvements), and \`confidence\` (number between 0 and 1).\n\n[PLAN]\n${planSummary}`;
              const criticResp = await callLLM({
                role: 'planner',
                messages: [...history, { role: 'system', content: criticPrompt }] as RouterMessage[],
                cognitiveMode: mode,
                options: {
                  temperature: Math.min(0.4, plannerTemperature),
                  topP: 0.8,
                  repeatPenalty: 1.3,
                  maxTokens: llmOpts.num_predict,
                },
              });
              const rawCritique = criticResp.content.trim();
              let critiqueSummary = rawCritique;
              let guidanceForNext = '';
              let approve = false;
              let criticConfidence = 0;
              try {
                const obj = JSON.parse(rawCritique);
                approve = Boolean(obj?.approve);
                criticConfidence = Number(obj?.confidence) || 0;
                const issues: string[] = Array.isArray(obj?.issues) ? obj.issues.map((s: any) => String(s)) : [];
                const questions: string[] = Array.isArray(obj?.questions) ? obj.questions.map((s: any) => String(s)) : [];
                const suggestions: string[] = Array.isArray(obj?.suggestions) ? obj.suggestions.map((s: any) => String(s)) : [];
                const sections: string[] = [];
                if (issues.length) sections.push(`Issues:\n${issues.map(i => `- ${i}`).join('\n')}`);
                if (questions.length) sections.push(`Questions:\n${questions.map(q => `- ${q}`).join('\n')}`);
                if (suggestions.length) sections.push(`Suggestions:\n${suggestions.map(s => `- ${s}`).join('\n')}`);
                sections.push(`Confidence: ${(criticConfidence * 100).toFixed(0)}%`);
                critiqueSummary = sections.join('\n\n') || rawCritique;
                guidanceForNext = sections.filter(Boolean).join('\n');
                if (!guidanceForNext) {
                  guidanceForNext = rawCritique;
                }
              } catch {
                guidanceForNext = rawCritique;
              }

              finalCritique = critiqueSummary.slice(0, 2000);
              finalConfidence = Math.max(finalConfidence, Number.isFinite(criticConfidence) ? criticConfidence : 0);
              emitReasoningStage('critique', round, critiqueSummary);

              if (approve || round === roundsRequested) {
                emitReasoningStage('status', round, approve ? 'Critic approved the plan.' : 'Reached configured depth; proceeding with final answer.');
                break;
              }

              guidance = guidanceForNext;
            }

            const answerGuard = `Use the following internal plan silently to craft the final answer. Do not mention that you planned or show any steps. Provide only the final answer.`;
            const guidanceNote = finalCritique
              ? `\n\n[CRITIQUE NOTES]\n${finalCritique}`
              : '';
            const finalPlanSection = finalPlan ? `\n\n[APPROVED PLAN]\n${finalPlan}` : '';
            const answerResp = await callLLM({
              role: 'persona',
              messages: [...history, { role: 'system', content: `${answerGuard}${finalPlanSection}${guidanceNote}` }] as RouterMessage[],
              cognitiveMode: mode,
              options: {
                temperature,
                topP: 0.9,
                repeatPenalty: 1.3,
                maxTokens: llmOpts.num_predict,
              },
            });
            assistantResponse = answerResp.content || '';
          } else {
            // Refresh system prompt with current facet before generating response
            refreshSystemPrompt(m, sessionId, true);

            // Resolve and log the persona model being used
            const personaModel = resolveModelForCognitiveMode(cognitiveMode, 'persona' as ModelRole);
            const activeFacet = getActiveFacet();
            console.log(`[CHAT_REQUEST] Persona model: ${personaModel.id}, facet: ${activeFacet}`);

            let llmResponse: any;

            if (USE_COGNITIVE_PIPELINE) {
              // === PHASE 4.1a: Use PersonalityCoreLayer wrapper ===
              console.log('[CHAT_REQUEST] Using cognitive pipeline Layer 2');
              console.log(`[CHAT_REQUEST] Passing contextPackage with ${contextPackage?.memoryCount || 0} memories to Layer 2`);

              const layer2 = new PersonalityCoreLayer();
              const layer2Output = await layer2.process(
                {
                  // Pass pre-built chat history for full conversation context
                  chatHistory: history.map((h: ConversationMessage) => ({
                    role: h.role as 'system' | 'user' | 'assistant',
                    content: h.content
                  })),
                  // Pass actual contextPackage from Layer 1 (memory retrieval)
                  contextPackage: contextPackage || {},
                  userMessage: message
                },
                {
                  cognitiveMode,
                  previousLayers: [],
                  metadata: {
                    llmOptions: {
                      temperature,
                      topP: 0.9,
                      repeatPenalty: 1.3,
                      ...llmOpts
                    }
                  }
                }
              );

              // Convert Layer 2 output to format expected by existing code
              llmResponse = {
                content: layer2Output.response,
                model: layer2Output.metadata.modelUsed,
                thinking: '' // Layer 2 doesn't expose thinking field yet
              };
            } else {
              // === ORIGINAL CODE PATH ===
              // Build messages for this LLM call with ephemeral context injection
              const messagesForLLM = history.map((h: ConversationMessage) => ({
                role: h.role as 'system' | 'user' | 'assistant',
                content: h.content
              }));

              // Inject context ONLY for this call (not saved to history)
              // Insert after system prompt but before conversation
              if (contextInfo) {
                const systemPromptIndex = messagesForLLM.findIndex(msg => msg.role === 'system');
                const insertIndex = systemPromptIndex >= 0 ? systemPromptIndex + 1 : 0;

                messagesForLLM.splice(insertIndex, 0, {
                  role: 'system',
                  content: `## Background Context\n${contextInfo}`
                });

                // Add priority instruction if enabled
                if (chatSettings.userInputPriority) {
                  messagesForLLM.push({
                    role: 'system',
                    content: `**Priority**: Answer the user's direct question. Use personality and context to inform your response, but focus on what they're actually asking.`
                  });
                }
              }

              // Use role-based routing for persona responses
              llmResponse = await callLLM({
                role: 'persona' as ModelRole,
                messages: messagesForLLM,
                cognitiveMode,
                options: {
                  temperature,
                  topP: 0.9,
                  repeatPenalty: 1.3,
                  ...llmOpts
                }
              });
            }

            // For backward compatibility, construct response object matching ollama.chat format
            const response = {
              message: {
                content: llmResponse.content,
                thinking: (llmResponse as any).thinking || ''
              },
              model: llmResponse.model,
            };

            // Handle Qwen3 thinking mode: content is in thinking field, actual answer often isn't separated
            const thinking = (response.message as any).thinking || '';
            const content = response.message.content || '';

            console.log('[persona_chat] DEBUG - thinking length:', thinking.length, 'content length:', content.length);

            // If reasoning is enabled and we have thinking, stream it first
            if (reasoningRequested && thinking) {
              emitReasoningStage('thought', 1, thinking);
            }

          const extractFromThinking = (text: string) => {
            const trimmed = (text || '').trim();
            if (!trimmed) return '';

            // Prefer the last quoted span – Qwen often frames the final reply this way
            const quotedMatches = Array.from(trimmed.matchAll(/["“”](.+?)["“”]/gs))
              .map(m => (m[1] || '').trim())
              .filter(Boolean);
            if (quotedMatches.length > 0) {
              return quotedMatches[quotedMatches.length - 1];
            }

            // Fall back to the last non-empty paragraph
            const paragraphs = trimmed.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
            if (paragraphs.length > 0) {
              const lastPara = paragraphs[paragraphs.length - 1];
              if (lastPara) return lastPara;
            }

            // As a final fallback, take the last couple of sentences
            const sentences = trimmed.split(/(?<=[.!?])\s+/).filter(Boolean);
            return sentences.slice(-3).join(' ').trim();
          };

          const looksLikeReasoning = (text: string) => {
            const sample = (text || '').toLowerCase();
            if (!sample) return true;
            const reasoningPhrases = [
              'the user',
              'i should',
              'i need to',
              'let me',
              'plan',
              'strategy',
              'consider',
              'decide',
              'maybe i',
            ];
            const hasSecondPerson = /\byou\b/i.test(text);
            const hasGreeting = /\b(hello|hi|hey|greetings)\b/i.test(text);
            const looksLikeSentence = /[.!?]["”']?$/.test(text.trim());
            const isReasoningHint = reasoningPhrases.some(p => sample.includes(p));
            // Treat it as reasoning if we detect planning language without an obvious second-person answer
            return isReasoningHint && !hasSecondPerson && !hasGreeting ? true : !looksLikeSentence;
          };

            // Qwen3 puts everything in thinking, content is often empty
            // When content is empty, we need to extract the answer from thinking
            if (content) {
              assistantResponse = content;
            } else if (thinking) {
              // Try to extract the final answer from thinking text
              let extracted = extractFromThinking(thinking);

              // If it still looks like planning notes, run a focused follow-up pass
              if (!extracted || looksLikeReasoning(extracted)) {
                const followMessages = [
                  {
                    role: 'system',
                    content: 'You are finalizing a conversation response. The user should only see the finished reply. Do not reveal any internal reasoning or mention that you were given it.',
                  },
                  {
                    role: 'user',
                    content: `User message:\n"${message}"\n\nInternal reasoning you produced earlier:\n${thinking}\n\nNow respond to the user. Output only the final reply text they should see.`,
                  },
                ] as ConversationMessage[];
                try {
                  const followResp = await callLLM({
                    role: 'persona',
                    messages: followMessages as RouterMessage[],
                    cognitiveMode: mode,
                    options: {
                      temperature,
                      topP: 0.9,
                      repeatPenalty: 1.3,
                      maxTokens: llmOpts.num_predict,
                    },
                  });

                  extracted = followResp.content || extracted;
                } catch (followError) {
                  console.error('[persona_chat] follow-up extraction failed:', followError);
                }
              }

              assistantResponse = extracted || thinking; // Final fallback to full thinking
            } else {
              assistantResponse = ''; // No response at all
            }

            console.log('[persona_chat] DEBUG - final assistantResponse:', assistantResponse.slice(0, 100));
          }

          // No brevity rules - let the model output freely
          const cleanedAssistant = stripChainOfThought(assistantResponse);
          assistantResponse = cleanedAssistant.length > 0 ? cleanedAssistant : '';

          // === PHASE 4.2: Safety validation (non-blocking) ===
          let safetyResult: any = undefined;
          if (USE_COGNITIVE_PIPELINE && ENABLE_SAFETY_CHECKS && assistantResponse) {
            try {
              safetyResult = await checkResponseSafety(assistantResponse, {
                threshold: 0.7,
                cognitiveMode,
                logToConsole: true,
                auditIssues: true
              });

              // Log safety status (response is never blocked)
              if (!safetyResult.safe) {
                console.warn(`[SAFETY] Response has ${safetyResult.issues.length} safety issue(s) but is not blocked (Phase 4.2)`);
              } else {
                console.log(`[SAFETY] Response passed safety checks (score: ${(safetyResult.score * 100).toFixed(1)}%)`);
              }
            } catch (error) {
              console.error('[SAFETY] Check failed (non-blocking):', error);
              // Continue anyway - safety failures don't block responses
            }
          }

          // === PHASE 4.3: Response refinement (non-blocking) ===
          if (USE_COGNITIVE_PIPELINE && ENABLE_RESPONSE_REFINEMENT && safetyResult && !safetyResult.safe) {
            try {
              const refinementResult = await refineResponseSafely(assistantResponse, safetyResult, {
                logToConsole: true,
                auditChanges: true,
                cognitiveMode
              });

              if (refinementResult.changed) {
                console.log(`[REFINEMENT] Response refined (${refinementResult.changes.length} changes):`);
                console.log(`  - Original length: ${refinementResult.original.length} chars`);
                console.log(`  - Refined length: ${refinementResult.refined.length} chars`);
                console.log(`  - Issues fixed: ${refinementResult.safetyIssuesFixed}`);
                console.log(`  - Changes:`);
                for (const change of refinementResult.changes) {
                  console.log(`    • ${change.type}: ${change.description}`);
                }

                // === PHASE 4.4: Blocking mode decision ===
                if (ENABLE_BLOCKING_MODE) {
                  // Send refined response to user (blocking mode)
                  assistantResponse = refinementResult.refined;
                  console.log(`  [BLOCKING MODE] Sending REFINED response to user`);
                  console.log(`  [INFO] Original preserved in audit logs for review`);
                } else {
                  // Phase 4.3 behavior: send original (non-blocking mode)
                  console.log(`  [NON-BLOCKING MODE] Sending ORIGINAL response to user`);
                  console.log(`  [INFO] Refined response logged for testing only`);
                }
              } else {
                console.log(`[REFINEMENT] No changes needed (response already safe)`);
              }
            } catch (error) {
              console.error('[REFINEMENT] Failed (non-blocking):', error);
              // Continue anyway - refinement failures don't block responses
            }
          }

          // Send response to client via EventSource stream
          push('content', { content: assistantResponse });
          const activeFacet = getActiveFacet();

          // Store history (pass push as stream notifier for summarization status)
          history.pop();
          pushMessage(m, { role: 'user', content: message }, sessionId, push);
          pushMessage(m, { role: 'assistant', content: assistantResponse, meta: { facet: activeFacet } }, sessionId, push);

          // Capture event and audit (if user is authenticated)
          // Note: cognitiveMode and allowMemoryWrites are already loaded at function start
          const eventType = m === 'inner' ? 'inner_dialogue' : 'conversation';
          const canPersistConversation = policyCanWriteMemory(cognitiveMode, eventType);
          const responseForMemory = assistantResponse && assistantResponse.trim().length > 0 ? assistantResponse.trim() : undefined;

          if (canPersistConversation) {
            const metadata: any = {
              cognitiveMode: cognitiveMode,
              conversationId: sessionId || undefined,
              timestamp: new Date().toISOString(),
              usedOperator: false,
            };

            // Link to curiosity question if provided (via reply-to system)
            if (replyToQuestionId) {
              metadata.curiosity = {
                answerTo: replyToQuestionId
              };
            }

            // Store reply-to context for downstream agents
            if (replyToMessage) {
              metadata.replyTo = {
                content: replyToMessage.substring(0, 500), // Truncate to avoid bloat
                source: replyToQuestionId ? 'curiosity' : 'message_selection'
              };
            }

            // If replying to a curiosity question, save the question first
            // NOTE: replyToMessage and curiosityData were already fetched earlier (line 871), so we can reuse them
            if (replyToQuestionId && replyToMessage && curiosityData) {
              console.log(`[persona_chat] Saving curiosity question before answer: ${replyToQuestionId}`);
              captureEvent(replyToMessage, {
                type: 'conversation',
                tags: ['chat', 'conversation', 'curiosity', 'assistant'],
                metadata: {
                  curiosity: curiosityData,
                  cognitiveMode: 'dual',
                  usedOperator: false,
                }
              });
            } else if (replyToQuestionId && !curiosityData) {
              console.warn(`[persona_chat] Could not retrieve curiosity question: ${replyToQuestionId}`);
            }

            const userPath = captureEvent(`Me: "${message}"`, {
              type: eventType,
              tags: ['chat', m],
              response: responseForMemory,
              metadata,
            });
            const userRelPath = path.relative(ROOT, userPath);

            audit({
              level: 'info',
              category: 'action',
              event: 'chat_assistant',
              details: { mode: m, content: assistantResponse, cognitiveMode, usedOperator: false },
              actor: 'assistant'
            });

            // Get active facet for color-coding
            // Stream the final answer with save confirmation
            push('answer', { response: assistantResponse, saved: { userRelPath }, facet: activeFacet });
          } else {
            const auditEvent = allowMemoryWrites ? 'chat_assistant_ephemeral' : 'chat_assistant_readonly';
            audit({
              level: 'info',
              category: 'action',
              event: auditEvent,
              details: { mode: m, content: assistantResponse, cognitiveMode, usedOperator: false },
              actor: 'assistant'
            });

            // Get active facet for color-coding
            // Stream the final answer without save confirmation
            push('answer', { response: assistantResponse, facet: activeFacet });
          }

        } catch (error) {
          console.error('Persona chat stream error:', error);
          audit({
            level: 'error',
            category: 'action',
            event: 'chat_assistant_error',
            details: { mode: m, error: (error as Error).message, cognitiveMode, usedOperator: false },
            actor: 'assistant'
          });
          push('error', { message: (error as Error).message });
        } finally {
          isClosed = true;
          try {
            controller.close();
          } catch (error) {
            // Already closed, ignore
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    history.pop();
    console.error('Persona chat API error:', error);
    audit({
      level: 'error',
      category: 'action',
      event: 'chat_handler_error',
      details: { mode: m, error: (error as Error).message, cognitiveMode },
      actor: 'system'
    });
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500 });
  }
};
