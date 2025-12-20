/**
 * Curiosity Question Saver Node
 * Saves generated question to audit log and pending questions directory
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { audit, getProfilePaths, appendToUserBuffer } from '../../index.js';

const execute: NodeExecutor = async (inputs, context) => {
  // Access inputs by handle name with fallbacks for flexible edge connections
  // Can receive: questionData object OR separate question/memories inputs
  const questionData = inputs['questionData'] || inputs.questionData || inputs[0];
  const questionInput = inputs['question'] || inputs.question;
  const memoriesInput = inputs['memories'] || inputs.memories;

  // Extract question (prefer direct input, fallback to questionData object)
  const question = questionInput?.question || questionInput || questionData?.question || '';
  // Extract memories (prefer direct input, fallback to questionData object)
  const memories = memoriesInput || questionData?.memories || [];
  const username = context.userId;

  if (!username) {
    return {
      questionId: null,
      saved: false,
      error: 'No username in context'
    };
  }

  if (!question) {
    return {
      questionId: null,
      saved: false,
      error: 'No question provided'
    };
  }

  try {
    const questionId = `cur-q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const askedAt = new Date().toISOString();
    const seedMemories = memories.map((m: any) => m.__file).filter(Boolean);
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
        curiosityQuestionId: questionId,
        curiosityData: {
          questionId,
          questionText,
          rawQuestion: question,
          topic: 'general',
          seedMemories,
          askedAt,
          isCuriosityQuestion: true
        }
      },
      actor: 'curiosity-service',
      metadata: {
        questionId,
        question: question.substring(0, 100),
        autonomy: 'normal',
        username
      }
    });

    const profilePaths = getProfilePaths(username);
    const curiosityDir = path.join(profilePaths.state, 'curiosity', 'questions', 'pending');
    await fs.mkdir(curiosityDir, { recursive: true });

    const questionData = {
      id: questionId,
      question,
      askedAt,
      seedMemories,
      status: 'pending',
      username
    };

    await fs.writeFile(
      path.join(curiosityDir, `${questionId}.json`),
      JSON.stringify(questionData, null, 2),
      'utf-8'
    );

    // Add question to conversation buffer so it appears in chat UI
    const bufferSuccess = appendToUserBuffer(username, 'conversation', {
      role: 'assistant',
      content: questionText,
      meta: {
        type: 'curiosity',
        questionId,
        isCuriosityQuestion: true,
        seedMemories,
        askedAt,
      },
    });

    if (!bufferSuccess) {
      console.warn('[CuriosityQuestionSaver] Failed to append question to conversation buffer');
    }

    return {
      questionId,
      saved: true,
      buffered: bufferSuccess,
      username,
      askedAt
    };
  } catch (error) {
    console.error('[CuriosityQuestionSaver] Error:', error);
    return {
      questionId: null,
      saved: false,
      error: (error as Error).message,
      username
    };
  }
};

export const CuriosityQuestionSaverNode: NodeDefinition = defineNode({
  id: 'curiosity_question_saver',
  name: 'Curiosity Question Saver',
  category: 'curiosity',
  inputs: [
    { name: 'questionData', type: 'object', description: 'Question and memories' },
  ],
  outputs: [
    { name: 'questionId', type: 'string' },
    { name: 'saved', type: 'boolean' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Saves generated question to audit log and pending directory',
  execute,
});
