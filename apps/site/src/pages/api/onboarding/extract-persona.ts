/**
 * Onboarding Persona Extraction API
 *
 * POST: Use LLM to extract personality traits from conversation history
 * Updates persona/core.json with Big Five traits, values, communication style
 *
 * NOTE: This endpoint now uses the shared persona extractor from @metahuman/core
 * to avoid code duplication with the persona generator feature.
 */

import type { APIRoute } from 'astro';
import { getUserContext } from '@metahuman/core/context';
import { withUserContext } from '../../../middleware/userContext';
import {
  extractPersonaFromTranscript,
  type ChatMessage,
} from '@metahuman/core/persona/extractor';
import {
  loadExistingPersona,
  mergePersonaDraft,
  savePersona,
} from '@metahuman/core/persona/merger';

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

    // Extract persona from conversation using shared extractor
    const extracted = await extractPersonaFromTranscript(messages);

    // Load existing persona
    const personaPath = context.profilePaths.personaCore;
    const currentPersona = loadExistingPersona(personaPath);

    // Merge extracted data with existing persona (using 'merge' strategy)
    const { updated } = mergePersonaDraft(currentPersona, extracted, 'merge');

    // Save updated persona
    savePersona(personaPath, updated);

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
