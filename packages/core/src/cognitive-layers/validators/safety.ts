/**
 * Safety Validator
 *
 * Checks generated responses for harmful content, sensitive data leaks,
 * and security policy violations.
 *
 * @module cognitive-layers/validators/safety
 */

import { audit } from '../../audit.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Safety check result
 */
export interface SafetyResult {
  /** Overall safety status */
  safe: boolean;

  /** Safety score (0-1, where 1 is completely safe) */
  score: number;

  /** Issues found (if any) */
  issues: SafetyIssue[];

  /** Sanitized version of response (if unsafe) */
  sanitized?: string;

  /** Processing time in ms */
  processingTime: number;
}

/**
 * Types of safety issues
 */
export type SafetyIssueType =
  | 'harmful_content'
  | 'sensitive_data'
  | 'security_violation'
  | 'privacy_leak'
  | 'inappropriate_tone'
  | 'external_command';

/**
 * Specific safety issue
 */
export interface SafetyIssue {
  /** Type of safety issue */
  type: SafetyIssueType;

  /** Description of the issue */
  description: string;

  /** Severity: low, medium, high, critical */
  severity: 'low' | 'medium' | 'high' | 'critical';

  /** Location in response (optional) */
  location?: string;
}

/**
 * Safety check options
 */
export interface SafetyOptions {
  /** Whether to generate sanitized version if unsafe */
  sanitize?: boolean;

  /** Safety threshold (0-1, default: 0.9 - very strict) */
  threshold?: number;

  /** Which checks to perform (default: all) */
  checks?: SafetyIssueType[];
}

// ============================================================================
// Safety Patterns
// ============================================================================

/**
 * Patterns for detecting sensitive data
 */
const SENSITIVE_DATA_PATTERNS = {
  // API keys, tokens
  apiKey: /\b(?:api[_-]?key|token|secret)[:\s]*['"]([\w\-]{20,})['"]/gi,
  bearerToken: /\bBearer\s+[\w\-\.]+/gi,

  // Passwords
  password: /\b(?:password|passwd|pwd)[:\s]*['"]([\w!@#$%^&*]{6,})['"]/gi,

  // Email addresses (in some contexts)
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,

  // Phone numbers
  phone: /\b(?:\+?1[-.]?)?\(?([0-9]{3})\)?[-.]?([0-9]{3})[-.]?([0-9]{4})\b/g,

  // Credit card numbers
  creditCard: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,

  // SSH keys
  sshKey: /\bssh-(?:rsa|dss|ed25519)\s+[A-Za-z0-9+\/=]+/gi,

  // Private keys
  privateKey: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/gi,
};

/**
 * Patterns for detecting harmful content
 */
const HARMFUL_CONTENT_PATTERNS = {
  // Explicit instructions to harm
  harmInstructions: /\b(?:how to|steps to|guide to)\s+(?:harm|hurt|injure|kill|attack)/gi,

  // Malicious commands
  maliciousCommands: /\b(?:rm\s+-rf|sudo\s+rm|format\s+c:|del\s+\/[fqs])/gi,

  // SQL injection attempts
  sqlInjection: /\b(?:DROP\s+TABLE|DELETE\s+FROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET)\b/gi,

  // XSS attempts
  xss: /<script[^>]*>.*?<\/script>/gis,
};

/**
 * Patterns for detecting security violations
 */
const SECURITY_VIOLATION_PATTERNS = {
  // File path disclosure
  filePaths: /(?:\/home\/|\/root\/|C:\\Users\\|\/etc\/|\/var\/)/g,

  // Internal URLs
  internalUrls: /\b(?:localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/g,

  // Environment variables
  envVars: /\$\{?[A-Z_]+\}?|\bprocess\.env\./g,
};

// ============================================================================
// Safety Checker
// ============================================================================

/**
 * Check if response is safe
 *
 * Performs multiple safety checks:
 * 1. Sensitive data detection
 * 2. Harmful content detection
 * 3. Security violation detection
 * 4. Privacy leak detection
 *
 * @param response - Generated response to check
 * @param options - Safety check options
 * @returns Safety result with issues and optional sanitized version
 */
export async function checkSafety(
  response: string,
  options: SafetyOptions = {}
): Promise<SafetyResult> {
  const startTime = Date.now();

  const {
    sanitize = true,
    threshold = 0.9,
    checks = ['harmful_content', 'sensitive_data', 'security_violation', 'privacy_leak']
  } = options;

  const issues: SafetyIssue[] = [];

  // Check 1: Sensitive data
  if (checks.includes('sensitive_data')) {
    const sensitiveIssues = detectSensitiveData(response);
    issues.push(...sensitiveIssues);
  }

  // Check 2: Harmful content
  if (checks.includes('harmful_content')) {
    const harmfulIssues = detectHarmfulContent(response);
    issues.push(...harmfulIssues);
  }

  // Check 3: Security violations
  if (checks.includes('security_violation')) {
    const securityIssues = detectSecurityViolations(response);
    issues.push(...securityIssues);
  }

  // Check 4: Privacy leaks
  if (checks.includes('privacy_leak')) {
    const privacyIssues = detectPrivacyLeaks(response);
    issues.push(...privacyIssues);
  }

  // Check 5: External commands (dangerous shell commands)
  if (checks.includes('external_command')) {
    const commandIssues = detectExternalCommands(response);
    issues.push(...commandIssues);
  }

  // Calculate safety score based on severity of issues
  const score = calculateSafetyScore(issues);
  const safe = score >= threshold;

  // Sanitize if requested and unsafe
  let sanitized: string | undefined;
  if (sanitize && !safe) {
    sanitized = sanitizeResponse(response, issues);
  }

  const result: SafetyResult = {
    safe,
    score,
    issues,
    sanitized,
    processingTime: Date.now() - startTime
  };

  // Audit safety check
  await audit({
    category: 'security',
    level: safe ? 'info' : 'warn',
    action: 'safety_check',
    details: {
      safe,
      score,
      issuesFound: issues.length,
      criticalIssues: issues.filter(i => i.severity === 'critical').length,
      processingTime: result.processingTime
    }
  });

  return result;
}

/**
 * Detect sensitive data in response
 */
function detectSensitiveData(response: string): SafetyIssue[] {
  const issues: SafetyIssue[] = [];

  // Check API keys/tokens
  if (SENSITIVE_DATA_PATTERNS.apiKey.test(response)) {
    issues.push({
      type: 'sensitive_data',
      description: 'Response contains API key or token',
      severity: 'critical',
      location: 'API key pattern detected'
    });
  }

  // Check passwords
  if (SENSITIVE_DATA_PATTERNS.password.test(response)) {
    issues.push({
      type: 'sensitive_data',
      description: 'Response contains password',
      severity: 'critical',
      location: 'Password pattern detected'
    });
  }

  // Check SSH/private keys
  if (SENSITIVE_DATA_PATTERNS.sshKey.test(response) || SENSITIVE_DATA_PATTERNS.privateKey.test(response)) {
    issues.push({
      type: 'sensitive_data',
      description: 'Response contains private key',
      severity: 'critical',
      location: 'Private key detected'
    });
  }

  // Check credit cards (less severe, might be example)
  const ccMatches = response.match(SENSITIVE_DATA_PATTERNS.creditCard);
  if (ccMatches && ccMatches.length > 0) {
    // Only flag if looks like real credit card (basic Luhn check would go here)
    issues.push({
      type: 'sensitive_data',
      description: 'Response may contain credit card number',
      severity: 'high',
      location: 'Credit card pattern detected'
    });
  }

  return issues;
}

/**
 * Detect harmful content in response
 */
function detectHarmfulContent(response: string): SafetyIssue[] {
  const issues: SafetyIssue[] = [];

  // Check for harmful instructions
  if (HARMFUL_CONTENT_PATTERNS.harmInstructions.test(response)) {
    issues.push({
      type: 'harmful_content',
      description: 'Response contains instructions that could cause harm',
      severity: 'high'
    });
  }

  // Check for malicious commands
  if (HARMFUL_CONTENT_PATTERNS.maliciousCommands.test(response)) {
    issues.push({
      type: 'harmful_content',
      description: 'Response contains potentially destructive system commands',
      severity: 'high'
    });
  }

  // Check for SQL injection
  if (HARMFUL_CONTENT_PATTERNS.sqlInjection.test(response)) {
    issues.push({
      type: 'harmful_content',
      description: 'Response contains SQL injection patterns',
      severity: 'medium'
    });
  }

  // Check for XSS
  if (HARMFUL_CONTENT_PATTERNS.xss.test(response)) {
    issues.push({
      type: 'harmful_content',
      description: 'Response contains potential XSS payload',
      severity: 'high'
    });
  }

  return issues;
}

/**
 * Detect security violations in response
 */
function detectSecurityViolations(response: string): SafetyIssue[] {
  const issues: SafetyIssue[] = [];

  // Check for file path disclosure
  if (SECURITY_VIOLATION_PATTERNS.filePaths.test(response)) {
    issues.push({
      type: 'security_violation',
      description: 'Response contains internal file paths',
      severity: 'medium'
    });
  }

  // Check for internal URLs
  if (SECURITY_VIOLATION_PATTERNS.internalUrls.test(response)) {
    issues.push({
      type: 'security_violation',
      description: 'Response contains internal network addresses',
      severity: 'medium'
    });
  }

  // Check for environment variable references
  if (SECURITY_VIOLATION_PATTERNS.envVars.test(response)) {
    issues.push({
      type: 'security_violation',
      description: 'Response references environment variables',
      severity: 'low'
    });
  }

  return issues;
}

/**
 * Detect privacy leaks in response
 */
function detectPrivacyLeaks(response: string): SafetyIssue[] {
  const issues: SafetyIssue[] = [];

  // Check for email addresses (context-dependent)
  const emailMatches = response.match(SENSITIVE_DATA_PATTERNS.email);
  if (emailMatches && emailMatches.length > 2) {
    // Multiple emails might indicate a privacy leak
    issues.push({
      type: 'privacy_leak',
      description: 'Response contains multiple email addresses',
      severity: 'low'
    });
  }

  // Check for phone numbers
  const phoneMatches = response.match(SENSITIVE_DATA_PATTERNS.phone);
  if (phoneMatches && phoneMatches.length > 0) {
    issues.push({
      type: 'privacy_leak',
      description: 'Response contains phone number(s)',
      severity: 'low'
    });
  }

  return issues;
}

/**
 * Detect external commands that could be dangerous
 */
function detectExternalCommands(response: string): SafetyIssue[] {
  const issues: SafetyIssue[] = [];

  // Check for shell command execution patterns
  const dangerousCommands = [
    /\bcurl\s+.*\s*\|\s*(?:bash|sh)/gi,
    /\bwget\s+.*\s*\|\s*(?:bash|sh)/gi,
    /\beval\s*\(/gi,
    /\bexec\s*\(/gi
  ];

  for (const pattern of dangerousCommands) {
    if (pattern.test(response)) {
      issues.push({
        type: 'external_command',
        description: 'Response contains potentially dangerous command execution pattern',
        severity: 'high'
      });
      break; // Only report once
    }
  }

  return issues;
}

/**
 * Calculate overall safety score based on issues
 */
function calculateSafetyScore(issues: SafetyIssue[]): number {
  if (issues.length === 0) return 1.0;

  // Weight by severity
  const severityWeights = {
    low: 0.05,
    medium: 0.15,
    high: 0.35,
    critical: 1.0
  };

  let totalPenalty = 0;
  for (const issue of issues) {
    totalPenalty += severityWeights[issue.severity];
  }

  // Score is 1.0 minus total penalty (clamped to 0-1)
  return Math.max(0, 1.0 - totalPenalty);
}

/**
 * Sanitize response by removing sensitive/harmful content
 */
function sanitizeResponse(response: string, issues: SafetyIssue[]): string {
  let sanitized = response;

  // Remove sensitive data patterns
  for (const [name, pattern] of Object.entries(SENSITIVE_DATA_PATTERNS)) {
    sanitized = sanitized.replace(pattern, `[${name.toUpperCase()}_REDACTED]`);
  }

  // Remove harmful content patterns
  for (const [name, pattern] of Object.entries(HARMFUL_CONTENT_PATTERNS)) {
    sanitized = sanitized.replace(pattern, `[${name.toUpperCase()}_REMOVED]`);
  }

  // Remove security violation patterns
  sanitized = sanitized.replace(SECURITY_VIOLATION_PATTERNS.filePaths, '[PATH_REDACTED]');
  sanitized = sanitized.replace(SECURITY_VIOLATION_PATTERNS.internalUrls, '[URL_REDACTED]');
  sanitized = sanitized.replace(SECURITY_VIOLATION_PATTERNS.envVars, '[ENV_REDACTED]');

  return sanitized;
}

/**
 * Quick safety check (basic, fast)
 *
 * Only checks for critical issues (sensitive data, harmful content).
 *
 * @param response - Response to check
 * @returns True if safe, false otherwise
 */
export async function quickSafetyCheck(response: string): Promise<boolean> {
  const result = await checkSafety(response, {
    sanitize: false,
    threshold: 0.8, // Slightly lower threshold
    checks: ['harmful_content', 'sensitive_data'] // Only critical checks
  });

  return result.safe;
}

/**
 * Get safety summary for debugging
 */
export function getSafetySummary(result: SafetyResult): string {
  const parts: string[] = [];

  parts.push(`Safety: ${result.safe ? '✓ SAFE' : '✗ UNSAFE'}`);
  parts.push(`Score: ${(result.score * 100).toFixed(1)}%`);

  if (result.issues.length > 0) {
    parts.push(`\nIssues found: ${result.issues.length}`);

    const criticalIssues = result.issues.filter(i => i.severity === 'critical');
    const highIssues = result.issues.filter(i => i.severity === 'high');

    if (criticalIssues.length > 0) {
      parts.push(`  Critical: ${criticalIssues.length}`);
    }
    if (highIssues.length > 0) {
      parts.push(`  High: ${highIssues.length}`);
    }

    for (const issue of result.issues) {
      parts.push(`  - [${issue.severity.toUpperCase()}] ${issue.type}: ${issue.description}`);
    }
  }

  if (result.sanitized) {
    parts.push(`\nSanitized version available`);
  }

  parts.push(`\nProcessing time: ${result.processingTime}ms`);

  return parts.join('\n');
}
