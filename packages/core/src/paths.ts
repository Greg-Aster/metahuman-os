/**
 * Path Utilities
 *
 * Re-exports path building functions and provides utility functions
 * for timestamps and IDs.
 *
 * Path Resolution:
 * - systemPaths: For system-level paths (logs, agents, etc.)
 * - getProfilePaths(username): For user-specific paths
 * - storageClient: For category-based path resolution
 */

// Import users.ts FIRST to ensure profile storage config is registered
// before getProfilePaths is used (dependency injection pattern)
import './users.js';

// Re-export core path building functions
export { findRepoRoot, ROOT, getProfilePaths, systemPaths } from './path-builder.js';

const LOG_PREFIX = '[paths]';

/**
 * Get today's date in YYYY-MM-DD format
 */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Get current timestamp in ISO format
 */
export function timestamp(): string {
  return new Date().toISOString();
}

/**
 * Generate a unique ID with a prefix and timestamp
 * @param prefix - The prefix for the ID (e.g., 'event', 'task')
 * @returns A unique ID like 'event-20251201123456789'
 */
export function generateId(prefix: string): string {
  if (!prefix || typeof prefix !== 'string') {
    throw new Error('generateId: prefix must be a non-empty string');
  }
  
  // Sanitize prefix to prevent injection (alphanumeric, underscore, hyphen only)
  if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) {
    throw new Error('generateId: prefix must contain only alphanumeric characters, underscores, and hyphens');
  }
  
  const now = new Date();
  const dateStr = now.toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 15);
  return `${prefix}-${dateStr}`;
}
