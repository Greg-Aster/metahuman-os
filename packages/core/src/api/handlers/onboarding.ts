/**
 * Onboarding API Handlers
 *
 * Unified handlers for onboarding state management.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import {
  getOnboardingState,
  updateOnboardingState,
  needsOnboarding,
  skipOnboarding,
  completeOnboarding,
  type OnboardingState,
} from '../../onboarding.js';

/**
 * GET /api/onboarding/state - Get current onboarding progress
 */
export async function handleGetOnboardingState(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  try {
    const state = getOnboardingState(user.userId);
    const needs = needsOnboarding(user.userId);

    return successResponse({
      success: true,
      state,
      needsOnboarding: needs,
    });
  } catch (error) {
    console.error('[onboarding/state] GET error:', error);
    return {
      status: 500,
      error: 'Failed to get onboarding state',
    };
  }
}

/**
 * POST /api/onboarding/state - Update onboarding state
 */
export async function handleUpdateOnboardingState(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  const { updates } = (body || {}) as { updates?: Partial<OnboardingState> };

  if (!updates || typeof updates !== 'object') {
    return { status: 400, error: 'Invalid request body. Expected { updates: Partial<OnboardingState> }' };
  }

  try {
    const success = updateOnboardingState(user.userId, updates, user.username);

    if (!success) {
      return { status: 500, error: 'Failed to update onboarding state' };
    }

    const updatedState = getOnboardingState(user.userId);

    return successResponse({
      success: true,
      state: updatedState,
    });
  } catch (error) {
    console.error('[onboarding/state] POST error:', error);
    return {
      status: 500,
      error: 'Failed to update onboarding state',
    };
  }
}

/**
 * POST /api/onboarding/skip - Skip onboarding
 */
export async function handleSkipOnboarding(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  const { reason } = (body || {}) as { reason?: string };

  try {
    const success = skipOnboarding(user.userId, reason, user.username);

    if (!success) {
      return { status: 500, error: 'Failed to skip onboarding' };
    }

    const finalState = getOnboardingState(user.userId);

    return successResponse({
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
    });
  } catch (error) {
    console.error('[onboarding/skip] Error:', error);
    return { status: 500, error: 'Failed to skip onboarding' };
  }
}

/**
 * POST /api/onboarding/complete - Mark onboarding as complete
 */
export async function handleCompleteOnboarding(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return { status: 401, error: 'Authentication required' };
  }

  try {
    const success = completeOnboarding(user.userId, user.username);

    if (!success) {
      return { status: 500, error: 'Failed to complete onboarding' };
    }

    const finalState = getOnboardingState(user.userId);

    return successResponse({
      success: true,
      message: 'Onboarding completed successfully',
      state: finalState,
    });
  } catch (error) {
    console.error('[onboarding/complete] Error:', error);
    return { status: 500, error: 'Failed to complete onboarding' };
  }
}
