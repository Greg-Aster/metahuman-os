/**
 * Curiosity Question Saver Node
 * Saves generated question to audit log and pending questions directory
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { audit } from '../../audit.js';
import { curiosityQuestionStore } from '../../curiosity-questions.js';

const execute: NodeExecutor = async (inputs, context) => {
  const question = typeof inputs.question === 'string' ? inputs.question.trim() : '';
  const memories = Array.isArray(inputs.memories) ? inputs.memories : [];
  const username = context.userId;

  if (!username) {
    throw new Error('Curiosity Question Saver requires a username in graph context');
  }

  if (!question) {
    if (memories.length === 0) {
      return {
        questionId: null,
        question: '',
        saved: false,
        skipReason: 'no-memories',
      };
    }
    throw new Error('Curiosity Question Saver received memories without a generated question');
  }

  const seedMemories = [...new Set(memories.flatMap((memory: unknown) => {
    if (!memory || typeof memory !== 'object') return [];
    const id = (memory as Record<string, unknown>).__memoryId;
    return typeof id === 'string' && id.trim() ? [id.trim()] : [];
  }))];
  const record = await curiosityQuestionStore.create(username, {
    question,
    seedMemories,
  });
  const questionText = `💭 ${question}`;

  audit({
    category: 'action',
    level: 'info',
    event: 'chat_assistant',
    details: {
      mode: 'conversation',
      content: questionText,
      cognitiveMode: 'dual',
      usedOperator: false,
      curiosityQuestionId: record.id,
      curiosityData: {
        questionId: record.id,
        questionText,
        rawQuestion: question,
        topic: 'general',
        seedMemories,
        askedAt: record.askedAt,
        isCuriosityQuestion: true,
      },
    },
    actor: 'curiosity-service',
    metadata: {
      questionId: record.id,
      autonomy: 'normal',
      username,
    },
  });

  const entry = {
    role: 'assistant',
    content: questionText,
    meta: {
      type: 'curiosity',
      questionId: record.id,
      isCuriosityQuestion: true,
      seedMemories,
      askedAt: record.askedAt,
    },
  } as const;

  return {
    questionId: record.id,
    question,
    saved: true,
    entry,
    username,
    askedAt: record.askedAt,
  };
};

export const CuriosityQuestionSaverNode: NodeDefinition = defineNode({
  id: 'curiosity_question_saver',
  name: 'Curiosity Question Saver',
  category: 'curiosity',
  inputs: [
    { name: 'question', type: 'string', description: 'Generated question' },
    { name: 'memories', type: 'array', description: 'Sampled seed memories' },
  ],
  outputs: [
    { name: 'questionId', type: 'string' },
    { name: 'question', type: 'string', description: 'Persisted question text' },
    { name: 'saved', type: 'boolean' },
    { name: 'entry', type: 'message', description: 'Typed user-facing conversation entry' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Saves generated question to audit log and pending directory',
  execute,
});
