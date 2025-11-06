/**
 * Onboarding Persona Extraction API
 *
 * POST: Use LLM to extract personality traits from conversation history
 * Updates persona/core.json with Big Five traits, values, communication style
 */

import type { APIRoute } from 'astro';
import { getUserContext } from '@metahuman/core/context';
import { withUserContext } from '../../../middleware/userContext';
import { callLLM } from '@metahuman/core/model-router';
import fs from 'node:fs';

interface ChatMessage {
  role: string;
  content: string;
}

interface ExtractedPersona {
  bigFive?: {
    openness?: number;
    conscientiousness?: number;
    extraversion?: number;
    agreeableness?: number;
    neuroticism?: number;
  };
  values?: Array<{ priority: number; value: string; description: string }>;
  communicationStyle?: {
    tone?: string[];
    vocabulary?: string[];
    preferredPronouns?: string[];
  };
  interests?: string[];
  goals?: {
    shortTerm?: string[];
    midTerm?: string[];
    longTerm?: string[];
  };
}

/**
 * POST /api/onboarding/extract-persona
 * Extract personality data from conversation
 * Body: { messages: ChatMessage[] }
 */
const handler: APIRoute = async ({ request }) => {
  try {
    const context = getUserContext();

    if (!context || context.username === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { messages } = body as { messages: ChatMessage[] };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid request body. Expected { messages: ChatMessage[] }' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Build conversation context for LLM
    const conversationText = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n\n');

    // Use Model Router with curator role for extraction
    const systemPrompt = `You are analyzing a conversation to extract personality traits and personal information. Extract the following from the user's responses:

1. Big Five Personality Traits (scores 0-100):
   - Openness (creativity, curiosity)
   - Conscientiousness (organization, discipline)
   - Extraversion (sociability, energy)
   - Agreeableness (compassion, cooperation)
   - Neuroticism (emotional stability, lower = more stable)

2. Core Values (top 3-5):
   - Priority number
   - Value name
   - Brief description

3. Communication Style:
   - Tone (formal, casual, friendly, etc.)
   - Vocabulary level (simple, technical, academic, etc.)
   - Preferred pronouns

4. Interests and Hobbies (list)

5. Goals (short-term, mid-term, long-term)

Return a JSON object with these fields. Be conservative with scores - only assign high/low values if there's clear evidence. Use 50 (neutral) when uncertain.

Conversation to analyze:
${conversationText}`;

    const extractionMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Please extract the personality data from the conversation above.' },
    ];

    const response = await callLLM({
      role: 'curator',
      messages: extractionMessages,
      options: {
        temperature: 0.3, // Lower temperature for consistent extraction
        max_tokens: 2000,
      },
    });

    // Parse LLM response as JSON
    let extracted: ExtractedPersona;
    try {
      // Try to find JSON in the response (LLM might add explanation text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        extracted = JSON.parse(jsonMatch[0]);
      } else {
        extracted = JSON.parse(response);
      }
    } catch (parseError) {
      console.error('[extract-persona] Failed to parse LLM response:', response);
      return new Response(
        JSON.stringify({
          error: 'Failed to parse personality extraction',
          details: 'LLM response was not valid JSON',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Load existing persona/core.json
    const personaPath = context.profilePaths.personaCore;
    let personaData: any = {};

    if (fs.existsSync(personaPath)) {
      try {
        personaData = JSON.parse(fs.readFileSync(personaPath, 'utf-8'));
      } catch (error) {
        console.warn('[extract-persona] Failed to load existing persona, starting fresh');
      }
    }

    // Merge extracted data with existing persona
    if (extracted.bigFive) {
      personaData.personality = personaData.personality || {};
      personaData.personality.bigFive = {
        ...personaData.personality.bigFive,
        ...extracted.bigFive,
      };
    }

    if (extracted.values && extracted.values.length > 0) {
      personaData.values = personaData.values || {};
      personaData.values.core = extracted.values;
    }

    if (extracted.communicationStyle) {
      personaData.personality = personaData.personality || {};
      personaData.personality.communicationStyle = {
        ...personaData.personality.communicationStyle,
        ...extracted.communicationStyle,
      };
    }

    if (extracted.interests && extracted.interests.length > 0) {
      personaData.personality = personaData.personality || {};
      personaData.personality.interests = extracted.interests;
    }

    if (extracted.goals) {
      personaData.goals = {
        ...personaData.goals,
        ...extracted.goals,
      };
    }

    // Update lastUpdated timestamp
    personaData.lastUpdated = new Date().toISOString();

    // Save updated persona
    fs.mkdirSync(context.profilePaths.persona, { recursive: true });
    fs.writeFileSync(personaPath, JSON.stringify(personaData, null, 2), 'utf-8');

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Personality data extracted and saved',
        extracted,
        personaPath,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[onboarding/extract-persona] POST error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to extract personality data',
        details: (error as Error).message,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

export const POST = withUserContext(handler);
