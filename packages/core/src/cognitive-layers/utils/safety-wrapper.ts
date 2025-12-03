/**
 * Safety Validation Wrapper
 *
 * Convenience wrapper for non-blocking safety checks with audit logging.
 * Used in Phase 4.2 to detect safety issues without blocking responses.
 *
 * @module cognitive-layers/utils/safety-wrapper
 */

import { checkSafety, type SafetyOptions, type SafetyResult } from '../validators/safety.js';
import { audit } from '../../audit.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Result from safety check with response passthrough
 *
 * Always includes the original response (non-blocking behavior)
 */
export interface SafetyCheckResult extends SafetyResult {
  /** Time taken to perform check (milliseconds) */
  checkTime: number;

  /** Original response (always returned, non-blocking) */
  response: string;

  /** Categories checked (optional, for backwards compatibility) */
  categories?: string[];
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
 * Check response safety with audit logging (non-blocking)
 *
 * This is the primary function for Phase 4.2 integration.
 * It runs safety checks and logs issues but NEVER blocks responses.
 *
 * **Non-blocking guarantee:**
 * - Response is always returned unchanged
 * - Errors in safety checks don't affect response delivery
 * - Used for monitoring and data collection only
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
 * // Response is always returned (non-blocking)
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
          blocking: false, // Non-blocking in Phase 4.2
          cognitiveMode,
          userId
        }
      });
    }

    return {
      ...result,
      checkTime,
      response // Always return original response
    };
  } catch (error) {
    // Safety check failed - log error but don't block response
    console.error('[SAFETY] Check failed:', error);

    await audit({
      category: 'action',
      level: 'error',
      event: 'safety_check_failed',
      details: {
        error: error instanceof Error ? error.message : String(error),
        checkTime: Date.now() - startTime,
        blocking: false
      }
    });

    // Return "safe" result on error (permissive fallback)
    return {
      safe: true,
      score: 0.5,
      issues: [],
      categories: [],
      checkTime: Date.now() - startTime,
      processingTime: Date.now() - startTime,
      response // Always return response
    };
  }
}

/**
 * Quick safety check with minimal logging
 *
 * Useful for high-volume scenarios where full audit logging isn't needed.
 * Still non-blocking.
 *
 * @param response - Response to check
 * @param threshold - Safety threshold (0-1, default: 0.7)
 * @returns True if safe, false if issues detected
 */
export async function quickSafetyValidation(
  response: string,
  threshold: number = 0.7
): Promise<boolean> {
  try {
    const result = await checkSafety(response, { threshold });
    return result.safe;
  } catch (error) {
    console.error('[SAFETY] Quick check failed:', error);
    return true; // Permissive fallback
  }
}

/**
 * Batch safety check for multiple responses
 *
 * Checks multiple responses in parallel with shared options.
 * Returns array of results in same order as input.
 *
 * @param responses - Array of responses to check
 * @param options - Shared safety options
 * @returns Array of safety check results
 */
export async function batchCheckSafety(
  responses: string[],
  options: SafetyWrapperOptions = {}
): Promise<SafetyCheckResult[]> {
  const promises = responses.map(response =>
    checkResponseSafety(response, { ...options, auditIssues: false }) // Disable per-response audit
  );

  const results = await Promise.all(promises);

  // Audit batch summary
  if (options.auditIssues !== false) {
    const unsafeCount = results.filter(r => !r.safe).length;
    const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);

    await audit({
      category: 'action',
      level: unsafeCount > 0 ? 'warn' : 'info',
      event: 'batch_safety_check_completed',
      details: {
        totalResponses: responses.length,
        unsafeResponses: unsafeCount,
        totalIssues,
        avgCheckTime: results.reduce((sum, r) => sum + r.checkTime, 0) / results.length,
        blocking: false
      }
    });
  }

  return results;
}

/**
 * Get safety statistics for monitoring
 *
 * Aggregates safety check results for dashboard/metrics.
 *
 * @param results - Array of safety check results
 * @returns Aggregated statistics
 */
export function getSafetyStats(results: SafetyCheckResult[]): {
  totalChecks: number;
  safeCount: number;
  unsafeCount: number;
  safetyRate: number;
  avgScore: number;
  totalIssues: number;
  issuesByType: Record<string, number>;
  issuesBySeverity: Record<string, number>;
  avgCheckTime: number;
} {
  const totalChecks = results.length;
  const safeCount = results.filter(r => r.safe).length;
  const unsafeCount = totalChecks - safeCount;
  const safetyRate = totalChecks > 0 ? safeCount / totalChecks : 1.0;
  const avgScore = totalChecks > 0
    ? results.reduce((sum, r) => sum + r.score, 0) / totalChecks
    : 1.0;
  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);

  const issuesByType: Record<string, number> = {};
  const issuesBySeverity: Record<string, number> = {};

  for (const result of results) {
    for (const issue of result.issues) {
      issuesByType[issue.type] = (issuesByType[issue.type] || 0) + 1;
      issuesBySeverity[issue.severity] = (issuesBySeverity[issue.severity] || 0) + 1;
    }
  }

  const avgCheckTime = totalChecks > 0
    ? results.reduce((sum, r) => sum + r.checkTime, 0) / totalChecks
    : 0;

  return {
    totalChecks,
    safeCount,
    unsafeCount,
    safetyRate,
    avgScore,
    totalIssues,
    issuesByType,
    issuesBySeverity,
    avgCheckTime
  };
}

/**
 * Format safety statistics for display
 *
 * @param stats - Safety statistics
 * @returns Human-readable summary
 */
export function formatSafetyStats(stats: ReturnType<typeof getSafetyStats>): string {
  const lines: string[] = [];

  lines.push('Safety Statistics:');
  lines.push(`  Total checks: ${stats.totalChecks}`);
  lines.push(`  Safe: ${stats.safeCount} (${(stats.safetyRate * 100).toFixed(1)}%)`);
  lines.push(`  Unsafe: ${stats.unsafeCount}`);
  lines.push(`  Avg score: ${(stats.avgScore * 100).toFixed(1)}%`);
  lines.push(`  Total issues: ${stats.totalIssues}`);
  lines.push(`  Avg check time: ${stats.avgCheckTime.toFixed(1)}ms`);

  if (stats.totalIssues > 0) {
    lines.push('');
    lines.push('Issues by type:');
    for (const [type, count] of Object.entries(stats.issuesByType)) {
      lines.push(`  - ${type}: ${count}`);
    }

    lines.push('');
    lines.push('Issues by severity:');
    for (const [severity, count] of Object.entries(stats.issuesBySeverity)) {
      lines.push(`  - ${severity}: ${count}`);
    }
  }

  return lines.join('\n');
}
