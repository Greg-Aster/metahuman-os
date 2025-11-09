/**
 * Recent Tools Cache
 *
 * Lightweight append-only cache for tool invocations to avoid scanning
 * thousands of episodic memory files during context building.
 *
 * Workstream A1-A4 from memory-continuity-performance-directive.md
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { paths } from './paths.js';
import { audit } from './audit.js';

const MAX_TOOL_OUTPUT_SIZE = 2048; // 2 KB threshold for payload splitting
const TOOL_SUMMARY_LENGTH = 256; // Summary character limit

export interface RecentToolEntry {
  eventId: string;
  toolName: string;
  success: boolean;
  timestamp: string;
  conversationId: string;
  snippetPath?: string; // Path to full output if >2KB
  summary?: string; // Truncated output for quick display
  output?: string; // Full output if <2KB
}

export interface ToolCacheManifest {
  conversationId: string;
  lastUpdated: string;
  entryCount: number;
}

/**
 * Get the cache directory path for a user profile
 */
function getRecentToolsCachePath(username: string): string {
  return path.join(paths.root, 'profiles', username, 'state', 'recent-tools');
}

/**
 * Get the cache file path for a specific conversation
 */
function getCacheFilePath(username: string, conversationId: string): string {
  const cacheDir = getRecentToolsCachePath(username);
  return path.join(cacheDir, `${conversationId}.jsonl`);
}

/**
 * Get the tool output payload storage path
 */
function getToolOutputPath(username: string, eventId: string): string {
  return path.join(paths.root, 'profiles', username, 'logs', 'tool-output', `${eventId}.json`);
}

/**
 * Ensure cache directories exist
 */
async function ensureCacheDirectories(username: string): Promise<void> {
  const cacheDir = getRecentToolsCachePath(username);
  const outputDir = path.join(paths.root, 'profiles', username, 'logs', 'tool-output');

  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
}

/**
 * Write a tool invocation to the cache (async, non-blocking)
 *
 * A4: If output exceeds 2KB, split into payload file + summary
 */
export async function appendToolToCache(
  username: string,
  conversationId: string,
  eventId: string,
  toolName: string,
  success: boolean,
  output: string
): Promise<void> {
  try {
    await ensureCacheDirectories(username);

    const entry: RecentToolEntry = {
      eventId,
      toolName,
      success,
      timestamp: new Date().toISOString(),
      conversationId,
    };

    // A4: Split large outputs into separate payload files
    if (output.length > MAX_TOOL_OUTPUT_SIZE) {
      const payloadPath = getToolOutputPath(username, eventId);

      // Write full output to payload file
      await fs.writeFile(payloadPath, JSON.stringify({
        eventId,
        toolName,
        output,
        timestamp: entry.timestamp
      }, null, 2));

      entry.snippetPath = payloadPath;
      entry.summary = output.slice(0, TOOL_SUMMARY_LENGTH) + (output.length > TOOL_SUMMARY_LENGTH ? '...' : '');
    } else {
      entry.output = output;
    }

    const cacheFile = getCacheFilePath(username, conversationId);
    const line = JSON.stringify(entry) + '\n';

    // Append to JSONL file (non-blocking)
    await fs.appendFile(cacheFile, line);

  } catch (error) {
    // Log but don't fail - cache is optional optimization
    audit({
      level: 'warn',
      category: 'system',
      event: 'tool_cache_write_failed',
      details: {
        username,
        conversationId,
        eventId,
        error: (error as Error).message
      },
      actor: 'system',
    });
  }
}

/**
 * Read recent tool invocations from cache (bounded by contextDepth)
 *
 * A3: O(records) instead of O(files) - fallback to episodic scan only if missing
 */
export async function readRecentToolsFromCache(
  username: string,
  conversationId: string,
  contextDepth: number = 10
): Promise<RecentToolEntry[]> {
  const cacheFile = getCacheFilePath(username, conversationId);

  try {
    // Check if cache exists
    const exists = fsSync.existsSync(cacheFile);

    if (!exists) {
      // A3: Log fallback to episodic scan
      audit({
        level: 'warn',
        category: 'system',
        event: 'tool_cache_miss',
        details: { username, conversationId, reason: 'cache_file_not_found' },
        actor: 'system',
      });
      return [];
    }

    const content = await fs.readFile(cacheFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    // Return last N entries (bounded by contextDepth)
    const entries = lines
      .slice(-contextDepth)
      .map(line => JSON.parse(line) as RecentToolEntry);

    return entries;

  } catch (error) {
    audit({
      level: 'warn',
      category: 'system',
      event: 'tool_cache_read_failed',
      details: {
        username,
        conversationId,
        error: (error as Error).message
      },
      actor: 'system',
    });
    return [];
  }
}

/**
 * Invalidate tool cache for a conversation
 * (for when episodic events are modified/deleted)
 */
export async function invalidateToolCache(
  username: string,
  conversationId: string
): Promise<void> {
  const cacheFile = getCacheFilePath(username, conversationId);

  try {
    await fs.unlink(cacheFile);

    audit({
      level: 'info',
      category: 'system',
      event: 'tool_cache_invalidated',
      details: { username, conversationId },
      actor: 'system',
    });
  } catch (error) {
    // File may not exist - that's fine
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      audit({
        level: 'warn',
        category: 'system',
        event: 'tool_cache_invalidation_failed',
        details: {
          username,
          conversationId,
          error: (error as Error).message
        },
        actor: 'system',
      });
    }
  }
}

/**
 * A4: Cleanup orphaned tool output payload files
 * Removes files older than 90 days with no episodic event reference
 */
export async function cleanupOrphanedToolOutputs(
  username: string,
  maxAgeDays: number = 90
): Promise<{ removed: number; errors: number }> {
  const outputDir = path.join(paths.root, 'profiles', username, 'logs', 'tool-output');

  let removed = 0;
  let errors = 0;

  try {
    const files = await fs.readdir(outputDir);
    const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);

    for (const file of files) {
      try {
        const filePath = path.join(outputDir, file);
        const stats = await fs.stat(filePath);

        // Remove if older than cutoff
        if (stats.mtimeMs < cutoffTime) {
          await fs.unlink(filePath);
          removed++;
        }
      } catch (err) {
        errors++;
      }
    }

    audit({
      level: 'info',
      category: 'system',
      event: 'tool_output_cleanup_completed',
      details: { username, removed, errors, maxAgeDays },
      actor: 'system',
    });

  } catch (error) {
    audit({
      level: 'error',
      category: 'system',
      event: 'tool_output_cleanup_failed',
      details: { username, error: (error as Error).message },
      actor: 'system',
    });
  }

  return { removed, errors };
}

/**
 * Get cache manifest for monitoring
 */
export async function getToolCacheManifest(
  username: string,
  conversationId: string
): Promise<ToolCacheManifest | null> {
  const cacheFile = getCacheFilePath(username, conversationId);

  try {
    const exists = fsSync.existsSync(cacheFile);
    if (!exists) return null;

    const content = await fs.readFile(cacheFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const stats = await fs.stat(cacheFile);

    return {
      conversationId,
      lastUpdated: stats.mtime.toISOString(),
      entryCount: lines.length,
    };
  } catch {
    return null;
  }
}
