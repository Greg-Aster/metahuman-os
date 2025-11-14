/**
 * Persona Extractor
 *
 * Extracts personality traits, values, and goals from conversation transcripts
 * using LLM analysis. Reusable for both onboarding and persona generation.
 */

import { callLLM } from '../model-router.js';

/**
 * Chat message interface
 */
export interface ChatMessage {
  role: string;
  content: string;
}

/**
 * Big Five personality traits (0-100 scores)
 */
export interface BigFive {
  openness?: number;
  conscientiousness?: number;
  extraversion?: number;
  agreeableness?: number;
  neuroticism?: number;
}

/**
 * Core value with priority
 */
export interface CoreValue {
  priority: number;
  value: string;
  description: string;
}

/**
 * Communication style preferences
 */
export interface CommunicationStyle {
  tone?: string[];
  vocabulary?: string[];
  preferredPronouns?: string[];
}

/**
 * Persona goals (short, mid, long term)
 */
export interface PersonaGoals {
  shortTerm?: string[];
  midTerm?: string[];
  longTerm?: string[];
}

/**
 * Extracted persona draft
 */
export interface PersonaDraft {
  bigFive?: BigFive;
  values?: CoreValue[];
  communicationStyle?: CommunicationStyle;
  interests?: string[];
  goals?: PersonaGoals;
  background?: string;
  currentFocus?: string[];
  confidence?: {
    overall: number;
    categories: Record<string, number>;
  };
}

/**
 * Extract persona from conversation transcript
 *
 * @param messages - Array of chat messages (conversation history)
 * @returns Structured persona draft
 */
export async function extractPersonaFromTranscript(
  messages: ChatMessage[]
): Promise<PersonaDraft> {
  if (!messages || messages.length === 0) {
    throw new Error('Messages array is empty');
  }

  // Build conversation context for LLM
  const conversationText = messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');

  // Create system prompt for extraction
  const systemPrompt = `You are analyzing a conversation to extract personality traits and personal information. Extract the following from the user's responses:

1. Big Five Personality Traits (scores 0-100):
   - Openness (creativity, curiosity, openness to new experiences)
   - Conscientiousness (organization, discipline, reliability)
   - Extraversion (sociability, energy, assertiveness)
   - Agreeableness (compassion, cooperation, kindness)
   - Neuroticism (emotional stability - lower scores = more stable)

2. Core Values (top 3-5):
   - Priority number (1 = highest)
   - Value name (e.g., "honesty", "creativity", "family")
   - Brief description

3. Communication Style:
   - Tone (e.g., formal, casual, friendly, direct, thoughtful)
   - Vocabulary level (e.g., simple, technical, academic)
   - Preferred pronouns (if mentioned)

4. Interests and Hobbies (list)

5. Goals:
   - Short-term (next few months)
   - Mid-term (this year)
   - Long-term (1+ years)

6. Background (brief summary of formative experiences if mentioned)

7. Current Focus (what they're working on or interested in now)

**Guidelines:**
- Be conservative with Big Five scores - only assign high/low values (>70 or <30) if there's clear evidence
- Use 50 (neutral) when uncertain
- Focus on what's explicitly stated or clearly implied
- Don't infer information that isn't supported by the conversation
- Return ONLY valid JSON with no additional text

Return a JSON object with these exact field names: bigFive, values, communicationStyle, interests, goals, background, currentFocus

Conversation to analyze:
${conversationText}`;

  const extractionMessages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Please extract the personality data from the conversation above.' },
  ];

  // Call LLM with curator role for extraction
  const response = await callLLM({
    role: 'curator',
    messages: extractionMessages,
    options: {
      temperature: 0.3, // Lower temperature for consistent extraction
      max_tokens: 2000,
    },
  });

  // Parse LLM response as JSON
  let extracted: PersonaDraft;
  try {
    // Extract content from LLM response
    const responseText = typeof response === 'string' ? response : response.content;

    // Try to find JSON in the response (LLM might add explanation text)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      extracted = JSON.parse(jsonMatch[0]);
    } else {
      extracted = JSON.parse(responseText);
    }
  } catch (parseError) {
    console.error('[extractor] Failed to parse LLM response:', response);
    throw new Error('Failed to parse personality extraction: LLM response was not valid JSON');
  }

  // Calculate confidence scores based on data completeness
  const confidence = calculateConfidence(extracted);
  extracted.confidence = confidence;

  return extracted;
}

/**
 * Calculate confidence scores based on data completeness
 */
function calculateConfidence(draft: PersonaDraft): {
  overall: number;
  categories: Record<string, number>;
} {
  const categories: Record<string, number> = {
    personality: 0,
    values: 0,
    goals: 0,
    style: 0,
    background: 0,
  };

  // Personality (Big Five + interests)
  if (draft.bigFive) {
    const scores = Object.values(draft.bigFive).filter((v) => v !== undefined);
    categories.personality = Math.min(100, (scores.length / 5) * 100);
  }
  if (draft.interests && draft.interests.length > 0) {
    categories.personality = Math.max(categories.personality, 50);
  }

  // Values
  if (draft.values && draft.values.length > 0) {
    categories.values = Math.min(100, (draft.values.length / 3) * 100);
  }

  // Goals
  if (draft.goals) {
    const goalSections = [draft.goals.shortTerm, draft.goals.midTerm, draft.goals.longTerm].filter(
      (g) => g && g.length > 0
    );
    categories.goals = Math.min(100, (goalSections.length / 3) * 100);
  }

  // Style
  if (draft.communicationStyle) {
    const styleFields = [
      draft.communicationStyle.tone,
      draft.communicationStyle.vocabulary,
      draft.communicationStyle.preferredPronouns,
    ].filter((f) => f && f.length > 0);
    categories.style = Math.min(100, (styleFields.length / 3) * 100);
  }

  // Background
  if (draft.background || (draft.currentFocus && draft.currentFocus.length > 0)) {
    categories.background = 50;
  }
  if (draft.background && draft.currentFocus && draft.currentFocus.length > 0) {
    categories.background = 100;
  }

  // Overall confidence is average of all categories
  const overall =
    Object.values(categories).reduce((sum, score) => sum + score, 0) /
    Object.keys(categories).length;

  return {
    overall: Math.round(overall),
    categories,
  };
}

/**
 * Extract persona from interview session
 * Convenience method that converts session format to messages
 */
export async function extractPersonaFromSession(session: {
  questions: Array<{ id: string; prompt: string }>;
  answers: Array<{ questionId: string; content: string }>;
}): Promise<PersonaDraft> {
  const messages: ChatMessage[] = [];

  // Convert session Q&A to chat messages
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

  return extractPersonaFromTranscript(messages);
}
