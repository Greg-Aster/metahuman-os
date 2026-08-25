/**
 * Desire Question Generator Node
 *
 * Generates clarifying questions before plan generation to gather context.
 * Questions are asked for complex/high-risk desires to improve plan quality.
 *
 * Triggering conditions (any of these):
 * - Risk level is medium, high, or critical
 * - Desire source is persona_goal (personal goals need context)
 * - Description is vague (< 50 chars or missing key details)
 *
 * Inputs:
 *   - desire: Desire object from desire_loader
 *
 * Outputs:
 *   - desire: Updated desire with clarifyingQuestions populated
 *   - needsQuestions: boolean - whether questions should be asked
 *   - questions: ClarifyingQuestion[] - the generated questions
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import type { Desire } from '../../agency/types.js';
import {
  DEFAULT_QUESTION_PROMPT_TEMPLATE,
  generateQuestions,
  needsClarifyingQuestions,
} from '../../agency/desire-questions.js';
import { normalizeModelRole } from '../../model-router.js';
import { audit } from '../../audit.js';

const execute: NodeExecutor = async (inputs, context, properties) => {
  const slot0 = (inputs.desire || inputs.slot_0 || inputs[0]) as { desire?: Desire; found?: boolean } | Desire | undefined;

  // Handle both wrapped and direct desire input
  const desire: Desire | undefined = (slot0 as { desire?: Desire } | undefined)?.desire
    ?? slot0 as Desire | undefined;

  if (!desire || !desire.id) {
    return {
      desire: null,
      needsQuestions: false,
      questions: [],
      error: 'No desire provided',
    };
  }

  // Check if questions are needed
  const check = needsClarifyingQuestions(desire);

  if (!check.needs) {
    audit({
      level: 'info',
      category: 'agent',
      event: 'desire_questions_skipped',
      actor: 'desire-question-generator',
      details: {
        desireId: desire.id,
        reason: check.reason,
      },
    });

    return {
      desire,
      needsQuestions: false,
      questions: [],
      reason: check.reason,
    };
  }

  // Generate questions
  console.log(`[desire-question-generator] Generating questions for: ${desire.title}`);
  console.log(`[desire-question-generator] Reason: ${check.reason}`);

  const questions = await generateQuestions(desire, {
    promptTemplate: properties?.promptTemplate ?? DEFAULT_QUESTION_PROMPT_TEMPLATE,
    role: normalizeModelRole(properties?.role, 'curator'),
    temperature: properties?.temperature ?? 0.5,
    maxTokens: properties?.maxTokens ?? 500,
  });

  // Update desire with questions
  const now = new Date().toISOString();
  const updatedDesire: Desire = {
    ...desire,
    clarifyingQuestions: {
      phase: 'before_planning',
      questions,
      answers: [],
      askedAt: now,
    },
    status: 'questioning',
    currentStage: 'questioning',
    updatedAt: now,
  };

  audit({
    level: 'info',
    category: 'agent',
    event: 'desire_questions_generated',
    actor: 'desire-question-generator',
    details: {
      desireId: desire.id,
      questionCount: questions.length,
      reason: check.reason,
    },
  });

  return {
    desire: updatedDesire,
    needsQuestions: true,
    questions,
    reason: check.reason,
  };
};

export const definition: NodeDefinition = defineNode({
  id: 'desire_question_generator',
  name: 'Generate Clarifying Questions',
  category: 'agency',
  description: 'Generates questions to gather context before plan generation',
  inputs: [
    { name: 'desire', type: 'object', description: 'Desire needing clarification' },
  ],
  outputs: [
    { name: 'desire', type: 'object', description: 'Updated desire' },
    { name: 'needsQuestions', type: 'boolean', description: 'Whether questions were generated' },
    { name: 'questions', type: 'array', description: 'Generated clarifying questions' },
  ],
  properties: {
    promptTemplate: DEFAULT_QUESTION_PROMPT_TEMPLATE,
    role: 'curator',
    temperature: 0.5,
    maxTokens: 500,
  },
  propertySchemas: {
    promptTemplate: {
      type: 'text_multiline',
      default: DEFAULT_QUESTION_PROMPT_TEMPLATE,
      label: 'Question Prompt Template',
      description: 'Template variables: {{title}}, {{description}}, {{reason}}, {{source}}, {{risk}}, {{desire}}.',
      rows: 24,
    },
    role: {
      type: 'string',
      default: 'curator',
      label: 'LLM Role',
    },
    temperature: {
      type: 'number',
      default: 0.5,
      label: 'Temperature',
    },
    maxTokens: {
      type: 'number',
      default: 500,
      label: 'Max Tokens',
    },
  },
  execute,
});
