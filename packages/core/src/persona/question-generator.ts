/**
 * Persona Interview Question Generator
 *
 * Uses LLM with psychotherapist role to generate adaptive follow-up questions
 * based on user responses and category coverage gaps.
 */

import { callLLM } from '../model-router.js';
import type { Session, Question, Answer, CategoryCoverage } from './session-manager.js';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, systemPaths } from '../path-builder.js';

/**
 * Configuration for question generation
 */
interface GeneratorConfig {
  maxQuestionsPerSession: number;
  requireMinimumAnswers: number;
  targetCategoryCompletionPercentage: number;
  categories: string[];
}

/**
 * Load configuration from etc/persona-generator.json
 */
function loadConfig(): GeneratorConfig {
  const configPath = path.join(systemPaths.etc, 'persona-generator.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return {
    maxQuestionsPerSession: config.maxQuestionsPerSession || 15,
    requireMinimumAnswers: config.requireMinimumAnswers || 7,
    targetCategoryCompletionPercentage: config.sessionDefaults?.targetCategoryCompletionPercentage || 80,
    categories: config.categories || [],
  };
}

/**
 * Load psychotherapist profile for context
 */
function loadPsychotherapistProfile(): any {
  const profilePath = path.join(ROOT, 'persona', 'profiles', 'psychotherapist.json');
  return JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
}

/**
 * Identify category gaps in the interview
 */
function identifyCategoryGaps(
  categoryCoverage: CategoryCoverage,
  targetPercentage: number
): string[] {
  const gaps: string[] = [];

  for (const [category, percentage] of Object.entries(categoryCoverage)) {
    if (percentage < targetPercentage) {
      gaps.push(category);
    }
  }

  return gaps;
}

/**
 * Build conversation history for LLM context
 */
function buildConversationHistory(session: Session): { role: string; content: string }[] {
  const messages: { role: string; content: string }[] = [];

  // Add each Q&A pair
  for (const question of session.questions) {
    const answer = session.answers.find((a) => a.questionId === question.id);

    messages.push({
      role: 'assistant',
      content: question.prompt,
    });

    if (answer) {
      messages.push({
        role: 'user',
        content: answer.content,
      });
    }
  }

  return messages;
}

/**
 * Generate next question based on interview progress
 * Returns null if interview is complete
 */
export async function generateNextQuestion(
  session: Session
): Promise<{ question: Question; reasoning: string } | null> {
  const config = loadConfig();
  const profile = loadPsychotherapistProfile();

  // Check if interview is complete
  const isComplete = checkIfComplete(session, config);
  if (isComplete) {
    return null;
  }

  // Identify gaps
  const gaps = identifyCategoryGaps(session.categoryCoverage, config.targetCategoryCompletionPercentage);

  // Build conversation history
  const conversationHistory = buildConversationHistory(session);

  // Create system prompt
  const systemPrompt = createSystemPrompt(profile, session, gaps, config);

  // Call LLM with psychotherapist role
  const response = await callLLM({
    role: 'psychotherapist',
    messages: [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      {
        role: 'system',
        content: 'Based on the conversation so far and the category gaps identified, generate the next question. Respond with JSON in this exact format: {"question": "your question here", "category": "values|goals|style|biography|current_focus", "reasoning": "brief explanation of why this question"}',
      },
    ],
    options: {
      temperature: 0.7,
      format: 'json',
    },
  });

  // Parse response
  let parsed: any;
  try {
    // Extract content from LLM response
    const responseText = typeof response === 'string' ? response : response.content;

    // Try to extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    } else {
      parsed = JSON.parse(responseText);
    }
  } catch (error) {
    console.error('[question-generator] Failed to parse LLM response:', response);
    throw new Error('Failed to parse question from LLM response');
  }

  // Validate response
  if (!parsed.question || !parsed.category) {
    throw new Error('LLM response missing required fields (question, category)');
  }

  // Create Question object
  const question: Question = {
    id: `q${session.questions.length + 1}-${Date.now()}`,
    prompt: parsed.question,
    category: parsed.category,
    generatedAt: new Date().toISOString(),
  };

  return {
    question,
    reasoning: parsed.reasoning || 'No reasoning provided',
  };
}

/**
 * Create system prompt for question generation
 */
function createSystemPrompt(
  profile: any,
  session: Session,
  gaps: string[],
  config: GeneratorConfig
): string {
  const questionsAsked = session.questions.length;
  const answersReceived = session.answers.length;
  const maxQuestions = config.maxQuestionsPerSession;

  return `You are a skilled psychotherapist conducting a personality assessment interview. Your goal is to understand the user's authentic personality, values, goals, and communication style through empathetic questioning.

**Interview Progress:**
- Questions asked: ${questionsAsked}/${maxQuestions}
- Answers received: ${answersReceived}
- Category coverage gaps: ${gaps.length > 0 ? gaps.join(', ') : 'none'}

**Category Coverage:**
${Object.entries(session.categoryCoverage).map(([cat, pct]) => `- ${cat}: ${pct}%`).join('\n')}

**Your Interviewing Approach:**
${profile.methodology.corePhilosophy}

**Techniques to Use:**
- ${profile.interviewingTechniques.openEndedQuestions.description}
- ${profile.interviewingTechniques.reflectiveListening.description}
- ${profile.interviewingTechniques.followUpProbing.description}

**Privacy Guidelines:**
${profile.privacyAndEthics.neverAskFor.map((item: string) => `- Never ask for: ${item}`).join('\n')}

**Your Task:**
Generate the next question that:
1. Addresses one of the category gaps (prioritize: ${gaps.slice(0, 2).join(', ')})
2. Builds naturally on the previous conversation
3. Encourages deep, authentic responses
4. Avoids redundancy with previous questions
5. Respects privacy boundaries

**Question Generation Strategy:**
- If gaps exist, focus on the least-covered category
- If coverage is balanced, probe deeper into interesting threads from previous answers
- Use reflective listening ("You mentioned X...") when appropriate
- Avoid yes/no questions
- Ask for specific examples when possible

Return your response in JSON format with these exact fields:
- "question": The question text (clear, concise, open-ended)
- "category": One of: ${config.categories.join(', ')}
- "reasoning": Brief explanation of why you chose this question (1 sentence)`;
}

/**
 * Check if interview is complete
 */
function checkIfComplete(session: Session, config: GeneratorConfig): boolean {
  // Hit max questions
  if (session.questions.length >= config.maxQuestionsPerSession) {
    return true;
  }

  // Minimum answers not met
  if (session.answers.length < config.requireMinimumAnswers) {
    return false;
  }

  // Check if all categories meet target coverage
  const allCategoriesMeetTarget = Object.values(session.categoryCoverage).every(
    (percentage) => percentage >= config.targetCategoryCompletionPercentage
  );

  return allCategoriesMeetTarget;
}

/**
 * Get completion status and progress
 */
export function getCompletionStatus(session: Session): {
  isComplete: boolean;
  progress: CategoryCoverage;
  questionsRemaining: number;
  message: string;
} {
  const config = loadConfig();
  const isComplete = checkIfComplete(session, config);
  const gaps = identifyCategoryGaps(session.categoryCoverage, config.targetCategoryCompletionPercentage);

  let message = '';
  if (isComplete) {
    message = 'Interview complete! All categories have sufficient coverage.';
  } else if (session.questions.length >= config.maxQuestionsPerSession) {
    message = 'Maximum questions reached.';
  } else if (gaps.length > 0) {
    message = `Still exploring: ${gaps.slice(0, 2).join(', ')}`;
  } else {
    message = 'Building deeper understanding...';
  }

  return {
    isComplete,
    progress: session.categoryCoverage,
    questionsRemaining: Math.max(0, config.maxQuestionsPerSession - session.questions.length),
    message,
  };
}
