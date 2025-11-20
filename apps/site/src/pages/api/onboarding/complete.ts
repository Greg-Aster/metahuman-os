/**
 * Onboarding Complete API
 *
 * POST: Mark onboarding as fully completed
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, getUserOrAnonymous } from '@metahuman/core';
import { completeOnboarding, getOnboardingState } from '@metahuman/core/onboarding';

/**
 * POST /api/onboarding/complete
 * Marks onboarding as complete for the current user
 */
const handler: APIRoute = async ({ cookies }) => {
  try {
    const context = getUserContext();

    if (!context || context.username === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const success = completeOnboarding(context.userId, context.username);

    if (!success) {
      return new Response(
        JSON.stringify({ error: 'Failed to complete onboarding' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const finalState = getOnboardingState(context.userId);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Onboarding completed successfully',
        state: finalState,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[onboarding/complete] POST error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to complete onboarding',
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
