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
 */
export const bufferManagerExecutor: NodeExecutor = async (inputs, context) => {
  const messages = inputs[0]?.messages || context.conversationHistory || [];
  const mode = context.mode || context.dialogueType || 'conversation';
  const sessionId = context.sessionId;

  try {
    const { persistBuffer } = await import('../conversation-buffer.js');

    persistBuffer(mode as 'inner' | 'conversation', messages);

    console.log(`[BufferManager] Persisted ${messages.length} messages for ${mode} mode`);

    // Note: Auto-summarization is triggered asynchronously in the background
    // when buffer size exceeds limits. This is handled by the summarization service.

    return {
      persisted: true,
      mode,
      messageCount: messages.length,
      sessionId,
    };
  } catch (error) {
    console.error('[BufferManager] Error persisting buffer:', error);
    return {
      persisted: false,
      error: (error as Error).message,
    };
  }
};
