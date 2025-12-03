/**
 * Response Refinement Wrapper (Phase 4.3)
 *
 * Fast, pattern-based sanitization wrapper for non-blocking refinement.
 * Automatically sanitizes detected safety issues without LLM calls.
 *
 * @module cognitive-layers/utils/refinement-wrapper
 */

import type { SafetyCheckResult } from './safety-wrapper.js';
import type { SafetyIssue } from '../validators/safety.js';
import { audit } from '../../audit.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Change made during refinement
 */
export interface RefinementChange {
  /** Type of issue fixed */
  type: string;

  /** Description of the change */
  description: string;

  /** Context before change (snippet) */
  before: string;

  /** Context after change (snippet) */
  after: string;

  /** Position in text where change occurred */
  position?: number;
}

/**
 * Result from refinement with comparison
 */
export interface RefinementCheckResult {
  /** Original response (unchanged) */
  original: string;

  /** Refined response (sanitized) */
  refined: string;

  /** Whether any changes were made */
  changed: boolean;

  /** List of changes applied */
  changes: RefinementChange[];

  /** Number of safety issues fixed */
  safetyIssuesFixed: number;

  /** Time taken to refine (milliseconds) */
  refinementTime: number;
}

/**
 * Options for refinement wrapper
 */
export interface RefinementWrapperOptions {
  /** Whether to log changes to console (default: true) */
  logToConsole?: boolean;

  /** Whether to audit changes (default: true) */
  auditChanges?: boolean;

  /** Cognitive mode context for audit logs */
  cognitiveMode?: string;

  /** User ID for audit logs */
  userId?: string;

  /** Replacement text for sensitive data (default: '[REDACTED]') */
  redactionText?: string;

  /** Replacement text for file paths (default: '[PATH REMOVED]') */
  pathRedactionText?: string;

  /** Replacement text for IP addresses (default: '[IP REDACTED]') */
  ipRedactionText?: string;
}

// ============================================================================
// Pattern-Based Sanitization
// ============================================================================

/**
 * Sanitize sensitive data patterns
 *
 * Replaces API keys, passwords, SSH keys, etc. with redaction text
 */
function sanitizeSensitiveData(text: string, issue: SafetyIssue, redactionText: string): {
  sanitized: string;
  changes: RefinementChange[];
} {
  const changes: RefinementChange[] = [];
  let sanitized = text;

  // API keys (sk-, pk-, Bearer, etc.)
  const apiKeyPattern = /\b(sk|pk|key|token|bearer)[-_]?[a-zA-Z0-9]{20,}/gi;
  const apiKeyMatches = Array.from(text.matchAll(apiKeyPattern));
  for (const match of apiKeyMatches) {
    const before = match[0];
    const after = '[API_KEY_REDACTED]';
    sanitized = sanitized.replace(match[0], after);
    changes.push({
      type: 'sensitive_data',
      description: 'API key redacted',
      before: extractContext(text, match.index!, before.length, 20),
      after: extractContext(sanitized, match.index!, after.length, 20),
      position: match.index
    });
  }

  // Passwords (password: xxx, pwd=xxx, etc.)
  const passwordPattern = /(password|pwd|pass)[:\s=]+([^\s,;]+)/gi;
  const passwordMatches = Array.from(sanitized.matchAll(passwordPattern));
  for (const match of passwordMatches) {
    const before = match[0];
    const after = `${match[1]}: [PASSWORD_REDACTED]`;
    sanitized = sanitized.replace(match[0], after);
    changes.push({
      type: 'sensitive_data',
      description: 'Password redacted',
      before: extractContext(text, match.index!, before.length, 20),
      after: extractContext(sanitized, match.index!, after.length, 20),
      position: match.index
    });
  }

  // SSH private keys
  const sshKeyPattern = /-----BEGIN [A-Z]+ PRIVATE KEY-----[\s\S]+?-----END [A-Z]+ PRIVATE KEY-----/g;
  const sshMatches = Array.from(sanitized.matchAll(sshKeyPattern));
  for (const match of sshMatches) {
    const after = '[SSH_PRIVATE_KEY_REDACTED]';
    sanitized = sanitized.replace(match[0], after);
    changes.push({
      type: 'sensitive_data',
      description: 'SSH private key redacted',
      before: '-----BEGIN PRIVATE KEY----- ...',
      after,
      position: match.index
    });
  }

  return { sanitized, changes };
}

/**
 * Sanitize security violations (file paths, IPs)
 */
function sanitizeSecurityViolations(
  text: string,
  issue: SafetyIssue,
  pathRedactionText: string,
  ipRedactionText: string
): {
  sanitized: string;
  changes: RefinementChange[];
} {
  const changes: RefinementChange[] = [];
  let sanitized = text;

  // Absolute file paths (Unix: /path/to/file, Windows: C:\path\to\file)
  const unixPathPattern = /\/(?:home|root|etc|var|usr|opt|mnt|tmp)\/[^\s,;)]+/gi;
  const windowsPathPattern = /[A-Z]:\\[^\s,;)]+/gi;

  const unixMatches = Array.from(sanitized.matchAll(unixPathPattern));
  for (const match of unixMatches) {
    const before = match[0];
    const after = pathRedactionText;
    sanitized = sanitized.replace(match[0], after);
    changes.push({
      type: 'security_violation',
      description: 'File path redacted',
      before: extractContext(text, match.index!, before.length, 20),
      after: extractContext(sanitized, match.index!, after.length, 20),
      position: match.index
    });
  }

  const windowsMatches = Array.from(sanitized.matchAll(windowsPathPattern));
  for (const match of windowsMatches) {
    const before = match[0];
    const after = pathRedactionText;
    sanitized = sanitized.replace(match[0], after);
    changes.push({
      type: 'security_violation',
      description: 'File path redacted',
      before: extractContext(text, match.index!, before.length, 20),
      after: extractContext(sanitized, match.index!, after.length, 20),
      position: match.index
    });
  }

  // Internal IP addresses
  const ipPattern = /\b(?:10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|192\.168\.)\d{1,3}\.\d{1,3}\b/g;
  const ipMatches = Array.from(sanitized.matchAll(ipPattern));
  for (const match of ipMatches) {
    const before = match[0];
    const after = ipRedactionText;
    sanitized = sanitized.replace(match[0], after);
    changes.push({
      type: 'security_violation',
      description: 'Internal IP address redacted',
      before: extractContext(text, match.index!, before.length, 20),
      after: extractContext(sanitized, match.index!, after.length, 20),
      position: match.index
    });
  }

  return { sanitized, changes };
}

/**
 * Extract context around a match for logging
 */
function extractContext(text: string, position: number, length: number, contextChars: number = 20): string {
  const start = Math.max(0, position - contextChars);
  const end = Math.min(text.length, position + length + contextChars);
  const context = text.substring(start, end);

  // Add ellipsis if truncated
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';

  return prefix + context + suffix;
}

// ============================================================================
// Refinement Wrapper
// ============================================================================

/**
 * Refine response by sanitizing detected safety issues (non-blocking)
 *
 * This is the primary function for Phase 4.3 integration.
 * It performs fast, pattern-based sanitization without LLM calls.
 *
 * **Non-blocking in Phase 4.3:**
 * - Both original and refined responses are logged
 * - ORIGINAL response is still sent to users
 * - Used for testing sanitization accuracy
 *
 * @param response - Original response text
 * @param safetyResult - Safety check result from Phase 4.2
 * @param options - Refinement options
 * @returns Refinement result with original and refined versions
 *
 * @example
 * ```typescript
 * const safetyResult = await checkResponseSafety(response);
 * if (!safetyResult.safe) {
 *   const refinement = await refineResponseSafely(response, safetyResult);
 *   if (refinement.changed) {
 *     console.log('Refined response:', refinement.refined);
 *     // Phase 4.3: Still send original
 *     // Phase 4.4+: Send refined
 *   }
 * }
 * ```
 */
export async function refineResponseSafely(
  response: string,
  safetyResult: SafetyCheckResult,
  options: RefinementWrapperOptions = {}
): Promise<RefinementCheckResult> {
  const startTime = Date.now();

  const {
    logToConsole = true,
    auditChanges = true,
    cognitiveMode,
    userId,
    redactionText = '[REDACTED]',
    pathRedactionText = '[PATH REMOVED]',
    ipRedactionText = '[IP REDACTED]'
  } = options;

  // If no issues, return unchanged
  if (safetyResult.safe || safetyResult.issues.length === 0) {
    return {
      original: response,
      refined: response,
      changed: false,
      changes: [],
      safetyIssuesFixed: 0,
      refinementTime: Date.now() - startTime
    };
  }

  try {
    let refined = response;
    const allChanges: RefinementChange[] = [];

    // Apply sanitization for each detected issue
    for (const issue of safetyResult.issues) {
      if (issue.type === 'sensitive_data') {
        const result = sanitizeSensitiveData(refined, issue, redactionText);
        refined = result.sanitized;
        allChanges.push(...result.changes);
      } else if (issue.type === 'security_violation') {
        const result = sanitizeSecurityViolations(refined, issue, pathRedactionText, ipRedactionText);
        refined = result.sanitized;
        allChanges.push(...result.changes);
      }
      // Note: harmful_content and privacy_leak types are detected but not auto-sanitized
      // These require LLM-based refinement (future enhancement)
    }

    const changed = refined !== response;
    const refinementTime = Date.now() - startTime;

    // Log to console if enabled and changes were made
    if (logToConsole && changed) {
      console.log('[REFINEMENT] Response refined:');
      console.log(`  - Changes: ${allChanges.length}`);
      console.log(`  - Original length: ${response.length} chars`);
      console.log(`  - Refined length: ${refined.length} chars`);
      console.log(`  - Time: ${refinementTime}ms`);

      for (const change of allChanges) {
        console.log(`  - ${change.type}: ${change.description}`);
      }
    }

    // Audit refinement if enabled
    if (auditChanges) {
      await audit({
        category: 'action',
        level: changed ? 'info' : 'debug',
        event: 'response_refined',
        details: {
          changed,
          changesCount: allChanges.length,
          issuesFixed: allChanges.length,
          changeTypes: [...new Set(allChanges.map(c => c.type))],
          originalLength: response.length,
          refinedLength: refined.length,
          blocking: false, // Phase 4.3 is non-blocking
          refinementTime,
          cognitiveMode,
          userId
        }
      });
    }

    return {
      original: response,
      refined,
      changed,
      changes: allChanges,
      safetyIssuesFixed: allChanges.length,
      refinementTime
    };
  } catch (error) {
    // Refinement failed - log error but return original
    console.error('[REFINEMENT] Failed (non-blocking):', error);

    await audit({
      category: 'action',
      level: 'error',
      event: 'refinement_failed',
      details: {
        error: error instanceof Error ? error.message : String(error),
        issuesAttempted: safetyResult.issues.length,
        refinementTime: Date.now() - startTime
      }
    });

    // Return original on error (permissive fallback)
    return {
      original: response,
      refined: response,
      changed: false,
      changes: [],
      safetyIssuesFixed: 0,
      refinementTime: Date.now() - startTime
    };
  }
}

/**
 * Compare refinement effectiveness
 *
 * Analyzes how well refinement fixed detected issues.
 *
 * @param original - Original response
 * @param refined - Refined response
 * @param changes - Changes made
 * @returns Comparison metrics
 */
export function compareRefinementEffectiveness(
  original: string,
  refined: string,
  changes: RefinementChange[]
): {
  lengthChange: number;
  lengthChangePercent: number;
  changesApplied: number;
  changesByType: Record<string, number>;
  effectiveness: 'high' | 'medium' | 'low';
} {
  const lengthChange = refined.length - original.length;
  const lengthChangePercent = original.length > 0
    ? (lengthChange / original.length) * 100
    : 0;

  const changesByType: Record<string, number> = {};
  for (const change of changes) {
    changesByType[change.type] = (changesByType[change.type] || 0) + 1;
  }

  // Estimate effectiveness based on changes made
  let effectiveness: 'high' | 'medium' | 'low' = 'low';
  if (changes.length >= 3) {
    effectiveness = 'high';
  } else if (changes.length >= 1) {
    effectiveness = 'medium';
  }

  return {
    lengthChange,
    lengthChangePercent,
    changesApplied: changes.length,
    changesByType,
    effectiveness
  };
}

/**
 * Get refinement summary for logging
 */
export function getRefinementSummary(result: RefinementCheckResult): string {
  const lines: string[] = [];

  lines.push(`Refinement Summary:`);
  lines.push(`  Changed: ${result.changed ? 'YES' : 'NO'}`);

  if (result.changed) {
    lines.push(`  Changes: ${result.changes.length}`);
    lines.push(`  Issues fixed: ${result.safetyIssuesFixed}`);
    lines.push(`  Original length: ${result.original.length} chars`);
    lines.push(`  Refined length: ${result.refined.length} chars`);
    lines.push(`  Time: ${result.refinementTime}ms`);

    if (result.changes.length > 0) {
      lines.push('');
      lines.push('  Changes made:');
      for (const change of result.changes) {
        lines.push(`    - ${change.type}: ${change.description}`);
      }
    }
  } else {
    lines.push(`  No changes needed`);
  }

  return lines.join('\n');
}
