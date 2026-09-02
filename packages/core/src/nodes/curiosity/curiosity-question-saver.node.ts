/**
 * Curiosity Question Saver Node
 * Persists one stable pending question and builds its conversation entry.
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { curiosityQuestionStore } from '../../curiosity-questions.js';

const execute: NodeExecutor = async (inputs, context) => {
  const generatedQuestion = typeof inputs.question === 'string' ? inputs.question.trim() : '';
  const memories = Array.isArray(inputs.memories) ? inputs.memories : [];
  const username = context.userId;
  const stableQuestionId = typeof context.curiosityQuestionId === 'string'
    ? context.curiosityQuestionId.trim()
    : '';

  if (!username) {
    throw new Error('Curiosity Question Saver requires a username in graph context');
  }

  const existing = stableQuestionId
    ? await curiosityQuestionStore.get(username, stableQuestionId)
    : null;
  if (existing && existing.status !== 'pending') {
    throw new Error(`Curiosity question ${existing.id} is already ${existing.status}`);
  }

  if (!generatedQuestion && !existing) {
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
  const stored = existing
    ? { created: false, record: existing }
    : await curiosityQuestionStore.createOrGet(username, {
        ...(stableQuestionId ? { id: stableQuestionId } : {}),
        question: generatedQuestion,
        seedMemories,
      });
  if (stored.record.status !== 'pending') {
    throw new Error(`Curiosity question ${stored.record.id} is already ${stored.record.status}`);
  }
  const record = stored.record;
  const question = record.question;
  const questionText = `💭 ${question}`;

  const entry = {
    role: 'assistant',
    content: questionText,
    meta: {
      type: 'curiosity',
      questionId: record.id,
      isCuriosityQuestion: true,
      seedMemories: record.seedMemories,
      askedAt: record.askedAt,
    },
  } as const;

  return {
    questionId: record.id,
    question,
    saved: true,
    created: stored.created,
    resumed: !stored.created,
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
    { name: 'memories', type: 'array', optional: true, description: 'Sampled seed memories' },
  ],
  outputs: [
    { name: 'questionId', type: 'string' },
    { name: 'question', type: 'string', description: 'Persisted question text' },
    { name: 'saved', type: 'boolean' },
    { name: 'created', type: 'boolean' },
    { name: 'resumed', type: 'boolean' },
    { name: 'entry', type: 'message', description: 'Typed user-facing conversation entry' },
    { name: 'username', type: 'string' },
    { name: 'askedAt', type: 'string' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Persists one stable pending curiosity question and builds its typed conversation entry',
  execute,
});
