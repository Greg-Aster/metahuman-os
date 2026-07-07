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

import { randomUUID } from 'crypto';
import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import type { Desire, ClarifyingQuestion } from '../../agency/types.js';
import { callLLMPrompt } from '../../model-router.js';
import { audit } from '../../audit.js';
import { renderPromptTemplate } from '../prompt-template.js';

/**
 * Determine if a desire needs clarifying questions.
 */
function needsClarifyingQuestions(desire: Desire): { needs: boolean; reason: string } {
  // Already has completed questions
  if (desire.clarifyingQuestions?.completedAt) {
    return { needs: false, reason: 'Questions already answered' };
  }

  // Already has pending questions (waiting for answers)
  if (desire.clarifyingQuestions?.questions?.length && !desire.clarifyingQuestions.completedAt) {
    return { needs: false, reason: 'Questions already asked, waiting for answers' };
  }

  // IMPORTANT: If desire has PREVIOUS answers (even if not completedAt), don't regenerate questions
  // This preserves context from prior questioning rounds (e.g., after revision requests)
  // The answers array contains historical context that should be retained
  if (desire.clarifyingQuestions?.answers?.length) {
    console.log('[desire-question-generator] Preserving existing answers, not regenerating questions');
    return { needs: false, reason: 'Previous answers exist, preserving context' };
  }

  // Check risk level
  const highRiskLevels = ['medium', 'high', 'critical'];
  if (highRiskLevels.includes(desire.risk || '')) {
    return { needs: true, reason: `Risk level is ${desire.risk}` };
  }

  // Check if persona goal (personal goals benefit from context)
  if (desire.source === 'persona_goal') {
    return { needs: true, reason: 'Personal goal needs context' };
  }

  // Check if description is vague
  const description = desire.description || '';
  if (description.length < 50) {
    return { needs: true, reason: 'Description is brief, needs clarification' };
  }

  // Check for vague language
  const vaguePatterns = /\b(something|somehow|maybe|might|could|would like|want to|should)\b/i;
  if (vaguePatterns.test(description)) {
    return { needs: true, reason: 'Description contains vague language' };
  }

  return { needs: false, reason: 'Desire is clear and low-risk' };
}

const DEFAULT_QUESTION_PROMPT_TEMPLATE = `You are helping gather context before creating an execution plan for a goal/desire.

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
Return ONLY a JSON array of questions. Each question should have:
- "text": the question to ask
- "type": "free_text" (for open answers), "yes_no" (for boolean), or "choice" (for options)
- "required": true or false

Example:
[
  {"text": "When would you like to start this?", "type": "free_text", "required": true},
  {"text": "Do you have any budget constraints?", "type": "yes_no", "required": false}
]

Generate questions now:`;

interface QuestionGenerationOptions {
  promptTemplate?: string;
  role?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Generate clarifying questions for a desire using LLM.
 */
async function generateQuestions(desire: Desire, options: QuestionGenerationOptions = {}): Promise<ClarifyingQuestion[]> {
  const prompt = renderPromptTemplate(options.promptTemplate ?? DEFAULT_QUESTION_PROMPT_TEMPLATE, {
    title: desire.title,
    description: desire.description,
    reason: desire.reason || 'Not specified',
    source: desire.source,
    risk: desire.risk || 'unknown',
    desire,
  });

  try {
    const response = await callLLMPrompt(options.role ?? 'curator', prompt, {
      temperature: options.temperature ?? 0.5,
      maxTokens: options.maxTokens ?? 500,
    });

    // Parse JSON response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found in response');
    }

    const rawQuestions = JSON.parse(jsonMatch[0]) as Array<{
      text: string;
      type?: string;
      required?: boolean;
      options?: string[];
    }>;

    // Convert to ClarifyingQuestion with IDs
    const questions: ClarifyingQuestion[] = rawQuestions.map((q, i) => ({
      id: `q-${randomUUID().slice(0, 8)}`,
      text: q.text,
      type: (q.type as ClarifyingQuestion['type']) || 'free_text',
      options: q.options,
      required: q.required ?? true,
    }));

    return questions.slice(0, 4); // Max 4 questions
  } catch (error) {
    console.error('[desire-question-generator] Failed to generate questions:', error);
    // Return a default question on error
    return [
      {
        id: `q-${randomUUID().slice(0, 8)}`,
        text: 'Can you provide more details about what you want to achieve?',
        type: 'free_text',
        required: true,
      },
    ];
  }
}

const execute: NodeExecutor = async (inputs, context, properties) => {
  const slot0 = (inputs.desire || inputs[0]) as { desire?: Desire; found?: boolean } | Desire | undefined;

  // Handle both wrapped and direct desire input
  const desire = (slot0 as any)?.desire || slot0 as Desire;

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
    role: properties?.role ?? 'curator',
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

// Export standalone function for use outside graph context
export { needsClarifyingQuestions, generateQuestions };
