/**
 * Response Buffer System
 *
 * Manages multi-turn conversations for card responses.
 * When a user selects a card in the chat interface and sends multiple messages,
 * this buffer maintains the rolling context for that specific card interaction.
 *
 * Key differences from conversation-buffer.ts:
 * - One buffer per card interaction (not per mode)
 * - Includes card metadata and desire snapshot
 * - Auto-cleanup of resolved/old buffers
 * - Separate storage location: state/response-buffers/
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getProfilePaths } from './paths.js';
import { systemPaths } from './path-builder.js';
import type { Desire } from './agency/types.js';

const LOG_PREFIX = '[response-buffer]';

// ============================================================================
// Types
// ============================================================================

export interface ResponseBufferExchange {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  action?: string;  // What action was taken (if any)
}

export interface ResponseBuffer {
  id: string;
  cardType: string;              // 'desire_rejection', 'clarifying_question', etc.
  cardId: string;                // desireId, questionId, etc.
  cardContent: string;           // Original card text
  createdAt: string;
  updatedAt: string;
  exchanges: ResponseBufferExchange[];
  resolved: boolean;             // True when conversation concludes
  desireSnapshot?: Desire;       // Snapshot of desire at buffer creation
  metadata?: Record<string, unknown>;  // Additional card-specific data
}

// ============================================================================
// Path Helpers
// ============================================================================

/**
 * Get the directory for response buffers for a user
 */
function getResponseBufferDir(username: string): string {
  const profilePaths = getProfilePaths(username);
  return path.join(profilePaths.state, 'response-buffers');
}

/**
 * Ensure response buffer directory exists
 */
function ensureResponseBufferDir(username: string): string {
  const dir = getResponseBufferDir(username);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // Ignore mkdir race conditions
  }
  return dir;
}

/**
 * Get the path to a specific response buffer file
 */
function getResponseBufferPath(username: string, bufferId: string): string {
  const dir = ensureResponseBufferDir(username);
  return path.join(dir, `${bufferId}.json`);
}

// ============================================================================
// Notification System
// ============================================================================

/**
 * Touch a notification file to signal response buffer updates.
 * Allows SSE-based real-time updates in the UI.
 */
export function touchResponseBufferNotification(username: string, bufferId: string): void {
  try {
    const notifyDir = path.join(systemPaths.run, 'buffer-notifications');
    fs.mkdirSync(notifyDir, { recursive: true });
    const notifyFile = path.join(notifyDir, `${username}-response-${bufferId}.notify`);
    const now = new Date().toISOString();
    fs.writeFileSync(notifyFile, now);
  } catch {
    // Non-critical - buffer still works, just won't get instant SSE updates
  }
}

/**
 * Get the path to the notification file for a response buffer
 */
export function getResponseBufferNotificationPath(username: string, bufferId: string): string {
  return path.join(systemPaths.run, 'buffer-notifications', `${username}-response-${bufferId}.notify`);
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Create a new response buffer for a card interaction
 */
export function createResponseBuffer(
  username: string,
  cardType: string,
  cardId: string,
  cardContent: string,
  desireSnapshot?: Desire,
  metadata?: Record<string, unknown>
): ResponseBuffer {
  const now = new Date().toISOString();
  const buffer: ResponseBuffer = {
    id: randomUUID(),
    cardType,
    cardId,
    cardContent,
    createdAt: now,
    updatedAt: now,
    exchanges: [],
    resolved: false,
    desireSnapshot,
    metadata,
  };

  const bufferPath = getResponseBufferPath(username, buffer.id);
  fs.writeFileSync(bufferPath, JSON.stringify(buffer, null, 2));

  console.log(`${LOG_PREFIX} Created buffer ${buffer.id} for ${cardType}:${cardId}`);
  touchResponseBufferNotification(username, buffer.id);

  return buffer;
}

/**
 * Load an existing response buffer
 * Returns null if buffer doesn't exist or is corrupted
 */
export function loadResponseBuffer(
  username: string,
  bufferId: string
): ResponseBuffer | null {
  const bufferPath = getResponseBufferPath(username, bufferId);

  if (!fs.existsSync(bufferPath)) {
    console.log(`${LOG_PREFIX} Buffer not found: ${bufferId}`);
    return null;
  }

  try {
    const raw = fs.readFileSync(bufferPath, 'utf-8');
    if (!raw || raw.trim().length === 0) {
      console.warn(`${LOG_PREFIX} Buffer ${bufferId} is empty`);
      return null;
    }

    const buffer: ResponseBuffer = JSON.parse(raw);
    return buffer;
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to load buffer ${bufferId}:`, error);
    return null;
  }
}

/**
 * Append an exchange to a response buffer
 */
export function appendToResponseBuffer(
  username: string,
  bufferId: string,
  role: 'user' | 'assistant',
  content: string,
  action?: string
): ResponseBuffer | null {
  const buffer = loadResponseBuffer(username, bufferId);
  if (!buffer) {
    console.error(`${LOG_PREFIX} Cannot append: buffer ${bufferId} not found`);
    return null;
  }

  if (buffer.resolved) {
    console.warn(`${LOG_PREFIX} Buffer ${bufferId} is already resolved`);
    // Still allow appending to resolved buffers for now
  }

  const exchange: ResponseBufferExchange = {
    role,
    content,
    timestamp: new Date().toISOString(),
    action,
  };

  buffer.exchanges.push(exchange);
  buffer.updatedAt = new Date().toISOString();

  const bufferPath = getResponseBufferPath(username, bufferId);
  fs.writeFileSync(bufferPath, JSON.stringify(buffer, null, 2));

  console.log(`${LOG_PREFIX} Appended ${role} to buffer ${bufferId} (${buffer.exchanges.length} exchanges)`);
  touchResponseBufferNotification(username, bufferId);

  return buffer;
}

/**
 * Mark a response buffer as resolved
 * Resolved buffers are candidates for cleanup
 */
export function resolveResponseBuffer(
  username: string,
  bufferId: string
): ResponseBuffer | null {
  const buffer = loadResponseBuffer(username, bufferId);
  if (!buffer) {
    console.error(`${LOG_PREFIX} Cannot resolve: buffer ${bufferId} not found`);
    return null;
  }

  buffer.resolved = true;
  buffer.updatedAt = new Date().toISOString();

  const bufferPath = getResponseBufferPath(username, bufferId);
  fs.writeFileSync(bufferPath, JSON.stringify(buffer, null, 2));

  console.log(`${LOG_PREFIX} Resolved buffer ${bufferId}`);
  touchResponseBufferNotification(username, bufferId);

  return buffer;
}

/**
 * List all response buffers for a user
 */
export function listResponseBuffers(username: string): ResponseBuffer[] {
  const dir = getResponseBufferDir(username);

  if (!fs.existsSync(dir)) {
    return [];
  }

  const buffers: ResponseBuffer[] = [];

  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const bufferId = file.replace('.json', '');
      const buffer = loadResponseBuffer(username, bufferId);
      if (buffer) {
        buffers.push(buffer);
      }
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to list buffers:`, error);
  }

  // Sort by most recent first
  buffers.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return buffers;
}

/**
 * Find active (unresolved) buffer for a specific card
 * Returns the most recent unresolved buffer for the given cardType and cardId
 */
export function findActiveBufferForCard(
  username: string,
  cardType: string,
  cardId: string
): ResponseBuffer | null {
  const buffers = listResponseBuffers(username);

  for (const buffer of buffers) {
    if (
      buffer.cardType === cardType &&
      buffer.cardId === cardId &&
      !buffer.resolved
    ) {
      return buffer;
    }
  }

  return null;
}

/**
 * Delete a response buffer
 */
export function deleteResponseBuffer(
  username: string,
  bufferId: string
): boolean {
  const bufferPath = getResponseBufferPath(username, bufferId);

  if (!fs.existsSync(bufferPath)) {
    return false;
  }

  try {
    fs.unlinkSync(bufferPath);
    console.log(`${LOG_PREFIX} Deleted buffer ${bufferId}`);
    return true;
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to delete buffer ${bufferId}:`, error);
    return false;
  }
}

// ============================================================================
// Cleanup Operations
// ============================================================================

/**
 * Clean up old resolved response buffers
 * @param username - User to clean up buffers for
 * @param maxAgeDays - Maximum age in days for resolved buffers (default: 7)
 * @returns Number of buffers cleaned up
 */
export function cleanupOldBuffers(
  username: string,
  maxAgeDays: number = 7
): number {
  const buffers = listResponseBuffers(username);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

  let cleaned = 0;

  for (const buffer of buffers) {
    // Only clean up resolved buffers
    if (!buffer.resolved) continue;

    const updatedAt = new Date(buffer.updatedAt);
    if (updatedAt < cutoffDate) {
      if (deleteResponseBuffer(username, buffer.id)) {
        cleaned++;
      }
    }
  }

  if (cleaned > 0) {
    console.log(`${LOG_PREFIX} Cleaned up ${cleaned} old buffers for ${username}`);
  }

  return cleaned;
}

/**
 * Archive resolved buffers (move to archive directory instead of deleting)
 * Useful for keeping training data
 */
export function archiveOldBuffers(
  username: string,
  maxAgeDays: number = 7
): number {
  const buffers = listResponseBuffers(username);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

  const archiveDir = path.join(getResponseBufferDir(username), 'archive');
  try {
    fs.mkdirSync(archiveDir, { recursive: true });
  } catch {
    // Ignore mkdir race conditions
  }

  let archived = 0;

  for (const buffer of buffers) {
    // Only archive resolved buffers
    if (!buffer.resolved) continue;

    const updatedAt = new Date(buffer.updatedAt);
    if (updatedAt < cutoffDate) {
      const sourcePath = getResponseBufferPath(username, buffer.id);
      const archivePath = path.join(archiveDir, `${buffer.id}.json`);

      try {
        fs.renameSync(sourcePath, archivePath);
        archived++;
      } catch (error) {
        console.error(`${LOG_PREFIX} Failed to archive buffer ${buffer.id}:`, error);
      }
    }
  }

  if (archived > 0) {
    console.log(`${LOG_PREFIX} Archived ${archived} old buffers for ${username}`);
  }

  return archived;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Build LLM context from response buffer history
 * Returns a formatted string of previous exchanges for the LLM
 */
export function buildContextFromBuffer(buffer: ResponseBuffer): string {
  if (buffer.exchanges.length === 0) {
    return '';
  }

  const lines: string[] = ['## Previous Exchanges in This Thread'];

  for (const exchange of buffer.exchanges) {
    const role = exchange.role === 'user' ? 'User' : 'Assistant';
    lines.push(`\n**${role}** (${exchange.timestamp}):`);
    lines.push(exchange.content);
    if (exchange.action) {
      lines.push(`_Action taken: ${exchange.action}_`);
    }
  }

  return lines.join('\n');
}

/**
 * Get buffer statistics for a user
 */
export function getBufferStats(username: string): {
  total: number;
  active: number;
  resolved: number;
  byCardType: Record<string, number>;
} {
  const buffers = listResponseBuffers(username);

  const stats = {
    total: buffers.length,
    active: 0,
    resolved: 0,
    byCardType: {} as Record<string, number>,
  };

  for (const buffer of buffers) {
    if (buffer.resolved) {
      stats.resolved++;
    } else {
      stats.active++;
    }

    stats.byCardType[buffer.cardType] = (stats.byCardType[buffer.cardType] || 0) + 1;
  }

  return stats;
}
