/**
 * Onboarding State API
 *
 * GET: Return current onboarding progress for authenticated user
 * POST: Update onboarding state (step completion, data counters)
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, getUserOrAnonymous } from '@metahuman/core';
import {
  getOnboardingState,
  updateOnboardingState,
  needsOnboarding,
  type OnboardingState,
} from '@metahuman/core/onboarding';

/**
 * GET /api/onboarding/state
 * Returns current onboarding progress
 */
const getHandler: APIRoute = async ({ cookies }) => {
  try {
    const context = getUserContext();

    if (!context || context.username === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const state = getOnboardingState(context.userId);
    const needs = needsOnboarding(context.userId);

    return new Response(
      JSON.stringify({
        success: true,
        state,
        needsOnboarding: needs,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[onboarding/state] GET error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to get onboarding state',
        details: (error as Error).message,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

/**
 * POST /api/onboarding/state
 * Update onboarding state
 * Body: { updates: Partial<OnboardingState> }
 */
const postHandler: APIRoute = async ({ cookies, request }) => {
  try {
    const context = getUserContext();

    if (!context || context.username === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { updates } = body as { updates: Partial<OnboardingState> };

    if (!updates || typeof updates !== 'object') {
      return new Response(
        JSON.stringify({ error: 'Invalid request body. Expected { updates: Partial<OnboardingState> }' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const success = updateOnboardingState(context.userId, updates, context.username);

    if (!success) {
      return new Response(
        JSON.stringify({ error: 'Failed to update onboarding state' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const updatedState = getOnboardingState(context.userId);

    return new Response(
      JSON.stringify({
        success: true,
        state: updatedState,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[onboarding/state] POST error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to update onboarding state',
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
export const GET = getHandler;
// MIGRATED: 2025-11-20 - Explicit authentication pattern
export const POST = postHandler;
