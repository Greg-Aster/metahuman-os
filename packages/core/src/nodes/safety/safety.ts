/**
 * Safety Validator
 *
 * Checks generated responses for harmful content, sensitive data leaks,
 * and security policy violations.
 *
 * @module nodes/safety/safety
 */

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
  apiKey: /\b(?:(?:sk|pk)[-_][A-Za-z0-9_-]{16,}|(?:api[_-]?key|token|secret)\s*[:=]\s*['"]?[A-Za-z0-9._-]{16,}['"]?)/gi,
  bearerToken: /\bBearer\s+[\w\-\.]+/gi,

  // Passwords
  password: /\b(?:password|passwd|pwd)\s*[:=]\s*['"]?([^\s'",;]{6,})['"]?/gi,

  // Email addresses (in some contexts)
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,

  // Phone numbers
  phone: /\b(?:\+?1[-.]?)?\(?([0-9]{3})\)?[-.]?([0-9]{3})[-.]?([0-9]{4})\b/g,

  // Credit card numbers
  creditCard: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,

  // SSH keys
  sshKey: /\bssh-(?:rsa|dss|ed25519)\s+[A-Za-z0-9+\/=]+/gi,

  // Private keys
  privateKey: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/gi,
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

const DANGEROUS_COMMAND_PATTERNS = [
  /\bcurl\s+.*\s*\|\s*(?:bash|sh)/gi,
  /\bwget\s+.*\s*\|\s*(?:bash|sh)/gi,
  /\beval\s*\(/gi,
  /\bexec\s*\(/gi
];

// ============================================================================
// Safety Checker
// ============================================================================

/**
 * Check if response is safe
 *
 * Performs multiple safety checks:
 * 1. Sensitive data detection
 * 2. Harmful content detection
 * 3. Privacy leak detection
 * 4. Dangerous command detection
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
    checks = ['harmful_content', 'sensitive_data', 'privacy_leak', 'external_command']
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

  // Check 3: Privacy leaks
  if (checks.includes('privacy_leak')) {
    const privacyIssues = detectPrivacyLeaks(response);
    issues.push(...privacyIssues);
  }

  // Check 4: External commands (dangerous shell commands)
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

  return result;
}

function matches(pattern: RegExp, text: string): boolean {
  pattern.lastIndex = 0;
  const matched = pattern.test(text);
  pattern.lastIndex = 0;
  return matched;
}

/**
 * Detect sensitive data in response
 */
function detectSensitiveData(response: string): SafetyIssue[] {
  const issues: SafetyIssue[] = [];

  // Check API keys/tokens
  if (matches(SENSITIVE_DATA_PATTERNS.apiKey, response) || matches(SENSITIVE_DATA_PATTERNS.bearerToken, response)) {
    issues.push({
      type: 'sensitive_data',
      description: 'Response contains API key or token',
      severity: 'critical',
      location: 'API key pattern detected'
    });
  }

  // Check passwords
  if (matches(SENSITIVE_DATA_PATTERNS.password, response)) {
    issues.push({
      type: 'sensitive_data',
      description: 'Response contains password',
      severity: 'critical',
      location: 'Password pattern detected'
    });
  }

  // Check SSH/private keys
  if (matches(SENSITIVE_DATA_PATTERNS.sshKey, response) || matches(SENSITIVE_DATA_PATTERNS.privateKey, response)) {
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
  if (matches(HARMFUL_CONTENT_PATTERNS.harmInstructions, response)) {
    issues.push({
      type: 'harmful_content',
      description: 'Response contains instructions that could cause harm',
      severity: 'high'
    });
  }

  // Check for malicious commands
  if (matches(HARMFUL_CONTENT_PATTERNS.maliciousCommands, response)) {
    issues.push({
      type: 'harmful_content',
      description: 'Response contains potentially destructive system commands',
      severity: 'high'
    });
  }

  // Check for SQL injection
  if (matches(HARMFUL_CONTENT_PATTERNS.sqlInjection, response)) {
    issues.push({
      type: 'harmful_content',
      description: 'Response contains SQL injection patterns',
      severity: 'medium'
    });
  }

  // Check for XSS
  if (matches(HARMFUL_CONTENT_PATTERNS.xss, response)) {
    issues.push({
      type: 'harmful_content',
      description: 'Response contains potential XSS payload',
      severity: 'high'
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
  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    if (matches(pattern, response)) {
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
 *
 * Only detected sensitive data and harmful content patterns are sanitized.
 */
function sanitizeResponse(response: string, _issues: SafetyIssue[]): string {
  let sanitized = response;

  // Remove sensitive data patterns (API keys, passwords, etc.)
  for (const [name, pattern] of Object.entries(SENSITIVE_DATA_PATTERNS)) {
    sanitized = sanitized.replace(pattern, `[${name.toUpperCase()}_REDACTED]`);
  }

  // Remove harmful content patterns (SQL injection, XSS, etc.)
  for (const [name, pattern] of Object.entries(HARMFUL_CONTENT_PATTERNS)) {
    sanitized = sanitized.replace(pattern, `[${name.toUpperCase()}_REMOVED]`);
  }

  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[DANGEROUS_COMMAND_REMOVED]');
  }

  return sanitized;
}
