/**
 * Reply-To Handler Node
 * Fetches reply-to context (curiosity questions or selected messages)
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';

const execute: NodeExecutor = async (inputs, context) => {
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
      const { ROOT } = await import('../../paths.js');
      const path = await import('node:path');
      const fs = await import('node:fs');

      const auditDir = path.join(ROOT, 'logs', 'audit');
      const today = new Date().toISOString().split('T')[0];
      const auditFile = path.join(auditDir, `${today}.ndjson`);

      if (!fs.existsSync(auditFile)) {
        return {
          replyToContext: null,
          curiosityMetadata: null,
        };
      }

      const auditContent = fs.readFileSync(auditFile, 'utf-8');
      const lines = auditContent.split('\n').filter(Boolean);

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
        } catch {}
      }
    } catch (error) {
      console.error(`[ReplyToHandler] Error:`, error);
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

export const ReplyToHandlerNode: NodeDefinition = defineNode({
  id: 'reply_to_handler',
  name: 'Reply-To Handler',
  category: 'emulation',
  inputs: [
    { name: 'replyData', type: 'object', optional: true, description: 'Reply-to data' },
  ],
  outputs: [
    { name: 'replyToContext', type: 'string', description: 'Context for reply' },
    { name: 'curiosityMetadata', type: 'object' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Fetches reply-to context (curiosity questions or selected messages)',
  execute,
});
