/**
 * Reasoning Service - Telemetry
 *
 * Unified event emission for reasoning operations:
 * - SSE events (for UI)
 * - Audit logs (for debugging/compliance)
 * - Optional reasoning-specific logs (for analysis)
 *
 * Extracted from Operator V2.
 */

import { audit } from '../audit';
import type { ReasoningEvent } from './types';

/**
 * Emit reasoning event to all channels.
 *
 * Channels:
 * 1. Callback (SSE to UI)
 * 2. Audit log (system-wide)
 * 3. Optional: Reasoning-specific log file
 *
 * @param callback - Progress callback (for SSE)
 * @param event - Reasoning event to emit
 */
export function emitReasoningEvent(
  callback: ((event: ReasoningEvent) => void) | undefined,
  event: ReasoningEvent
): void {
  // 1. Send to callback (SSE)
  if (callback) {
    callback(event);
  }

  // 2. Log to audit trail
  audit({
    level: 'info',
    category: 'action',
    event: `reasoning_${event.type}`,
    details: {
      step: event.step,
      sessionId: event.sessionId,
      conversationId: event.conversationId,
      ...event.data,
    },
    actor: 'reasoning-service',
  });

  // 3. Optional: Write to reasoning-specific log
  // (Can be enabled via config.enableScratchpadDump)
  // Implementation: writeReasoningLog(event);
}

/**
 * Format reasoning event as SSE message.
 *
 * @param event - Reasoning event
 * @returns SSE-formatted string
 */
export function formatSSE(event: ReasoningEvent): string {
  return `event: reasoning\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Create a reasoning logger for a specific session.
 *
 * @param sessionId - Session ID
 * @returns Logger function
 */
export function createReasoningLogger(
  sessionId: string
): (event: ReasoningEvent) => void {
  return (event: ReasoningEvent) => {
    emitReasoningEvent(undefined, {
      ...event,
      sessionId, // Override with session ID
    });
  };
}

/**
 * Log reasoning loop started.
 */
export function logLoopStarted(
  sessionId: string,
  goal: string,
  config: { depth?: string; maxSteps?: number }
): void {
  audit({
    level: 'info',
    category: 'action',
    event: 'reasoning_loop_started',
    details: {
      sessionId,
      goal: goal.substring(0, 100),
      depth: config.depth,
      maxSteps: config.maxSteps,
    },
    actor: 'reasoning-service',
  });
}

/**
 * Log reasoning loop completed.
 */
export function logLoopCompleted(
  sessionId: string,
  metadata: {
    stepsExecuted: number;
    fastPathUsed: boolean;
    verbatimShortCircuit: boolean;
    totalDuration: number;
    llmCalls: number;
    errors: number;
  }
): void {
  audit({
    level: 'info',
    category: 'action',
    event: 'reasoning_loop_completed',
    details: {
      sessionId,
      ...metadata,
    },
    actor: 'reasoning-service',
  });
}

/**
 * Log reasoning loop failed.
 */
export function logLoopFailed(
  sessionId: string,
  error: string,
  metadata: {
    stepsExecuted: number;
    totalDuration: number;
  }
): void {
  audit({
    level: 'error',
    category: 'action',
    event: 'reasoning_loop_failed',
    details: {
      sessionId,
      error,
      ...metadata,
    },
    actor: 'reasoning-service',
  });
}

/**
 * Log verbatim short-circuit (fast-path optimization).
 */
export function logVerbatimShortCircuit(
  sessionId: string,
  goal: string,
  tool: string,
  savedIterations: number
): void {
  audit({
    level: 'info',
    category: 'action',
    event: 'reasoning_verbatim_shortcircuit',
    details: {
      sessionId,
      goal: goal.substring(0, 100),
      tool,
      savedIterations,
    },
    actor: 'reasoning-service',
  });
}

/**
 * Log failure loop detected.
 */
export function logFailureLoopDetected(
  sessionId: string,
  tool: string,
  failureCount: number,
  lastError: string
): void {
  audit({
    level: 'warn',
    category: 'action',
    event: 'reasoning_failure_loop_detected',
    details: {
      sessionId,
      tool,
      failureCount,
      lastError,
    },
    actor: 'reasoning-service',
  });
}
