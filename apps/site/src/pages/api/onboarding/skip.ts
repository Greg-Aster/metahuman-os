/**
 * Onboarding Skip API
 *
 * POST: Skip onboarding wizard with optional reason
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, getUserOrAnonymous } from '@metahuman/core';
import { skipOnboarding, getOnboardingState } from '@metahuman/core/onboarding';

/**
 * POST /api/onboarding/skip
 * Skip onboarding wizard
 * Body: { reason?: string }
 */
const handler: APIRoute = async ({ cookies, request }) => {
  try {
    const context = getUserContext();

    if (!context || context.username === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { reason } = body as { reason?: string };

    const success = skipOnboarding(context.userId, reason, context.username);

    if (!success) {
      return new Response(
        JSON.stringify({ error: 'Failed to skip onboarding' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const finalState = getOnboardingState(context.userId);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Onboarding skipped',
        state: finalState,
        alternativeMethods: {
          memoryCapture: {
            description: 'Manually capture observations and events',
            locations: [
              'Chat interface (main view)',
              'CLI: ./bin/mh capture "text"',
              'API: POST /api/capture',
            ],
          },
          fileIngestion: {
            description: 'Import documents, journals, and notes',
            locations: [
              'Memory view → Upload tab',
              'CLI: ./bin/mh ingest <file>',
              'Drop files in: memory/inbox/',
            ],
          },
          audioUpload: {
            description: 'Upload voice recordings for transcription',
            locations: [
              'Audio view → Upload tab',
              'CLI: ./bin/mh audio ingest <file>',
            ],
          },
          taskCreation: {
            description: 'Create goals and to-do items',
            locations: [
              'Task Manager component',
              'CLI: ./bin/mh task add "title"',
            ],
          },
          personaEditing: {
            description: 'Manually edit identity and personality',
            locations: [
              'System settings → Persona Editor',
              'Direct JSON: profiles/{username}/persona/core.json',
            ],
          },
          userGuide: {
            description: 'Comprehensive documentation',
            locations: ['/user-guide'],
          },
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[onboarding/skip] POST error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to skip onboarding',
        details: (error as Error).message,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

// MIGRATED: 2025-11-20 - Explicit authentication pattern
export const POST = handler;
