/**
 * Safety Validation Wrapper
 *
 * Safety checks with graph context and audit logging.
 * Owned by the live graph safety nodes.
 *
 * @module nodes/safety/response-safety
 */

import { checkSafety, type SafetyOptions, type SafetyResult } from './safety.js';
import { audit } from '../../audit.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Result from a safety check with the original response.
 */
export interface SafetyCheckResult extends SafetyResult {
  /** Time taken to perform check (milliseconds) */
  checkTime: number;

  /** Original response */
  response: string;
}

/**
 * Options for safety wrapper
 */
export interface SafetyWrapperOptions extends SafetyOptions {
  /** Whether to log issues to console (default: true) */
  logToConsole?: boolean;

  /** Whether to audit issues (default: true) */
  auditIssues?: boolean;

  /** Cognitive mode context for audit logs */
  cognitiveMode?: string;

  /** User ID for audit logs */
  userId?: string;
}

// ============================================================================
// Safety Wrapper
// ============================================================================

/**
 * Check response safety with audit logging.
 *
 * @param response - Response text to check
 * @param options - Safety check and logging options
 * @returns Safety check result with original response
 *
 * @example
 * ```typescript
 * const result = await checkResponseSafety(response, {
 *   threshold: 0.7,
 *   cognitiveMode: 'dual'
 * });
 *
 * if (!result.safe) {
 *   console.warn('Safety issues detected:', result.issues.length);
 * }
 *
 * return result.response;
 * ```
 */
export async function checkResponseSafety(
  response: string,
  options: SafetyWrapperOptions = {}
): Promise<SafetyCheckResult> {
  const startTime = Date.now();

  const {
    logToConsole = true,
    auditIssues = true,
    cognitiveMode,
    userId,
    ...safetyOptions
  } = options;

  try {
    // Run safety check
    const result = await checkSafety(response, safetyOptions);
    const checkTime = Date.now() - startTime;

    // Log to console if enabled and issues found
    if (logToConsole && !result.safe) {
      console.warn('[SAFETY] Issues detected:', result.issues.length);
      for (const issue of result.issues) {
        console.warn(`  - ${issue.type}: ${issue.description} (${issue.severity})`);
      }
    }

    // Audit result if enabled
    if (auditIssues) {
      await audit({
        category: 'action',
        level: result.safe ? 'info' : 'warn',
        event: 'safety_check_completed',
        details: {
          safe: result.safe,
          score: result.score,
          issuesFound: result.issues.length,
          issueTypes: result.issues.map(i => i.type),
          severities: result.issues.map(i => i.severity),
          checkTime,
          cognitiveMode,
          userId
        }
      });
    }

    return {
      ...result,
      checkTime,
      response
    };
  } catch (error) {
    console.error('[SAFETY] Check failed:', error);

    await audit({
      category: 'action',
      level: 'error',
      event: 'safety_check_failed',
      details: {
        error: error instanceof Error ? error.message : String(error),
        checkTime: Date.now() - startTime
      }
    });

    throw error;
  }
}
