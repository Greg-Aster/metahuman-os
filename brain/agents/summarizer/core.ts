/**
 * Conversation Summarizer Agent — Core Logic
 *
 * Summarizes conversation sessions into concise overviews.
 * - Analyzes conversations by session ID
 * - Generates summaries of key topics, decisions, and outcomes
 * - Stores summaries as episodic events
 * - Mode-aware behavior (dual/agent get summaries, emulation uses ephemeral)
 */

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import {
  callLLM,
  type RouterMessage,
  captureEvent,
  listEpisodicFiles,
  audit,
  loadPersonaCore,
  getTargetUser,
  withUserContext,
  getUserContext,
  loadCognitiveMode,
  markSummarizing,
  markSummaryCompleted,
  clearSummaryMarker,
  isSummarizing,
  getConversationBufferPath,
} from '@metahuman/core';
import { canWriteMemory } from '@metahuman/core/cognitive-mode';
import fs from 'node:fs/promises';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface ConversationEvent {
  id: string;
  timestamp: string;
  content: string;
  type: string;
  response?: string;
  metadata?: {
    conversationId?: string;
    sessionId?: string;
    toolName?: string;
    cognitiveMode?: string;
    usedOperator?: boolean;
    [key: string]: any;
  };
}

export interface ConversationSummary {
  sessionId: string;
  startTime: string;
  endTime: string;
  messageCount: number;
  toolsUsed: string[];
  keyTopics: string[];
  decisions: string[];
  outcomes: string[];
  summary: string;
  mode: string;
}

export interface SummarizerOptions {
  sessionId?: string;
  auto?: boolean;
  username?: string;
  bufferMode?: 'conversation' | 'inner';
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────

async function loadRecentEvents(lookbackDays: number, userId?: string): Promise<ConversationEvent[]> {
  const cutoff = Date.now() - lookbackDays * DAY_MS;
  const files = listEpisodicFiles();
  const events: ConversationEvent[] = [];

  for (const file of files) {
    try {
      const raw = await fs.readFile(file, 'utf-8');
      const event = JSON.parse(raw) as ConversationEvent;
      const ts = new Date(event.timestamp).getTime();
      if (Number.isNaN(ts) || ts < cutoff) continue;
      if (userId && (event as any).userId !== userId) continue;
      events.push(event);
    } catch {
      // Ignore malformed or unreadable files
    }
  }

  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return events;
}

async function getConversationEvents(sessionId: string, userId?: string): Promise<ConversationEvent[]> {
  try {
    const events = await loadRecentEvents(7, userId);
    return events.filter(event => {
      const eventSessionId = event.metadata?.conversationId || event.metadata?.sessionId;
      return eventSessionId === sessionId;
    });
  } catch (error) {
    console.error('[summarizer] Error getting conversation events:', error);
    return [];
  }
}

async function hasExistingSummary(sessionId: string, userId?: string): Promise<boolean> {
  try {
    const events = await loadRecentEvents(7, userId);
    return events.some(event => {
      if (event.type !== 'summary') return false;
      const eventSessionId = event.metadata?.conversationId || event.metadata?.sessionId;
      return eventSessionId === sessionId;
    });
  } catch (error) {
    console.error('[summarizer] Error checking existing summaries:', error);
    return false;
  }
}

async function getUnsummarizedSessions(userId?: string): Promise<string[]> {
  const sessionIds = new Set<string>();
  const summarizedSessions = new Set<string>();

  try {
    const events = await loadRecentEvents(7, userId);
    for (const event of events) {
      const sessionId = event.metadata?.conversationId || event.metadata?.sessionId;
      if (!sessionId) continue;

      if (event.type === 'summary') {
        summarizedSessions.add(sessionId);
      } else {
        sessionIds.add(sessionId);
      }
    }

    return Array.from(sessionIds).filter(id => !summarizedSessions.has(id));
  } catch (error) {
    console.error('[summarizer] Error getting unsummarized sessions:', error);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// Core Summary Logic
// ─────────────────────────────────────────────────────────────

/**
 * Generate a summary of a conversation using LLM
 */
export async function generateSummary(events: ConversationEvent[]): Promise<ConversationSummary> {
  if (events.length === 0) {
    throw new Error('No events to summarize');
  }

  const sessionId = events[0].metadata?.conversationId || events[0].metadata?.sessionId || 'unknown';
  const startTime = events[0].timestamp;
  const endTime = events[events.length - 1].timestamp;
  const messageCount = events.filter(e => e.type === 'conversation').length;
  const mode = events[0].metadata?.cognitiveMode || 'unknown';

  const toolsUsed = [...new Set(
    events
      .filter(e => e.type === 'tool_invocation' && e.metadata?.toolName)
      .map(e => e.metadata!.toolName!)
  )];

  const transcript = events
    .filter(e => e.type === 'conversation' || e.type === 'inner_dialogue')
    .map(e => {
      const role = e.type === 'conversation' ? 'User' : 'Assistant';
      return `${role}: ${e.content}${e.response ? `\nAssistant: ${e.response}` : ''}`;
    })
    .join('\n\n');

  const maxLength = 4000;
  const truncatedTranscript = transcript.length > maxLength
    ? transcript.substring(0, maxLength) + '\n\n[...conversation continues...]'
    : transcript;

  const persona = await loadPersonaCore();

  const messages: RouterMessage[] = [
    {
      role: 'system',
      content: `You are ${persona.name}, analyzing a conversation session to create a concise summary.

Your task is to extract:
1. **Key Topics**: Main subjects discussed (2-5 topics)
2. **Decisions**: Any decisions made or conclusions reached
3. **Outcomes**: What was accomplished or learned
4. **Overall Summary**: 2-3 sentence overview of the entire conversation

Be concise and focus on what matters. Skip pleasantries and meta-discussion about the system itself.`
    },
    {
      role: 'user',
      content: `Analyze this conversation session and provide a structured summary:

**Session Metadata:**
- Session ID: ${sessionId}
- Duration: ${startTime} to ${endTime}
- Messages: ${messageCount}
- Tools used: ${toolsUsed.join(', ') || 'none'}
- Cognitive mode: ${mode}

**Conversation Transcript:**
${truncatedTranscript}

Respond in JSON format:
{
  "keyTopics": ["topic1", "topic2", ...],
  "decisions": ["decision1", "decision2", ...],
  "outcomes": ["outcome1", "outcome2", ...],
  "summary": "2-3 sentence overview"
}`
    }
  ];

  try {
    const response = await callLLM({
      role: 'persona',
      messages,
      options: {
        temperature: 0.3,
        response_format: { type: 'json_object' }
      }
    });

    const parsed = JSON.parse(response.content);

    return {
      sessionId,
      startTime,
      endTime,
      messageCount,
      toolsUsed,
      keyTopics: parsed.keyTopics || [],
      decisions: parsed.decisions || [],
      outcomes: parsed.outcomes || [],
      summary: parsed.summary || '',
      mode
    };
  } catch (error) {
    console.error('[summarizer] LLM generation failed:', error);

    return {
      sessionId,
      startTime,
      endTime,
      messageCount,
      toolsUsed,
      keyTopics: [],
      decisions: [],
      outcomes: [],
      summary: `Conversation session with ${messageCount} messages. Tools used: ${toolsUsed.join(', ') || 'none'}.`,
      mode
    };
  }
}

async function saveSummary(summary: ConversationSummary): Promise<string> {
  const ctx = getUserContext();
  const cognitiveConfig = loadCognitiveMode();
  const cognitiveMode = cognitiveConfig.currentMode;

  if (!ctx || !canWriteMemory(cognitiveMode)) {
    console.warn('[summarizer] Cannot write summary in current mode:', cognitiveMode);
    return '';
  }

  const content = `Conversation Summary: ${summary.summary}`;

  const filepath = captureEvent(content, {
    type: 'summary',
    tags: ['summary', 'conversation', ...summary.keyTopics],
    entities: summary.keyTopics,
    importance: 0.7,
    metadata: {
      conversationId: summary.sessionId,
      sessionId: summary.sessionId,
      cognitiveMode,
      startTime: summary.startTime,
      endTime: summary.endTime,
      messageCount: summary.messageCount,
      toolsUsed: summary.toolsUsed,
      keyTopics: summary.keyTopics,
      decisions: summary.decisions,
      outcomes: summary.outcomes,
      fullSummary: summary.summary,
      timestamp: new Date().toISOString()
    }
  });

  audit({
    level: 'info',
    category: 'action',
    event: 'conversation_summarized',
    actor: 'summarizer',
    details: {
      sessionId: summary.sessionId,
      messageCount: summary.messageCount,
      topicsCount: summary.keyTopics.length,
      decisionsCount: summary.decisions.length,
      outcomesCount: summary.outcomes.length,
      mode: summary.mode,
      filepath
    }
  });

  return filepath;
}

async function updateConversationBufferSummary(
  summary: ConversationSummary,
  mode: 'conversation' | 'inner' = 'conversation'
): Promise<void> {
  const bufferPath = getConversationBufferPath(mode);
  if (!bufferPath) return;

  try {
    let data: any = {};
    try {
      const raw = await fs.readFile(bufferPath, 'utf-8');
      data = JSON.parse(raw);
    } catch {
      data = {};
    }

    const existingMessages: any[] = Array.isArray(data.messages) ? data.messages : [];
    const existingMarkers: any[] = Array.isArray(data.summaryMarkers) ? data.summaryMarkers : [];

    const sanitizedMessages = existingMessages.filter(msg => !msg?.meta?.summaryMarker);
    const sanitizedMarkers = existingMarkers.filter(
      marker => !(marker?.meta?.summaryMarker && marker.meta.sessionId === summary.sessionId)
    );

    const rangeEnd = Math.max(summary.messageCount - 1, 0);
    sanitizedMarkers.push({
      role: 'system',
      content: `Conversation summary (messages 0-${rangeEnd}): ${summary.summary}`,
      meta: {
        summaryMarker: true,
        sessionId: summary.sessionId,
        createdAt: new Date().toISOString(),
        range: { start: 0, end: rangeEnd },
        summaryCount: summary.messageCount
      }
    });

    const payload = {
      ...data,
      summaryMarkers: sanitizedMarkers,
      messages: sanitizedMessages,
      lastSummarizedIndex: summary.messageCount,
      lastUpdated: new Date().toISOString()
    };

    await fs.writeFile(bufferPath, JSON.stringify(payload, null, 2));
  } catch (error) {
    console.warn('[summarizer] Failed to update conversation buffer with summary:', error);
  }
}

/**
 * Summarize a specific session
 */
export async function summarizeSession(
  sessionId: string,
  options: { bufferMode?: 'conversation' | 'inner'; username?: string } = {}
): Promise<ConversationSummary | null> {
  const ctx = options.username ? undefined : getUserContext();
  const userId = ctx?.userId;
  const username = options.username || ctx?.username || 'anonymous';

  console.log(`[summarizer] Analyzing session: ${sessionId}`);

  if (await isSummarizing(username, sessionId)) {
    console.log(`[summarizer] Session already being summarized: ${sessionId}`);
    return null;
  }

  if (await hasExistingSummary(sessionId, userId)) {
    console.log(`[summarizer] Session already summarized: ${sessionId}`);
    return null;
  }

  const events = await getConversationEvents(sessionId, userId);

  if (events.length === 0) {
    console.warn(`[summarizer] No events found for session: ${sessionId}`);
    return null;
  }

  console.log(`[summarizer] Found ${events.length} events in session`);

  try {
    await markSummarizing(username, sessionId);

    const summary = await generateSummary(events);
    const filepath = await saveSummary(summary);

    await markSummaryCompleted(username, sessionId);
    await updateConversationBufferSummary(summary, options.bufferMode || 'conversation');

    if (filepath) {
      console.log(`[summarizer] Summary saved: ${filepath}`);
    } else {
      console.log(`[summarizer] Summary generated but not saved (read-only mode)`);
    }

    return summary;
  } catch (error) {
    await clearSummaryMarker(username, sessionId);
    throw error;
  }
}

/**
 * Auto-summarize all unsummarized sessions
 */
export async function autoSummarize(): Promise<{ summarized: number; errors: string[] }> {
  const ctx = getUserContext();
  const userId = ctx?.userId;

  console.log('[summarizer] Finding unsummarized sessions...');

  const sessions = await getUnsummarizedSessions(userId);

  if (sessions.length === 0) {
    console.log('[summarizer] No unsummarized sessions found');
    return { summarized: 0, errors: [] };
  }

  console.log(`[summarizer] Found ${sessions.length} unsummarized sessions`);

  let summarized = 0;
  const errors: string[] = [];

  for (const sessionId of sessions) {
    try {
      await summarizeSession(sessionId);
      summarized++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`[summarizer] Failed to summarize session ${sessionId}:`, error);
      errors.push(`${sessionId}: ${(error as Error).message}`);
    }
  }

  console.log('[summarizer] Auto-summarization complete');
  return { summarized, errors };
}

// ─────────────────────────────────────────────────────────────
// Agent Runtime Entry Point
// ─────────────────────────────────────────────────────────────

/**
 * Agent runtime entry point for mobile/runtime execution
 */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  const sessionArg = args.find(a => a.startsWith('--session='));
  const sessionId = sessionArg?.split('=')[1] || opts.sessionId as string;
  const autoMode = args.includes('--auto') || opts.auto === true;
  const username = args.find(a => a.startsWith('--user='))?.split('=')[1] || opts.username as string;

  try {
    if (sessionId) {
      const summary = await withUserContext(
        { userId: username || ctx.userId, username: username || ctx.userId, role: 'owner' },
        async () => summarizeSession(sessionId, { username })
      );

      return {
        success: !!summary,
        data: summary,
        durationMs: Date.now() - startTime,
      };
    } else if (autoMode) {
      // SECURITY: Get target user - prioritizes explicit username, then API trigger, then most recently active
      const activeUser = getTargetUser();

      if (!activeUser) {
        return {
          success: true,
          data: { summarized: 0, errors: [], message: 'No active user found' },
          durationMs: Date.now() - startTime,
        };
      }

      console.log(`[summarizer] Processing user: ${activeUser.username}`);

      const result = await withUserContext(
        { userId: activeUser.userId, username: activeUser.username, role: activeUser.role },
        async () => autoSummarize()
      );

      return {
        success: result.errors.length === 0,
        data: { summarized: result.summarized, errors: result.errors },
        errors: result.errors.length > 0 ? result.errors : undefined,
        durationMs: Date.now() - startTime,
      };
    } else {
      return {
        success: false,
        error: 'Usage: --session=<id> OR --auto',
        durationMs: Date.now() - startTime,
      };
    }
  } catch (error) {
    audit({
      level: 'error',
      category: 'system',
      event: 'summarizer_error',
      actor: 'summarizer',
      details: { error: (error as Error).message }
    });

    return {
      success: false,
      error: (error as Error).message,
      durationMs: Date.now() - startTime,
    };
  }
}
