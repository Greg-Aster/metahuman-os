/**
 * Onboarding State Management
 *
 * Tracks user progress through the onboarding wizard for new accounts.
 * Provides resumable onboarding with step-by-step data collection.
 */

import fs from 'node:fs';
import { getUser, updateUserMetadata } from './users.js';
import { audit } from './audit.js';

export interface OnboardingState {
  completed: boolean;
  currentStep: number;
  stepsCompleted: {
    welcome: boolean;
    identity: boolean;
    personality: boolean;
    context: boolean;
    goals: boolean;
    review: boolean;
  };
  dataCollected: {
    identityQuestions: number;
    personalityQuestions: number;
    filesIngested: number;
    tasksCreated: number;
    memoriesCreated: number;
  };
  startedAt?: string;
  completedAt?: string;
  skipped: boolean;
  skipReason?: string;
}

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  completed: false,
  currentStep: 1,
  stepsCompleted: {
    welcome: false,
    identity: false,
    personality: false,
    context: false,
    goals: false,
    review: false,
  },
  dataCollected: {
    identityQuestions: 0,
    personalityQuestions: 0,
    filesIngested: 0,
    tasksCreated: 0,
    memoriesCreated: 0,
  },
  skipped: false,
};

/**
 * Get onboarding state for a user
 */
export function getOnboardingState(userId: string): OnboardingState | null {
  try {
    const user = getUser(userId);
    if (!user) {
      return null;
    }

    // Return onboarding state from metadata, or default state if not present
    return user.metadata?.onboardingState || { ...DEFAULT_ONBOARDING_STATE };
  } catch (error) {
    console.error('[onboarding] Failed to get onboarding state:', error);
    return null;
  }
}

/**
 * Update onboarding state for a user
 */
export function updateOnboardingState(
  userId: string,
  updates: Partial<OnboardingState>,
  actor: string = 'system'
): boolean {
  try {
    const user = getUser(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    // Merge updates with existing state
    const currentState = user.metadata?.onboardingState || { ...DEFAULT_ONBOARDING_STATE };
    const newState: OnboardingState = { ...currentState, ...updates };

    // Persist onboarding state in user metadata
    updateUserMetadata(userId, {
      onboardingState: newState,
    });

    audit({
      level: 'info',
      category: 'action',
      event: 'onboarding_state_updated',
      details: {
        userId,
        currentStep: newState.currentStep,
        stepsCompleted: newState.stepsCompleted,
        dataCollected: newState.dataCollected,
      },
      actor,
    });

    return true;
  } catch (error) {
    console.error('[onboarding] Failed to update onboarding state:', error);
    audit({
      level: 'error',
      category: 'action',
      event: 'onboarding_state_update_failed',
      details: { userId, error: (error as Error).message },
      actor,
    });
    return false;
  }
}

/**
 * Mark a specific step as completed
 */
export function completeStep(
  userId: string,
  step: keyof OnboardingState['stepsCompleted'],
  actor: string = 'system'
): boolean {
  try {
    const state = getOnboardingState(userId);
    if (!state) {
      return false;
    }

    const updates: Partial<OnboardingState> = {
      stepsCompleted: {
        ...state.stepsCompleted,
        [step]: true,
      },
    };

    // Auto-advance to next step
    const stepOrder: (keyof OnboardingState['stepsCompleted'])[] = [
      'welcome',
      'identity',
      'personality',
      'context',
      'goals',
      'review',
    ];
    const currentIndex = stepOrder.indexOf(step);
    if (currentIndex !== -1 && currentIndex < stepOrder.length - 1) {
      updates.currentStep = currentIndex + 2; // +2 because steps are 1-indexed
    }

    return updateOnboardingState(userId, updates, actor);
  } catch (error) {
    console.error('[onboarding] Failed to complete step:', error);
    return false;
  }
}

/**
 * Mark onboarding as fully completed
 */
export function completeOnboarding(userId: string, actor: string = 'system'): boolean {
  try {
    const updates: Partial<OnboardingState> = {
      completed: true,
      completedAt: new Date().toISOString(),
    };

    const success = updateOnboardingState(userId, updates, actor);

    if (success) {
      audit({
        level: 'info',
        category: 'action',
        event: 'onboarding_completed',
        details: { userId },
        actor,
      });
    }

    return success;
  } catch (error) {
    console.error('[onboarding] Failed to complete onboarding:', error);
    return false;
  }
}

/**
 * Skip onboarding wizard
 */
export function skipOnboarding(
  userId: string,
  reason?: string,
  actor: string = 'system'
): boolean {
  try {
    const updates: Partial<OnboardingState> = {
      skipped: true,
      skipReason: reason,
      completedAt: new Date().toISOString(),
    };

    const success = updateOnboardingState(userId, updates, actor);

    if (success) {
      audit({
        level: 'info',
        category: 'action',
        event: 'onboarding_skipped',
        details: { userId, reason },
        actor,
      });
    }

    return success;
  } catch (error) {
    console.error('[onboarding] Failed to skip onboarding:', error);
    return false;
  }
}

/**
 * Increment data collected counter
 */
export function incrementDataCounter(
  userId: string,
  counter: keyof OnboardingState['dataCollected'],
  amount: number = 1,
  actor: string = 'system'
): boolean {
  try {
    const state = getOnboardingState(userId);
    if (!state) {
      return false;
    }

    const updates: Partial<OnboardingState> = {
      dataCollected: {
        ...state.dataCollected,
        [counter]: state.dataCollected[counter] + amount,
      },
    };

    return updateOnboardingState(userId, updates, actor);
  } catch (error) {
    console.error('[onboarding] Failed to increment data counter:', error);
    return false;
  }
}

/**
 * Check if user needs onboarding
 */
export function needsOnboarding(userId: string): boolean {
  const state = getOnboardingState(userId);
  if (!state) {
    return true; // New user, needs onboarding
  }
  return !state.completed && !state.skipped;
}

/**
 * Reset onboarding state (for testing or re-onboarding)
 */
export function resetOnboarding(userId: string, actor: string = 'system'): boolean {
  try {
    const success = updateOnboardingState(
      userId,
      { ...DEFAULT_ONBOARDING_STATE, startedAt: new Date().toISOString() },
      actor
    );

    if (success) {
      audit({
        level: 'info',
        category: 'action',
        event: 'onboarding_reset',
        details: { userId },
        actor,
      });
    }

    return success;
  } catch (error) {
    console.error('[onboarding] Failed to reset onboarding:', error);
    return false;
  }
}
