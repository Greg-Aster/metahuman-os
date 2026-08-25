/**
 * Reply-To Handler Node
 * Fetches reply-to context (curiosity questions or selected messages)
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { curiosityQuestionStore } from '../../curiosity-questions.js';

const execute: NodeExecutor = async (inputs, context) => {
  const replyToQuestionId = context.replyToQuestionId || inputs[0]?.replyToQuestionId;
  const replyToContent = context.replyToContent || inputs[0]?.replyToContent;

  if (!replyToQuestionId && !replyToContent) {
    return {
      replyToContext: null,
      curiosityMetadata: null,
    };
  }

  // Priority 1: Curiosity question from the authenticated profile's canonical store.
  if (replyToQuestionId) {
    const username = typeof context.username === 'string' && context.username.trim()
      ? context.username.trim()
      : context.userId;
    if (!username) throw new Error('Reply-To Handler requires a username for curiosity replies');
    const question = await curiosityQuestionStore.get(username, replyToQuestionId);
    if (!question) throw new Error(`Curiosity reply target not found: ${replyToQuestionId}`);
    return {
      replyToContext: `# User is Replying To\n💭 ${question.question}`,
      curiosityMetadata: {
        questionId: question.id,
        questionText: question.question,
        rawQuestion: question.question,
        seedMemories: question.seedMemories,
        askedAt: question.askedAt,
        isCuriosityQuestion: true,
      },
    };
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
