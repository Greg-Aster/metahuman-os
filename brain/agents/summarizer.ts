/**
 * Conversation Summarizer Agent
 *
 * Phase 3: Memory Continuity - Summarizes conversation sessions into concise overviews
 *
 * Features:
 * - Analyzes conversations by session ID
 * - Generates summaries of key topics, decisions, and outcomes
 * - Stores summaries as episodic events
 * - Mode-aware behavior (dual/agent get summaries, emulation uses ephemeral)
 * - Can be triggered manually or automatically on buffer overflow
 *
 * Usage:
 *   tsx brain/agents/summarizer.ts --session conv-1699358400-x7k2p9q1
 *   tsx brain/agents/summarizer.ts --auto (summarize all unsummarized sessions)
 */

import {
  callLLM,
  type RouterMessage,
  captureEvent,
  listEpisodicFiles,
  audit,
  loadPersonaCore,
  acquireLock,
  releaseLock,
  isLocked,
  initGlobalLogger,
  listUsers,
  withUserContext,
  getUserContext,
  loadCognitiveMode,
  canWriteMemory,
  markSummarizing,
  markSummaryCompleted,
  clearSummaryMarker,
  isSummarizing,
  getConversationBufferPath,
} from '../../packages/core/src/index';
import fs from 'node:fs/promises';

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

interface ConversationSummary {
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

const DAY_MS = 24 * 60 * 60 * 1000;

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

/**
 * Get all events for a specific conversation session
 */
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

/**
 * Check if a session already has a saved summary event
 */
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

/**
 * Get all unsummarized conversation sessions
 */
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

/**
 * Generate a summary of a conversation using LLM
 */
async function generateSummary(events: ConversationEvent[]): Promise<ConversationSummary> {
  if (events.length === 0) {
    throw new Error('No events to summarize');
  }

  // Extract metadata
  const sessionId = events[0].metadata?.conversationId || events[0].metadata?.sessionId || 'unknown';
  const startTime = events[0].timestamp;
  const endTime = events[events.length - 1].timestamp;
  const messageCount = events.filter(e => e.type === 'conversation').length;
  const mode = events[0].metadata?.cognitiveMode || 'unknown';

  // Extract tools used
  const toolsUsed = [...new Set(
    events
      .filter(e => e.type === 'tool_invocation' && e.metadata?.toolName)
      .map(e => e.metadata!.toolName!)
  )];

  // Build conversation transcript for LLM
  const transcript = events
    .filter(e => e.type === 'conversation' || e.type === 'inner_dialogue')
    .map(e => {
      const role = e.type === 'conversation' ? 'User' : 'Assistant';
      return `${role}: ${e.content}${e.response ? `\nAssistant: ${e.response}` : ''}`;
    })
    .join('\n\n');

  // Limit transcript length (max ~4000 chars for summary)
  const maxLength = 4000;
  const truncatedTranscript = transcript.length > maxLength
    ? transcript.substring(0, maxLength) + '\n\n[...conversation continues...]'
    : transcript;

  // Persona context
  const persona = await loadPersonaCore();

  // Generate summary using LLM
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
      role: 'curator',
      messages,
      options: {
        temperature: 0.3, // Lower temperature for consistent summaries
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

    // Fallback summary
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

/**
 * Save conversation summary as episodic event
 */
async function saveSummary(summary: ConversationSummary): Promise<string> {
  const ctx = getUserContext();
  const cognitiveConfig = loadCognitiveMode();
  const cognitiveMode = cognitiveConfig.currentMode;

  // Check if we can write memory
  if (!ctx || !canWriteMemory(cognitiveMode)) {
    console.warn('[summarizer] Cannot write summary in current mode:', cognitiveMode);
    return '';
  }

  // Format summary content
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
 * Main summarization function
 */
async function summarizeSession(
  sessionId: string,
  options: { bufferMode?: 'conversation' | 'inner' } = {}
): Promise<ConversationSummary | null> {
  const ctx = getUserContext();
  const userId = ctx?.userId;
  const username = ctx?.username || 'anonymous';

  console.log(`[summarizer] Analyzing session: ${sessionId}`);

  // C3: Skip if currently being summarized (backpressure)
  if (await isSummarizing(username, sessionId)) {
    console.log(`[summarizer] Session already being summarized (concurrent call detected): ${sessionId}`);
    return null;
  }

  // Skip if summary already exists
  if (await hasExistingSummary(sessionId, userId)) {
    console.log(`[summarizer] Session already summarized: ${sessionId}`);
    return null;
  }

  // Get all events for this session
  const events = await getConversationEvents(sessionId, userId);

  if (events.length === 0) {
    console.warn(`[summarizer] No events found for session: ${sessionId}`);
    return null;
  }

  console.log(`[summarizer] Found ${events.length} events in session`);

  try {
    // C2: Mark as summarizing BEFORE LLM call
    await markSummarizing(username, sessionId);

    // Generate summary (LLM call happens here)
    const summary = await generateSummary(events);

    // Save summary (mode-aware)
    const filepath = await saveSummary(summary);

    // C2: Mark as completed after successful save
    await markSummaryCompleted(username, sessionId);

    await updateConversationBufferSummary(summary, options.bufferMode || 'conversation');

    if (filepath) {
      console.log(`[summarizer] Summary saved: ${filepath}`);
    } else {
      console.log(`[summarizer] Summary generated but not saved (read-only mode or no user context)`);
    }

    return summary;
  } catch (error) {
    // Clear marker on error
    await clearSummaryMarker(username, sessionId);
    throw error;
  }
}

/**
 * Auto-summarize all unsummarized sessions
 */
async function autoSummarize(): Promise<void> {
  const ctx = getUserContext();
  const userId = ctx?.userId;

  console.log('[summarizer] Finding unsummarized sessions...');

  const sessions = await getUnsummarizedSessions(userId);

  if (sessions.length === 0) {
    console.log('[summarizer] No unsummarized sessions found');
    return;
  }

  console.log(`[summarizer] Found ${sessions.length} unsummarized sessions`);

  for (const sessionId of sessions) {
    try {
      await summarizeSession(sessionId);
      // Small delay between summaries to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`[summarizer] Failed to summarize session ${sessionId}:`, error);
    }
  }

  console.log('[summarizer] Auto-summarization complete');
}

/**
 * CLI entry point
 */
async function main() {
  initGlobalLogger();

  const args = process.argv.slice(2);
  const sessionArg = args.find(a => a.startsWith('--session='));
  const autoMode = args.includes('--auto');
  const userArg = args.find(a => a.startsWith('--user='));

  // Multi-user support
  let targetUserId: string | undefined;
  if (userArg) {
    targetUserId = userArg.split('=')[1];
  }

  // If no user specified, run for all users
  const users = await listUsers();
  const userIds = targetUserId ? [targetUserId] : users.map(u => u.userId);

  if (userIds.length === 0) {
    console.log('[summarizer] No users found');
    return;
  }

  // Single-instance lock
  if (acquireLock('summarizer')) {
    console.log('[summarizer] Lock acquired');
  } else {
    console.error('[summarizer] Another instance is already running');
    process.exit(1);
  }

  try {
    for (const userId of userIds) {
      console.log(`[summarizer] Processing user: ${userId}`);

      await withUserContext(userId, async () => {
        if (sessionArg) {
          // Summarize specific session
          const sessionId = sessionArg.split('=')[1];
          await summarizeSession(sessionId);
        } else if (autoMode) {
          // Auto-summarize all unsummarized sessions
          await autoSummarize();
        } else {
          console.error('[summarizer] Usage: tsx brain/agents/summarizer.ts --session=<id> OR --auto');
          console.error('[summarizer] Optional: --user=<userId>');
        }
      });
    }
  } catch (error) {
    console.error('[summarizer] Error:', error);
    audit({
      level: 'error',
      category: 'system',
      event: 'summarizer_error',
      actor: 'summarizer',
      details: { error: (error as Error).message }
    });
  } finally {
    releaseLock('summarizer');
    console.log('[summarizer] Lock released');
  }
}

// Export for testing/programmatic use
export { summarizeSession, autoSummarize, getConversationEvents, generateSummary };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
