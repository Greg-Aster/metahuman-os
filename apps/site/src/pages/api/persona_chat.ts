import type { APIRoute } from 'astro';
import { loadPersonaCore, loadPersonaWithFacet, getActiveFacet, ollama, captureEvent, ROOT, listActiveTasks, audit, getIndexStatus, queryIndex, buildRagContext, searchMemory, loadTrustLevel, callLLM, type ModelRole, type RouterMessage, getOrchestratorContext, getPersonaContext, updateConversationContext, updateCurrentFocus, resolveModelForCognitiveMode, buildContextPackage, formatContextForPrompt, PersonalityCoreLayer, checkResponseSafety, refineResponseSafely, pruneHistory, type Message, getUserContext, getConversationBufferPath } from '@metahuman/core';
import { loadCognitiveMode, getModeDefinition, canWriteMemory as modeAllowsMemoryWrites, canUseOperator } from '@metahuman/core/cognitive-mode';
import { canWriteMemory as policyCanWriteMemory } from '@metahuman/core/memory-policy';
import { loadChatSettings } from '@metahuman/core/chat-settings';
import { readFileSync, existsSync, appendFileSync, writeFileSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { initializeSkills } from '../../../../../brain/skills/index';
import { getAvailableSkills, executeSkill, type SkillManifest } from '@metahuman/core/skills';
import { withUserContext } from '../../middleware/userContext';

type Role = 'system' | 'user' | 'assistant';
type Mode = 'inner' | 'conversation';

// Ensure skill registry is ready for any inline tool invocations from persona_chat.
initializeSkills();

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

// In-memory message histories per mode
// NOTE: These are automatically pruned to stay within token limits (max 20 messages / ~8k tokens)
const histories: Record<Mode, Array<{ role: Role; content: string; meta?: any }>> = {
  inner: [],
  conversation: [],
};

const historyLoadedForUser: Record<Mode, string | null> = {
  inner: null,
  conversation: null,
};

const bufferMeta: Record<Mode, { lastSummarizedIndex: number | null }> = {
  inner: { lastSummarizedIndex: null },
  conversation: { lastSummarizedIndex: null }
};

function getBufferPath(mode: Mode): string | null {
  try {
    return getConversationBufferPath(mode);
  } catch (error) {
    console.warn('[persona_chat] Failed to determine buffer path:', error);
    return null;
  }
}

function loadPersistedBuffer(mode: Mode): Array<{ role: Role; content: string; meta?: any }> {
  const bufferPath = getBufferPath(mode);
  if (!bufferPath || !existsSync(bufferPath)) return [];

  try {
    const raw = readFileSync(bufferPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const persistedMessages: Array<{ role: Role; content: string; meta?: any }> = Array.isArray(parsed.messages)
      ? parsed.messages
      : [];
    const persistedSummaryMarkers: Array<{ role: Role; content: string; meta?: any }> = Array.isArray(parsed.summaryMarkers)
      ? parsed.summaryMarkers
      : persistedMessages.filter(msg => msg.meta?.summaryMarker);

    // Remove any summary markers from the main messages array to avoid duplication
    const conversationMessages = persistedMessages.filter(msg => !msg.meta?.summaryMarker);

    const combined = [...conversationMessages];
    if (persistedSummaryMarkers.length > 0) {
      if (
        combined.length > 0 &&
        combined[0].role === 'system' &&
        !combined[0].meta?.summaryMarker
      ) {
        combined.splice(1, 0, ...persistedSummaryMarkers);
      } else {
        combined.unshift(...persistedSummaryMarkers);
      }
    }

    const derivedLastSummarized =
      typeof parsed.lastSummarizedIndex === 'number'
        ? parsed.lastSummarizedIndex
        : (persistedSummaryMarkers.length > 0
            ? persistedSummaryMarkers.reduce((max, marker) => {
                const count = marker.meta?.summaryCount;
                return typeof count === 'number' && count > max ? count : max;
              }, 0)
            : null);

    bufferMeta[mode].lastSummarizedIndex = derivedLastSummarized ?? null;
    return combined;
  } catch (error) {
    console.warn('[persona_chat] Failed to load conversation buffer:', error);
  }

  bufferMeta[mode].lastSummarizedIndex = null;
  return [];
}

function persistBuffer(mode: Mode): void {
  const bufferPath = getBufferPath(mode);
  if (!bufferPath) return;

  try {
    const summaryMarkers = histories[mode].filter(msg => msg.meta?.summaryMarker);
    const conversationMessages = histories[mode].filter(msg => !msg.meta?.summaryMarker);
    const payload = JSON.stringify(
      {
        summaryMarkers,
        messages: conversationMessages,
        lastSummarizedIndex: bufferMeta[mode].lastSummarizedIndex,
        lastUpdated: new Date().toISOString(),
      },
      null,
      2
    );
    writeFileSync(bufferPath, payload);
  } catch (error) {
    console.warn('[persona_chat] Failed to persist conversation buffer:', error);
  }
}

function ensureHistoryLoaded(mode: Mode): void {
  const ctx = getUserContext();
  const userId = ctx?.userId || 'anonymous';
  if (historyLoadedForUser[mode] === userId && histories[mode].length > 0) {
    return;
  }

  histories[mode] = loadPersistedBuffer(mode);
  historyLoadedForUser[mode] = userId;
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
    content: `Conversation summary (messages 0-${rangeEnd}): ${summary.summary}`,
    meta: {
      summaryMarker: true,
      sessionId: summary.sessionId,
      createdAt,
      range: { start: 0, end: rangeEnd },
      summaryCount: summary.messageCount
    }
  };

  histories[mode] = histories[mode].filter(
    msg => !(msg.meta?.summaryMarker && msg.meta.sessionId === summary.sessionId)
  );

  const insertionIndex =
    histories[mode].length > 0 &&
    histories[mode][0].role === 'system' &&
    !histories[mode][0].meta?.summaryMarker
      ? 1
      : 0;

  histories[mode].splice(insertionIndex, 0, marker);
  bufferMeta[mode].lastSummarizedIndex = summary.messageCount;
  persistBuffer(mode);
}

/**
 * Add message to history and automatically prune to stay within limits
 * Triggers auto-summarization when pruning occurs (Phase 3: Memory Continuity)
 */
function pushMessage(mode: Mode, message: { role: Role; content: string; meta?: any }, sessionId?: string): void {
  const beforeCount = histories[mode].length;
  histories[mode].push(message);

  // Auto-prune to stay within token/message limits
  histories[mode] = pruneHistory(histories[mode] as Message[], {
    maxTokens: 8000,
    maxMessages: 20,
    preserveSystemMessages: true,
  }) as Array<{ role: Role; content: string; meta?: any }>;

  const afterCount = histories[mode].length;
  if (beforeCount + 1 !== afterCount) {
    console.log(`[context-window] Pruned ${mode} history: ${beforeCount + 1} → ${afterCount} messages`);

    // Trigger async summarization when buffer overflow occurs (Phase 3)
    if (sessionId) {
      triggerAutoSummarization(sessionId, mode).catch(error => {
        console.error('[auto-summarization] Failed to trigger summarization:', error);
      });
    }
  }

  persistBuffer(mode);
}

/**
 * Trigger background summarization for a conversation session
 * Phase 3: Memory Continuity - auto-summarize when buffer overflows
 */
async function triggerAutoSummarization(sessionId: string, mode: Mode): Promise<void> {
  try {
    // Import summarizer dynamically to avoid circular dependencies
    const { summarizeSession } = await import('../../../../../brain/agents/summarizer.js');

    console.log(`[auto-summarization] Triggering summarization for session: ${sessionId}`);

    // Run summarization in background (don't await - let it run async)
    void summarizeSession(sessionId, { bufferMode: mode })
      .then(summary => {
        if (summary) {
          upsertSummaryMarker(mode, summary);
        }
        console.log(`[auto-summarization] Successfully summarized session: ${sessionId}`);
      })
      .catch(error => {
        console.error(`[auto-summarization] Summarization failed for session ${sessionId}:`, error);
      });
  } catch (error) {
    console.error('[auto-summarization] Failed to import summarizer:', error);
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



async function getRelevantContext(
  userMessage: string,
  mode: Mode,
  sessionId: string,
  opts?: { usingLora?: boolean; includePersonaSummary?: boolean; replyToMessage?: string }
): Promise<{ context: string; usedSemantic: boolean; contextPackage: any }> {
  try {
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
      forceSemanticSearch: cognitiveMode === 'dual', // Dual mode requires semantic
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
  } else {
    systemPrompt = mode === 'inner'
      ? 'You are having an internal dialogue with yourself.'
      : 'You are having a conversation.';
  }
  return systemPrompt;
}

function initializeChat(mode: Mode, reason = false, usingLora = false, includePersonaSummary = true): void {
  const systemPrompt = buildSystemPrompt(mode, includePersonaSummary);
  histories[mode] = [{ role: 'system', content: systemPrompt }];
  bufferMeta[mode].lastSummarizedIndex = null;
  persistBuffer(mode);
}

/**
 * Update the system prompt with current facet (refreshes persona without clearing history)
 */
function refreshSystemPrompt(mode: Mode, includePersonaSummary = true): void {
  if (histories[mode].length > 0 && histories[mode][0].role === 'system') {
    // Update existing system prompt
    histories[mode][0].content = buildSystemPrompt(mode, includePersonaSummary);
  } else {
    // No history yet, initialize it
    initializeChat(mode, false, false, includePersonaSummary);
  }
  persistBuffer(mode);
}

// Wrap GET and POST with user context middleware for automatic profile path resolution
export const GET: APIRoute = withUserContext(async (context) => {
  const { request, cookies } = context;
  const url = new URL(request.url);
  const message = url.searchParams.get('message') || '';
  const mode = url.searchParams.get('mode') || 'inner';
  const newSession = url.searchParams.get('newSession') === 'true';
  const questionId = url.searchParams.get('questionId') || undefined;
  const audience = url.searchParams.get('audience') || undefined;
  const length = url.searchParams.get('length') || 'auto';
  const reason = url.searchParams.get('reason') === 'true';
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

  return handleChatRequest({ message, mode, newSession, audience, length, reason, reasoningDepth, llm, forceOperator, yolo, sessionId, replyToQuestionId, replyToContent, origin: url.origin, cookies });
});

export const POST: APIRoute = withUserContext(async ({ request, cookies }) => {
  const url = new URL(request.url);
  const body = await request.json();
  return handleChatRequest({ ...body, origin: url.origin, cookies });
});

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
  const personaContext = `You are ${persona.identity.name}.
Your role: ${persona.identity.role}
Your purpose: ${persona.identity.purpose}

Your communication style: ${persona.personality.communicationStyle.tone.join(', ')}
Your values: ${persona.values.core.map((v: any) => v.value).join(', ')}`;

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

async function handleChatRequest({ message, mode = 'inner', newSession = false, audience, length, reason, reasoningDepth, llm, forceOperator = false, yolo = false, sessionId, replyToQuestionId, replyToContent, origin, cookies }: { message: string; mode?: string; newSession?: boolean; audience?: string; length?: string; reason?: boolean; reasoningDepth?: number; llm?: any; forceOperator?: boolean; yolo?: boolean; sessionId?: string; replyToQuestionId?: string; replyToContent?: string; origin?: string; cookies?: any }) {
  console.log(`\n[CHAT_REQUEST] Received: "${message}"`);
  const m: Mode = mode === 'conversation' ? 'conversation' : 'inner';
  ensureHistoryLoaded(m);

  let model;
  let usingLora = false;
  let includePersonaSummary = true;
  const depthCandidate = Number(reasoningDepth);
  let depthLevel = Number.isFinite(depthCandidate) ? Math.max(0, Math.min(3, Math.round(depthCandidate))) : undefined;
  if (depthLevel === undefined) {
    depthLevel = reason ? 1 : 0;
  }
  const reasoningRequested = depthLevel > 0;

  try {
    const { loadModelRegistry } = await import('@metahuman/core');
    const registry = loadModelRegistry();
    const fallbackId = registry.defaults?.fallback || 'default.fallback';
    const fallbackModel = registry.models?.[fallbackId];
    if (!fallbackModel?.model) {
      throw new Error('Default fallback model not configured in etc/models.json');
    }

    const globalSettings = registry.globalSettings || {};
    includePersonaSummary = globalSettings.includePersonaSummary !== false;
    try {
      if (getActiveFacet() === 'inactive') {
        includePersonaSummary = false;
      }
    } catch {
      // ignore facet errors for guests
    }

    // Use adapter if enabled, otherwise use base model
    if (globalSettings.useAdapter && globalSettings.activeAdapter) {
      const adapterInfo = typeof globalSettings.activeAdapter === 'string'
        ? globalSettings.activeAdapter
        : globalSettings.activeAdapter.modelName;
      model = adapterInfo;
      usingLora = true;
    } else {
      model = fallbackModel.model;
      usingLora = false;
    }
  } catch (error) {
    console.error('[persona_chat] Fatal: Could not determine model.', error);
    return new Response(JSON.stringify({ error: 'Could not determine model: ' + (error as Error).message }), { status: 500 });
  }

  // Check if user is authenticated (has session cookie)
  const sessionCookie = cookies?.get('mh_session');
  const isAuthenticated = !!sessionCookie;

  // Resolve user context up front so downstream routing can respect role-based restrictions
  const currentCtx = getUserContext();
  const userRole = currentCtx?.role ?? 'anonymous';
  // Allow operator ONLY for the profile owner
  // Guests and anonymous users get chat-only mode (no skill execution)
  const operatorRoleAllowed = userRole === 'owner';

  // Load cognitive mode context once for consistent routing and memory policies
  // For unauthenticated users, force emulation mode (read-only, safe for guests)
  const cognitiveContext = getCognitiveModeContext();
  const cognitiveMode: 'dual' | 'agent' | 'emulation' = isAuthenticated ? cognitiveContext.mode : 'emulation';
  const allowMemoryWrites = isAuthenticated ? cognitiveContext.allowMemoryWrites : false;

  const trimmedMessage = String(message ?? '').trim();
  const recentDialogue = histories[m]
    .filter(turn => turn.role !== 'system')
    .slice(-8)
    .map(turn => {
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

  // Get relevant context (memories + tasks) BEFORE routing decision
  // This context will be used by both operator and chat paths
  // Pass reply-to message so it gets injected at the top of context
  const { context: contextInfo, usedSemantic, contextPackage } = await getRelevantContext(
    message, m, sessionId,
    { usingLora, includePersonaSummary, replyToMessage }
  );
  console.log(`[CHAT_REQUEST] Context retrieved. Length: ${contextInfo.length}, Semantic Search: ${usedSemantic}, Memories: ${contextPackage?.memoryCount || 0}, ReplyTo: ${!!replyToMessage}`);

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
        username: currentCtx?.username || 'anonymous',
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

    histories[m].push({
      role: 'system',
      content: authWarning
    });
    persistBuffer(m);
  }

  if (useOperator) {
    // Stream the operator response
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

        const eventType = m === 'inner' ? 'inner_dialogue' : 'conversation';
        const canCaptureConversation = policyCanWriteMemory(cognitiveMode, eventType);
        let userEventPath: string | null = null;
        let userEventId: string | undefined;

        if (canCaptureConversation) {
          try {
            const metadata: any = {
              cognitiveMode,
              conversationId: sessionId || undefined,
              timestamp: new Date().toISOString(),
              usedOperator: true,
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
                  usedOperator: true, // Changed to true since we're in operator path
                }
              });
            } else if (replyToQuestionId && !curiosityData) {
              console.warn(`[persona_chat] Could not retrieve curiosity question: ${replyToQuestionId}`);
            }

            userEventPath = captureEvent(`Me: "${message}"`, {
              type: eventType,
              tags: ['chat', m],
              metadata,
            });
            userEventId = userEventPath ? extractEventIdFromFile(userEventPath) : undefined;
          } catch (error) {
            console.warn('[persona_chat] Failed to capture user message before operator run:', error);
            userEventPath = null;
            userEventId = undefined;
          }
        }

        try {
          lastUserTurn[m] = { text: trimmedMessage, ts: Date.now() };
          pushMessage(m, { role: 'user', content: message }, sessionId);

          // Build operator context with recent conversation history AND memory context
          let operatorContext = '';

          // MEMORY CONTEXT: Add retrieved memories from semantic search (if available)
          if (contextInfo && contextInfo.length > 0) {
            operatorContext += '# Memory Context\n';
            operatorContext += contextInfo + '\n\n';
          }

          // CONVERSATION HISTORY: Include last 5-10 turns for context (excluding current message which is already in 'goal')
          const recentHistory = histories[m].slice(-11, -1); // Last 10 messages before current
          if (recentHistory.length > 0) {
            operatorContext += '# Recent Conversation\n';
            for (const turn of recentHistory) {
              const label = turn.role === 'user' ? 'User' : turn.role === 'assistant' ? 'Assistant' : 'System';
              // Don't truncate assistant messages with operator results - they contain important context
              const hasOperatorResults = turn.role === 'assistant' && turn.meta?.operatorReport;
              const contentLimit = hasOperatorResults ? 1500 : 500;
              operatorContext += `${label}: ${turn.content.substring(0, contentLimit)}\n`;

              // Extract operator execution results from assistant messages (meta field)
              if (turn.role === 'assistant' && turn.meta?.operatorReport) {
                const report = turn.meta.operatorReport;
                operatorContext += `  [Operator executed: `;
                if (report.plan?.steps) {
                  const stepSummaries = report.plan.steps.map((s: any) => `${s.skillId}`).join(', ');
                  operatorContext += `${stepSummaries}]\n`;
                }
                if (report.results?.steps) {
                  for (const stepResult of report.results.steps) {
                    if (stepResult.success && stepResult.outputs) {
                      // Include key execution results for context
                      if (stepResult.outputs.items && Array.isArray(stepResult.outputs.items)) {
                        operatorContext += `    Found ${stepResult.outputs.items.length} items: ${stepResult.outputs.items.slice(0, 5).join(', ')}${stepResult.outputs.items.length > 5 ? '...' : ''}\n`;
                      }
                      if (stepResult.outputs.path) {
                        operatorContext += `    Located file: ${stepResult.outputs.path}\n`;
                      }
                    }
                  }
                }
              }
            }
            operatorContext += '\n';
          }

          // Add routing context if provided
          if (routingContext) {
            operatorContext += `# Routing Context\n${routingContext}\n`;
          }

          // RESPONSE LENGTH PREFERENCE: Light hint only - let AI adapt naturally
          if (length === 'concise') {
            operatorContext += `# User Preference\nConcise responses preferred.\n\n`;
          } else if (length === 'detailed') {
            operatorContext += `# User Preference\nDetailed responses preferred.\n\n`;
          }
          // 'auto' = no hint, let the AI decide based on context

          // Use ReAct operator for dynamic observation-based execution
          const operatorUrl = origin ? new URL('/api/operator/react', origin).toString() : '/api/operator/react';

          // Build headers with session cookie to pass through authentication
          const operatorHeaders: Record<string, string> = {
            'Content-Type': 'application/json'
          };

          // Forward session cookie for authentication
          const sessionCookie = cookies.get('mh_session');
          if (sessionCookie) {
            operatorHeaders['Cookie'] = `mh_session=${sessionCookie.value}`;
          }

          const operatorResponse = await fetch(operatorUrl, {
            method: 'POST',
            headers: operatorHeaders,
            body: JSON.stringify({
              goal: message,
              context: operatorContext,
              autoApprove: true,
              reasoningDepth: depthLevel,  // Pass reasoning slider value (0-3)
              profile: (typeof audience === 'string' && ['files','git','web'].includes(audience) ? audience : undefined),
              yolo,
              allowMemoryWrites, // Pass cognitive mode memory write permission to operator
              sessionId,
              userEventId,
            }),
          });

          if (!operatorResponse.ok) {
            throw new Error(`Operator API failed with status ${operatorResponse.status}`);
          }

          const result = await operatorResponse.json();
          const formattedResult = formatOperatorResult(result);

          // Preserve the raw operator data in history for follow-up questions
          pushMessage(m, { role: 'system', content: `## Operator Findings\n${formattedResult}` }, sessionId);

          let synthesized = formattedResult;
          try {
            synthesized = await synthesizeOperatorAnswer(model, message, formattedResult, cognitiveMode);
          } catch (err) {
            console.error('[persona_chat] Failed to synthesize operator answer:', err);
          }

          // Audit operator execution with cognitive mode tracking
          audit({
            level: 'info',
            category: 'action',
            event: 'chat_assistant',
            details: { mode: m, content: synthesized, cognitiveMode, usedOperator: true },
            actor: 'assistant'
          });

          if (userEventPath) {
            await appendResponseToEvent(userEventPath, synthesized);
          }

          push('answer', { response: synthesized });

          pushMessage(m, {
            role: 'assistant',
            content: synthesized,
            meta: {
              operatorReport: result,
              operatorSummary: formattedResult,
              operatorGoal: message,
              usedOperator: true,
              completedAt: new Date().toISOString()
            }
          }, sessionId);
          lastAssistantReplies[m].push(synthesized);
        } catch (error) {
          console.error('[persona_chat] Operator error:', error);
          audit({
            level: 'error',
            category: 'action',
            event: 'chat_assistant_error',
            details: { mode: m, error: (error as Error).message, cognitiveMode, usedOperator: true },
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
  }

  // If not using the operator, proceed with the normal chat flow
  console.log(`[${new Date().toISOString()}] handleChatRequest: mode=${m}, history length=${histories[m].length}`);
  console.log(JSON.stringify(histories[m], null, 2));

  if (newSession || histories[m].length === 0) {
    initializeChat(m, reasoningRequested, usingLora, includePersonaSummary);
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

  if (m === 'conversation' && audience && forceOperator) {
    pushMessage(m, { role: 'system', content: `Audience/context: ${audience}` }, sessionId);
  }

  // Note: Context already retrieved earlier (line 525) and available as contextInfo, usedSemantic, contextPackage

  // Load chat settings to configure response behavior
  const chatSettings = loadChatSettings();

  // Add user message and context to history
  // NOTE: The context is added as a separate system message to make it clear to the model what is the user's message and what is context.
  // Appending the context to the user's message can confuse the model and cause it to repeat the context.
  if (contextInfo) {
    pushMessage(m, { role: 'system', content: `## Background Context\n${contextInfo}` }, sessionId);
  }

  // Add user input priority instruction if enabled
  if (chatSettings.userInputPriority && contextInfo) {
    pushMessage(m, { role: 'system', content: `**Priority**: Answer the user's direct question below. Use personality and context to inform your response, but focus on what they're actually asking.` }, sessionId);
  }

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
                messages: [...histories[m], { role: 'system', content: plannerPrompt }] as RouterMessage[],
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
                if (ambiguitiesList.length) sections.push(`Ambiguities:\n${ambiguitiesList.map(a => `- ${a}`).join('\n')}`);
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
                messages: [...histories[m], { role: 'system', content: criticPrompt }] as RouterMessage[],
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
              messages: [...histories[m], { role: 'system', content: `${answerGuard}${finalPlanSection}${guidanceNote}` }] as RouterMessage[],
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
            refreshSystemPrompt(m, includePersonaSummary);

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
                  chatHistory: histories[m].map(h => ({
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
                model: layer2Output.voiceMetrics.model,
                thinking: '' // Layer 2 doesn't expose thinking field yet
              };
            } else {
              // === ORIGINAL CODE PATH ===
              // Let the model work naturally without extra instructions
              // Use role-based routing for persona responses
              llmResponse = await callLLM({
                role: 'persona' as ModelRole,
                messages: histories[m].map(h => ({
                  role: h.role as 'system' | 'user' | 'assistant',
                  content: h.content
                })),
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
                ] as typeof histories[m];
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

          // Store history
          histories[m].pop();
          pushMessage(m, { role: 'user', content: message }, sessionId);
          pushMessage(m, { role: 'assistant', content: assistantResponse }, sessionId);

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
            const activeFacet = getActiveFacet();

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
            const activeFacet = getActiveFacet();

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
    histories[m].pop();
    persistBuffer(m);
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
