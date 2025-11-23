/**
 * Onboarding Types
 *
 * Shared types for onboarding state management.
 * Extracted to prevent circular dependencies between users.ts and onboarding.ts
 */

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
