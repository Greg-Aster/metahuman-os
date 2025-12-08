/**
 * System Coder - Error Capture Service
 *
 * Captures, stores, and manages errors from various sources
 * (terminal, web console, build processes, tests).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { audit } from '../audit.js';
import { getProfilePaths } from '../path-builder.js';
import type {
  CapturedError,
  ErrorCaptureRequest,
  ErrorSource,
  ErrorSeverity,
  ErrorStatus,
  SystemCoderConfig,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_ERROR_PATTERNS = [
  'Error:',
  'ERR!',
  'TypeError',
  'ReferenceError',
  'SyntaxError',
  'ENOENT',
  'EACCES',
  'EPERM',
  'Cannot find module',
  'Module not found',
  'Compilation failed',
  'Build failed',
  'Test failed',
  'FATAL',
  'Uncaught',
  'Unhandled',
];

const MAX_ERRORS_PER_HOUR = 100;
const ERROR_DEDUP_WINDOW_MS = 60000; // 1 minute

// ============================================================================
// State
// ============================================================================

const recentErrors: Map<string, number> = new Map(); // hash -> timestamp
let hourlyErrorCount = 0;
let hourlyResetTime = Date.now();

// ============================================================================
// Path Helpers
// ============================================================================

function getSystemCoderDir(username: string): string {
  const profilePaths = getProfilePaths(username);
  return path.join(profilePaths.state, 'system-coder');
}

function getErrorsDir(username: string): string {
  return path.join(getSystemCoderDir(username), 'errors');
}

function getFixesDir(username: string): string {
  return path.join(getSystemCoderDir(username), 'fixes');
}

function getMaintenanceDir(username: string): string {
  return path.join(getSystemCoderDir(username), 'maintenance');
}

/**
 * Ensure the system coder directory structure exists
 */
export function ensureSystemCoderDirs(username: string): void {
  const dirs = [
    getSystemCoderDir(username),
    getErrorsDir(username),
    getFixesDir(username),
    getMaintenanceDir(username),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// ============================================================================
// Error Detection
// ============================================================================

/**
 * Check if a message matches error patterns
 */
export function isErrorMessage(
  message: string,
  patterns: string[] = DEFAULT_ERROR_PATTERNS,
  excludePatterns: string[] = []
): boolean {
  const lowerMessage = message.toLowerCase();

  // Check exclusions first
  for (const pattern of excludePatterns) {
    if (lowerMessage.includes(pattern.toLowerCase())) {
      return false;
    }
  }

  // Check for error patterns
  for (const pattern of patterns) {
    if (lowerMessage.includes(pattern.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Determine error severity based on content
 */
export function detectSeverity(message: string, stack?: string): ErrorSeverity {
  const content = `${message} ${stack || ''}`.toLowerCase();

  // Critical indicators
  if (
    content.includes('fatal') ||
    content.includes('critical') ||
    content.includes('crash') ||
    content.includes('memory leak') ||
    content.includes('out of memory')
  ) {
    return 'critical';
  }

  // Warning indicators
  if (
    content.includes('warning') ||
    content.includes('deprecated') ||
    content.includes('warn')
  ) {
    return 'warning';
  }

  return 'error';
}

/**
 * Generate a hash for deduplication
 */
function generateErrorHash(request: ErrorCaptureRequest): string {
  const content = `${request.source}:${request.message}:${request.context?.file || ''}`;
  return createHash('md5').update(content).digest('hex').substring(0, 12);
}

/**
 * Check if we should capture this error (dedup and rate limiting)
 */
function shouldCapture(hash: string, maxPerHour: number = MAX_ERRORS_PER_HOUR): boolean {
  const now = Date.now();

  // Reset hourly counter if needed
  if (now - hourlyResetTime > 3600000) {
    hourlyErrorCount = 0;
    hourlyResetTime = now;
  }

  // Rate limit
  if (hourlyErrorCount >= maxPerHour) {
    return false;
  }

  // Dedup check
  const lastSeen = recentErrors.get(hash);
  if (lastSeen && now - lastSeen < ERROR_DEDUP_WINDOW_MS) {
    return false;
  }

  return true;
}

// ============================================================================
// Error Capture API
// ============================================================================

/**
 * Capture an error and store it for review
 */
export function captureError(
  username: string,
  request: ErrorCaptureRequest
): CapturedError | null {
  const hash = generateErrorHash(request);

  // Check if we should capture this error
  if (!shouldCapture(hash)) {
    return null;
  }

  // Update tracking
  recentErrors.set(hash, Date.now());
  hourlyErrorCount++;

  // Clean old entries from dedup map
  const cutoff = Date.now() - ERROR_DEDUP_WINDOW_MS * 2;
  for (const [key, timestamp] of recentErrors) {
    if (timestamp < cutoff) {
      recentErrors.delete(key);
    }
  }

  // Ensure directories exist
  ensureSystemCoderDirs(username);

  // Create error object
  const timestamp = new Date().toISOString();
  const error: CapturedError = {
    id: `${timestamp.replace(/[:.]/g, '-')}-${hash}`,
    timestamp,
    source: request.source,
    severity: request.severity || detectSeverity(request.message, request.stack),
    message: request.message,
    stack: request.stack,
    context: {
      file: request.context?.file,
      line: request.context?.line,
      column: request.context?.column,
      command: request.context?.command,
      output: request.context?.output,
      cwd: request.context?.cwd,
    },
    status: 'new',
    createdBy: username,
    tags: request.tags,
  };

  // Save to disk
  const errorPath = path.join(getErrorsDir(username), `${error.id}.json`);
  fs.writeFileSync(errorPath, JSON.stringify(error, null, 2));

  // Audit
  audit({
    level: 'info',
    category: 'system',
    event: 'system_coder_error_captured',
    details: {
      errorId: error.id,
      source: error.source,
      severity: error.severity,
      messagePreview: error.message.substring(0, 100),
    },
    actor: 'system-coder',
    userId: username,
  });

  return error;
}

/**
 * List captured errors with optional filtering
 */
export function listErrors(
  username: string,
  options: {
    status?: ErrorStatus | ErrorStatus[];
    source?: ErrorSource | ErrorSource[];
    severity?: ErrorSeverity | ErrorSeverity[];
    limit?: number;
    offset?: number;
  } = {}
): { errors: CapturedError[]; total: number } {
  const errorsDir = getErrorsDir(username);

  if (!fs.existsSync(errorsDir)) {
    return { errors: [], total: 0 };
  }

  // Load all errors
  const files = fs.readdirSync(errorsDir).filter((f) => f.endsWith('.json'));
  let errors: CapturedError[] = [];

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(errorsDir, file), 'utf-8');
      errors.push(JSON.parse(content));
    } catch {
      // Skip malformed files
    }
  }

  // Sort by timestamp (newest first)
  errors.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Apply filters
  if (options.status) {
    const statuses = Array.isArray(options.status) ? options.status : [options.status];
    errors = errors.filter((e) => statuses.includes(e.status));
  }

  if (options.source) {
    const sources = Array.isArray(options.source) ? options.source : [options.source];
    errors = errors.filter((e) => sources.includes(e.source));
  }

  if (options.severity) {
    const severities = Array.isArray(options.severity) ? options.severity : [options.severity];
    errors = errors.filter((e) => severities.includes(e.severity));
  }

  const total = errors.length;

  // Apply pagination
  const offset = options.offset || 0;
  const limit = options.limit || 50;
  errors = errors.slice(offset, offset + limit);

  return { errors, total };
}

/**
 * Get a specific error by ID
 */
export function getError(username: string, errorId: string): CapturedError | null {
  const errorPath = path.join(getErrorsDir(username), `${errorId}.json`);

  if (!fs.existsSync(errorPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(errorPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Update error status
 */
export function updateErrorStatus(
  username: string,
  errorId: string,
  status: ErrorStatus,
  fixId?: string
): boolean {
  const error = getError(username, errorId);
  if (!error) {
    return false;
  }

  error.status = status;
  error.updatedAt = new Date().toISOString();
  if (fixId) {
    error.fixId = fixId;
  }

  const errorPath = path.join(getErrorsDir(username), `${errorId}.json`);
  fs.writeFileSync(errorPath, JSON.stringify(error, null, 2));

  audit({
    level: 'info',
    category: 'action',
    event: 'system_coder_error_status_updated',
    details: { errorId, status, fixId },
    actor: 'system-coder',
    userId: username,
  });

  return true;
}

/**
 * Delete an error
 */
export function deleteError(username: string, errorId: string): boolean {
  const errorPath = path.join(getErrorsDir(username), `${errorId}.json`);

  if (!fs.existsSync(errorPath)) {
    return false;
  }

  fs.unlinkSync(errorPath);

  audit({
    level: 'info',
    category: 'action',
    event: 'system_coder_error_deleted',
    details: { errorId },
    actor: 'system-coder',
    userId: username,
  });

  return true;
}

/**
 * Get error statistics
 */
export function getErrorStats(username: string): {
  total: number;
  byStatus: Record<ErrorStatus, number>;
  bySource: Record<ErrorSource, number>;
  bySeverity: Record<ErrorSeverity, number>;
} {
  const { errors } = listErrors(username, { limit: 10000 });

  const stats = {
    total: errors.length,
    byStatus: {} as Record<ErrorStatus, number>,
    bySource: {} as Record<ErrorSource, number>,
    bySeverity: {} as Record<ErrorSeverity, number>,
  };

  for (const error of errors) {
    stats.byStatus[error.status] = (stats.byStatus[error.status] || 0) + 1;
    stats.bySource[error.source] = (stats.bySource[error.source] || 0) + 1;
    stats.bySeverity[error.severity] = (stats.bySeverity[error.severity] || 0) + 1;
  }

  return stats;
}

// ============================================================================
// Exports
// ============================================================================

export {
  getSystemCoderDir,
  getErrorsDir,
  getFixesDir,
  getMaintenanceDir,
  DEFAULT_ERROR_PATTERNS,
};
