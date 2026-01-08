/**
 * Pause Manager - Centralized Pause State for Active Operator
 *
 * Tracks all reasons to pause the Active Operator decision loop:
 * - TTS speaking (client feedback)
 * - Curiosity questions awaiting response
 * - Desires awaiting user input (questioning/approval states)
 * - Active user conversation
 *
 * Each user has their own pause state (multi-user system).
 */

import { audit } from '../audit.js';

const LOG_PREFIX = '[pause-manager]';

// Timeout constants
const TTS_TIMEOUT_MS = 60000; // 60 seconds - assume TTS done if no update
const CURIOSITY_TIMEOUT_MS = 300000; // 5 minutes for curiosity response
const CONVERSATION_COOLDOWN_MS = 90000; // 90 seconds after last user message

/**
 * Pause state for a single user.
 */
interface UserPauseState {
  // TTS state
  ttsSpeaking: boolean;
  ttsLastUpdate: Date | null;

  // Curiosity state
  awaitingCuriosityResponse: boolean;
  curiosityQuestionId: string | null;
  curiosityAskedAt: Date | null;

  // Desire state
  awaitingDesireInput: boolean;
  desireAwaitingId: string | null;

  // Conversation state
  activeConversation: boolean;
  lastUserMessage: Date | null;
  llmStreaming: boolean;
}

/**
 * Pause check result.
 */
export interface PauseCheckResult {
  shouldPause: boolean;
  reason: string;
  waitMs: number;
  pauseType?: 'tts' | 'curiosity' | 'desire' | 'conversation' | 'streaming';
}

// Per-user pause state storage
const userPauseStates = new Map<string, UserPauseState>();

/**
 * Get or create pause state for a user.
 */
function getOrCreateState(username: string): UserPauseState {
  let state = userPauseStates.get(username);
  if (!state) {
    state = {
      ttsSpeaking: false,
      ttsLastUpdate: null,
      awaitingCuriosityResponse: false,
      curiosityQuestionId: null,
      curiosityAskedAt: null,
      awaitingDesireInput: false,
      desireAwaitingId: null,
      activeConversation: false,
      lastUserMessage: null,
      llmStreaming: false,
    };
    userPauseStates.set(username, state);
  }
  return state;
}

// ============================================================================
// TTS State Management
// ============================================================================

/**
 * Update TTS speaking state.
 * Called by the client-side TTS feedback endpoint.
 */
export function updateTTSState(username: string, speaking: boolean): void {
  const state = getOrCreateState(username);
  state.ttsSpeaking = speaking;
  state.ttsLastUpdate = new Date();

  console.log(`${LOG_PREFIX} TTS state updated for ${username}: speaking=${speaking}`);

  audit({
    level: 'info',
    category: 'action',
    event: 'pause_tts_state_changed',
    actor: 'pause-manager',
    details: { username, speaking },
  });
}

/**
 * Check if TTS is currently speaking (with timeout fallback).
 */
export function isTTSSpeaking(username: string): boolean {
  const state = getOrCreateState(username);

  if (!state.ttsSpeaking) {
    return false;
  }

  // Check for timeout - if no update in 60s, assume TTS is done
  if (state.ttsLastUpdate) {
    const msSinceUpdate = Date.now() - state.ttsLastUpdate.getTime();
    if (msSinceUpdate > TTS_TIMEOUT_MS) {
      console.log(`${LOG_PREFIX} TTS timeout for ${username}, assuming speech finished`);
      state.ttsSpeaking = false;
      return false;
    }
  }

  return true;
}

// ============================================================================
// Curiosity State Management
// ============================================================================

/**
 * Set curiosity question awaiting response.
 * Called when a curiosity question is displayed to the user.
 */
export function setCuriosityAwaiting(username: string, questionId: string): void {
  const state = getOrCreateState(username);
  state.awaitingCuriosityResponse = true;
  state.curiosityQuestionId = questionId;
  state.curiosityAskedAt = new Date();

  console.log(`${LOG_PREFIX} Curiosity awaiting for ${username}: questionId=${questionId}`);

  audit({
    level: 'info',
    category: 'action',
    event: 'pause_curiosity_awaiting',
    actor: 'pause-manager',
    details: { username, questionId },
  });
}

/**
 * Clear curiosity awaiting state.
 * Called when user responds or skips the question.
 */
export function clearCuriosityAwaiting(username: string, reason: 'responded' | 'skipped' | 'timeout'): void {
  const state = getOrCreateState(username);
  const questionId = state.curiosityQuestionId;

  state.awaitingCuriosityResponse = false;
  state.curiosityQuestionId = null;
  state.curiosityAskedAt = null;

  console.log(`${LOG_PREFIX} Curiosity cleared for ${username}: reason=${reason}`);

  audit({
    level: 'info',
    category: 'action',
    event: 'pause_curiosity_cleared',
    actor: 'pause-manager',
    details: { username, reason, questionId },
  });
}

/**
 * Check if awaiting curiosity response (with timeout).
 */
export function isAwaitingCuriosity(username: string): { awaiting: boolean; questionId: string | null; remainingMs: number } {
  const state = getOrCreateState(username);

  if (!state.awaitingCuriosityResponse || !state.curiosityAskedAt) {
    return { awaiting: false, questionId: null, remainingMs: 0 };
  }

  const msSinceAsked = Date.now() - state.curiosityAskedAt.getTime();
  const remainingMs = Math.max(0, CURIOSITY_TIMEOUT_MS - msSinceAsked);

  // Auto-clear if timeout exceeded
  if (remainingMs === 0) {
    console.log(`${LOG_PREFIX} Curiosity timeout for ${username}, auto-clearing`);
    clearCuriosityAwaiting(username, 'timeout');
    return { awaiting: false, questionId: null, remainingMs: 0 };
  }

  return {
    awaiting: true,
    questionId: state.curiosityQuestionId,
    remainingMs,
  };
}

// ============================================================================
// Desire State Management
// ============================================================================

/**
 * Set desire awaiting user input.
 * Called when a desire is in questioning or awaiting_approval state.
 */
export function setDesireAwaiting(username: string, desireId: string): void {
  const state = getOrCreateState(username);
  state.awaitingDesireInput = true;
  state.desireAwaitingId = desireId;

  console.log(`${LOG_PREFIX} Desire awaiting for ${username}: desireId=${desireId}`);

  audit({
    level: 'info',
    category: 'action',
    event: 'pause_desire_awaiting',
    actor: 'pause-manager',
    details: { username, desireId },
  });
}

/**
 * Clear desire awaiting state.
 * Called when user responds to desire input.
 */
export function clearDesireAwaiting(username: string): void {
  const state = getOrCreateState(username);
  const desireId = state.desireAwaitingId;

  state.awaitingDesireInput = false;
  state.desireAwaitingId = null;

  console.log(`${LOG_PREFIX} Desire cleared for ${username}`);

  audit({
    level: 'info',
    category: 'action',
    event: 'pause_desire_cleared',
    actor: 'pause-manager',
    details: { username, desireId },
  });
}

/**
 * Check if awaiting desire input.
 */
export function isAwaitingDesireInput(username: string): { awaiting: boolean; desireId: string | null } {
  const state = getOrCreateState(username);
  return {
    awaiting: state.awaitingDesireInput,
    desireId: state.desireAwaitingId,
  };
}

// ============================================================================
// Conversation State Management
// ============================================================================

/**
 * Record that a user message was received.
 * Called when user sends a chat message.
 */
export function recordUserMessage(username: string): void {
  const state = getOrCreateState(username);
  state.lastUserMessage = new Date();
  state.activeConversation = true;

  console.log(`${LOG_PREFIX} User message recorded for ${username}`);
}

/**
 * Set LLM streaming state.
 * Called when SSE stream starts/ends.
 */
export function setLLMStreaming(username: string, streaming: boolean): void {
  const state = getOrCreateState(username);
  state.llmStreaming = streaming;

  console.log(`${LOG_PREFIX} LLM streaming for ${username}: ${streaming}`);
}

/**
 * Check if user is in active conversation.
 * Active = sent message within cooldown period OR LLM is streaming.
 */
export function isActiveConversation(username: string): boolean {
  const state = getOrCreateState(username);

  // Currently streaming a response
  if (state.llmStreaming) {
    return true;
  }

  // Check last message time
  if (state.lastUserMessage) {
    const msSinceLastMessage = Date.now() - state.lastUserMessage.getTime();
    if (msSinceLastMessage < CONVERSATION_COOLDOWN_MS) {
      return true;
    } else {
      // Cooldown expired, mark conversation as inactive
      state.activeConversation = false;
    }
  }

  return false;
}

// ============================================================================
// Main Pause Check Function
// ============================================================================

/**
 * Check if Active Operator should pause for user interaction.
 * Returns the reason and suggested wait time.
 */
export function shouldPauseForUser(username: string): PauseCheckResult {
  // Priority 1: LLM is actively streaming a response
  const state = getOrCreateState(username);
  if (state.llmStreaming) {
    return {
      shouldPause: true,
      reason: 'LLM is streaming a response',
      waitMs: 5000, // Check again in 5 seconds
      pauseType: 'streaming',
    };
  }

  // Priority 2: TTS is speaking
  if (isTTSSpeaking(username)) {
    return {
      shouldPause: true,
      reason: 'TTS is speaking',
      waitMs: 5000, // Check again in 5 seconds
      pauseType: 'tts',
    };
  }

  // Priority 3: Active conversation (user sent message recently)
  if (isActiveConversation(username)) {
    const msSinceMessage = state.lastUserMessage
      ? Date.now() - state.lastUserMessage.getTime()
      : 0;
    const remainingMs = Math.max(0, CONVERSATION_COOLDOWN_MS - msSinceMessage);

    return {
      shouldPause: true,
      reason: 'User is in active conversation',
      waitMs: Math.min(remainingMs, 30000), // Check at least every 30 seconds
      pauseType: 'conversation',
    };
  }

  // Priority 4: Curiosity question awaiting response
  const curiosityStatus = isAwaitingCuriosity(username);
  if (curiosityStatus.awaiting) {
    return {
      shouldPause: true,
      reason: `Awaiting curiosity response (${Math.round(curiosityStatus.remainingMs / 1000)}s remaining)`,
      waitMs: Math.min(curiosityStatus.remainingMs, 30000), // Check at least every 30 seconds
      pauseType: 'curiosity',
    };
  }

  // Priority 5: Desire awaiting input
  const desireStatus = isAwaitingDesireInput(username);
  if (desireStatus.awaiting) {
    return {
      shouldPause: true,
      reason: `Awaiting desire input (${desireStatus.desireId})`,
      waitMs: 30000, // Check every 30 seconds
      pauseType: 'desire',
    };
  }

  // No pause needed
  return {
    shouldPause: false,
    reason: 'No pause conditions met',
    waitMs: 0,
  };
}

// ============================================================================
// State Query Functions
// ============================================================================

/**
 * Get full pause state for a user (for debugging/display).
 */
export function getPauseState(username: string): UserPauseState & { pauseCheck: PauseCheckResult } {
  const state = getOrCreateState(username);
  return {
    ...state,
    pauseCheck: shouldPauseForUser(username),
  };
}

/**
 * Clear all pause state for a user (for testing/reset).
 */
export function clearAllPauseState(username: string): void {
  userPauseStates.delete(username);
  console.log(`${LOG_PREFIX} All pause state cleared for ${username}`);
}

/**
 * Get all users with active pause conditions.
 */
export function getUsersWithActivePauses(): Array<{ username: string; pauseCheck: PauseCheckResult }> {
  const results: Array<{ username: string; pauseCheck: PauseCheckResult }> = [];

  for (const [username, _state] of userPauseStates) {
    const pauseCheck = shouldPauseForUser(username);
    if (pauseCheck.shouldPause) {
      results.push({ username, pauseCheck });
    }
  }

  return results;
}
