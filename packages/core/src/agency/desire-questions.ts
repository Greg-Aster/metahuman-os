import { randomUUID } from 'node:crypto';

import { callLLMPrompt, type ModelRole } from '../model-router.js';
import { renderPromptTemplate } from '../nodes/prompt-template.js';
import type { ClarifyingQuestion, Desire } from './types.js';

export const DEFAULT_QUESTION_PROMPT_TEMPLATE = `You are helping gather context before creating an execution plan for a goal/desire.

## Desire Information
**Title:** {{title}}
**Description:** {{description}}
**Reason:** {{reason}}
**Source:** {{source}}
**Risk Level:** {{risk}}

## Task
Generate 2-4 clarifying questions to help create a better, more personalized plan.

Focus on questions that help understand:
- Timeline or urgency (when should this happen?)
- Specific constraints or limitations
- Success criteria (how will we know it's done?)
- Available resources or budget
- Prior experience or relevant background
- Preferences or priorities

## Response Format
Return ONLY a JSON array of questions. Each question must have:
- "text": the question to ask
- "type": "free_text" (for open answers), "yes_no" (for boolean), or "choice" (for options)
- "required": true or false

Example:
[
  {"text": "When would you like to start this?", "type": "free_text", "required": true},
  {"text": "Do you have any budget constraints?", "type": "yes_no", "required": false}
]

Generate questions now:`;

export interface QuestionGenerationOptions {
  promptTemplate?: string;
  role?: ModelRole;
  temperature?: number;
  maxTokens?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Determine whether planning requires another round of user clarification.
 */
export function needsClarifyingQuestions(desire: Desire): { needs: boolean; reason: string } {
  if (desire.clarifyingQuestions?.completedAt) {
    return { needs: false, reason: 'Questions already answered' };
  }

  if (desire.clarifyingQuestions?.questions?.length && !desire.clarifyingQuestions.completedAt) {
    return { needs: false, reason: 'Questions already asked, waiting for answers' };
  }

  if (desire.clarifyingQuestions?.answers?.length) {
    return { needs: false, reason: 'Previous answers exist, preserving context' };
  }

  if (['medium', 'high', 'critical'].includes(desire.risk || '')) {
    return { needs: true, reason: `Risk level is ${desire.risk}` };
  }

  if (desire.source === 'persona_goal') {
    return { needs: true, reason: 'Personal goal needs context' };
  }

  const description = desire.description || '';
  if (description.length < 50) {
    return { needs: true, reason: 'Description is brief, needs clarification' };
  }

  const vaguePatterns = /\b(something|somehow|maybe|might|could|would like|want to|should)\b/i;
  if (vaguePatterns.test(description)) {
    return { needs: true, reason: 'Description contains vague language' };
  }

  return { needs: false, reason: 'Desire is clear and low-risk' };
}

/**
 * Parse and validate the model contract. Invalid output remains a retryable
 * planning failure instead of being converted into a fabricated question.
 */
export function parseDesireQuestionsResponse(response: string): ClarifyingQuestion[] {
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('Question generation response did not contain a JSON array');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (error) {
    throw new Error(`Question generation response was not valid JSON: ${(error as Error).message}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 4) {
    throw new Error('Question generation response must contain between 1 and 4 questions');
  }

  return parsed.map((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new Error(`Question ${index + 1} must be an object`);
    }

    const text = typeof candidate.text === 'string' ? candidate.text.trim() : '';
    if (!text) {
      throw new Error(`Question ${index + 1} must include non-empty text`);
    }

    const type = candidate.type;
    if (type !== 'free_text' && type !== 'yes_no' && type !== 'choice') {
      throw new Error(`Question ${index + 1} has an unsupported type`);
    }

    if (typeof candidate.required !== 'boolean') {
      throw new Error(`Question ${index + 1} must declare whether it is required`);
    }

    let options: string[] | undefined;
    if (candidate.options !== undefined) {
      if (!Array.isArray(candidate.options)
        || candidate.options.some(option => typeof option !== 'string' || option.trim().length === 0)) {
        throw new Error(`Question ${index + 1} options must be non-empty strings`);
      }
      options = candidate.options.map(option => (option as string).trim());
    }

    if (type === 'choice' && (!options || options.length < 2)) {
      throw new Error(`Choice question ${index + 1} must include at least two options`);
    }

    return {
      id: `q-${randomUUID().slice(0, 8)}`,
      text,
      type,
      options,
      required: candidate.required,
    };
  });
}

/**
 * Generate clarifying questions through the configured model owner. Provider and
 * contract failures intentionally propagate to Desire Planner for retry/audit.
 */
export async function generateQuestions(
  desire: Desire,
  options: QuestionGenerationOptions = {},
): Promise<ClarifyingQuestion[]> {
  const prompt = renderPromptTemplate(options.promptTemplate ?? DEFAULT_QUESTION_PROMPT_TEMPLATE, {
    title: desire.title,
    description: desire.description,
    reason: desire.reason || 'Not specified',
    source: desire.source,
    risk: desire.risk || 'unknown',
    desire,
  });

  const response = await callLLMPrompt(options.role ?? 'curator', prompt, {
    temperature: options.temperature ?? 0.5,
    maxTokens: options.maxTokens ?? 500,
  });

  return parseDesireQuestionsResponse(response);
}
