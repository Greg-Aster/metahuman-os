/**
 * Emulation Mode Node Executors
 * Handles reply-to context and buffer management for emulation mode
 */

import type { NodeExecutor } from './types.js';

/**
 * Reply-To Handler Node
 * Fetches reply-to context (curiosity questions or selected messages)
 */
export const replyToHandlerExecutor: NodeExecutor = async (inputs, context) => {
  const replyToQuestionId = context.replyToQuestionId || inputs[0]?.replyToQuestionId;
  const replyToContent = context.replyToContent || inputs[0]?.replyToContent;

  if (!replyToQuestionId && !replyToContent) {
    return {
      replyToContext: null,
      curiosityMetadata: null,
    };
  }

  // Priority 1: Curiosity question (from audit logs)
  if (replyToQuestionId) {
    try {
      const { ROOT } = await import('../paths.js');
      const path = await import('node:path');
      const fs = await import('node:fs');

      const auditDir = path.join(ROOT, 'logs', 'audit');
      const today = new Date().toISOString().split('T')[0];
      const auditFile = path.join(auditDir, `${today}.ndjson`);

      if (!fs.existsSync(auditFile)) {
        console.warn(`[ReplyToHandler] Audit file not found: ${auditFile}`);
        return {
          replyToContext: null,
          curiosityMetadata: null,
        };
      }

      const auditContent = fs.readFileSync(auditFile, 'utf-8');
      const lines = auditContent.split('\n').filter(Boolean);

      // Search backwards (most recent first)
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (
            entry.actor === 'curiosity-service' &&
            entry.event === 'chat_assistant' &&
            entry.details?.curiosityQuestionId === replyToQuestionId &&
            entry.details?.curiosityData
          ) {
            const questionText = entry.details.curiosityData.questionText;
            const curiosityData = entry.details.curiosityData;

            return {
              replyToContext: `# User is Replying To\n💭 ${questionText}`,
              curiosityMetadata: {
                questionId: replyToQuestionId,
                questionText,
                ...curiosityData,
              },
            };
          }
        } catch {
          // Skip malformed lines
        }
      }

      console.warn(`[ReplyToHandler] Question not found: ${replyToQuestionId}`);
    } catch (error) {
      console.error(`[ReplyToHandler] Error retrieving curiosity question:`, error);
    }
  }

  // Priority 2: Selected message content
  if (replyToContent) {
    return {
      replyToContext: `# User is Replying To\n${replyToContent}`,
      curiosityMetadata: null,
    };
  }

  return {
    replyToContext: null,
    curiosityMetadata: null,
  };
};

/**
 * Buffer Manager Node
 * Persists conversation buffer to disk
 * FIX: Appends NEW user+assistant messages to existing history
 */
export const bufferManagerExecutor: NodeExecutor = async (inputs, context) => {
  const mode = context.mode || context.dialogueType || 'conversation';
  const sessionId = context.sessionId;
  const username = context.username;
  const userMessage = context.userMessage;

  if (!username) {
    console.warn('[BufferManager] No username in context, cannot persist buffer');
    return {
      persisted: false,
      error: 'No username in context',
    };
  }

  try {
    const { getProfilePaths } = await import('../paths.js');
    const fs = await import('node:fs');
    const path = await import('node:path');

    const profilePaths = getProfilePaths(username);
    const bufferPath = path.join(profilePaths.state, `conversation-buffer-${mode}.json`);

    // Ensure state directory exists
    fs.mkdirSync(profilePaths.state, { recursive: true });

    // Load existing buffer
    let existingMessages: any[] = [];
    let summaryMarkers: any[] = [];
    try {
      if (fs.existsSync(bufferPath)) {
        const existingRaw = fs.readFileSync(bufferPath, 'utf-8');
        const existing = JSON.parse(existingRaw);
        existingMessages = existing.messages || [];
        summaryMarkers = existing.summaryMarkers || [];
      }
    } catch (err) {
      console.warn('[BufferManager] Failed to load existing buffer, starting fresh:', err);
    }

    // Get response from inputs[1] (persona_llm or response_synthesizer output)
    // inputs[0] = conversation history (array), inputs[1] = response (string/object)
    console.log(`[BufferManager] inputs.length=${inputs.length}, inputs[0] type=${Array.isArray(inputs[0]) ? 'array' : typeof inputs[0]}, inputs[1] type=${typeof inputs[1]}`);
    const assistantResponse = inputs[1]?.response || inputs[1]?.content || inputs[1]?.text || inputs[1];
    console.log(`[BufferManager] Extracted assistant response length: ${typeof assistantResponse === 'string' ? assistantResponse.length : 'N/A'}`);

    // Build updated message list: existing + user + assistant
    const updatedMessages = [...existingMessages];

    // Add user message if present
    if (userMessage) {
      console.log(`[BufferManager] Adding user message: "${userMessage.substring(0, 50)}..."`);
      updatedMessages.push({
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
      });
    } else {
      console.log(`[BufferManager] ⚠️ No userMessage in context`);
    }

    // Add assistant response if present
    if (assistantResponse) {
      console.log(`[BufferManager] Adding assistant response: "${typeof assistantResponse === 'string' ? assistantResponse.substring(0, 50) : JSON.stringify(assistantResponse).substring(0, 50)}..."`);
      updatedMessages.push({
        role: 'assistant',
        content: assistantResponse,
        timestamp: Date.now(),
      });
    } else {
      console.log(`[BufferManager] ⚠️ No assistant response in inputs[1]`);
    }

    console.log(`[BufferManager] updatedMessages length BEFORE filtering: ${updatedMessages.length}`);

    // Filter out system messages
    const conversationMessages = updatedMessages.filter((msg: any) => msg.role !== 'system');

    console.log(`[BufferManager] conversationMessages length AFTER filtering: ${conversationMessages.length}`);

    // Capacity management: Check if approaching limit and prune if needed
    const CAPACITY_THRESHOLD = 64; // 80% of 80 max messages - trigger summarization
    const MAX_MESSAGES = 80;
    let needsSummarization = false;
    let finalMessages = conversationMessages;

    if (conversationMessages.length >= CAPACITY_THRESHOLD) {
      console.log(`[BufferManager] ⚠️ Approaching capacity (${conversationMessages.length}/${MAX_MESSAGES}), flagging for summarization`);
      needsSummarization = true;

      // Fire-and-forget summarization (async, non-blocking)
      (async () => {
        try {
          const { summarizeSession } = await import('../../../../brain/agents/summarizer.js');
          console.log(`[BufferManager] Starting background summarization for session: ${sessionId}`);
          await summarizeSession(sessionId, { bufferMode: mode as 'conversation' | 'inner', username });
          console.log(`[BufferManager] Summarization complete for session: ${sessionId}`);
        } catch (err) {
          console.error(`[BufferManager] Summarization failed:`, err);
        }
      })();

      // Fire-and-forget summarization (async, non-blocking)
      (async () => {
        try {
          const { summarizeSession } = await import('../../../../brain/agents/summarizer.js');
          console.log(`[BufferManager] Starting background summarization for session: ${sessionId}`);
          await summarizeSession(sessionId, { bufferMode: mode as 'conversation' | 'inner', username });
          console.log(`[BufferManager] Summarization complete for session: ${sessionId}`);
        } catch (err) {
          console.error(`[BufferManager] Summarization failed:`, err);
        }
      })();
    }

    // Hard prune if over max (keep most recent messages)
    if (conversationMessages.length > MAX_MESSAGES) {
      console.log(`[BufferManager] 🔄 Pruning from ${conversationMessages.length} to ${MAX_MESSAGES} messages`);
      finalMessages = conversationMessages.slice(-MAX_MESSAGES);
    }

    const payload = {
      summaryMarkers,
      messages: finalMessages,
      lastSummarizedIndex: null,
      lastUpdated: new Date().toISOString(),
      needsSummarization, // Flag for external summarization trigger
    };

    fs.writeFileSync(bufferPath, JSON.stringify(payload, null, 2));

    console.log(`[BufferManager] ✅ Persisted ${finalMessages.length} messages (${existingMessages.length} existing + ${userMessage ? 1 : 0} user + ${assistantResponse ? 1 : 0} assistant)`);

    return {
      persisted: true,
      mode,
      messageCount: finalMessages.length,
      sessionId,
      bufferPath,
      needsSummarization,
    };
  } catch (error) {
    console.error('[BufferManager] Error persisting buffer:', error);
    return {
      persisted: false,
      error: (error as Error).message,
    };
  }
};
