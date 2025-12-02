/**
 * Session Cleanup Utility
 *
 * Cleans up old persona interview sessions based on age and status.
 * Can be run manually or scheduled via cron.
 */

import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../path-builder.js';
import { audit } from '../audit.js';

export interface CleanupOptions {
  maxAgeInDays: number; // Sessions older than this will be cleaned up
  statuses?: ('active' | 'completed' | 'finalized' | 'applied' | 'aborted')[]; // Only cleanup these statuses
  dryRun?: boolean; // If true, only report what would be cleaned, don't actually clean
  archiveBeforeDelete?: boolean; // If true, move to archive instead of deleting
}

export interface CleanupResult {
  cleaned: number;
  archived: number;
  errors: number;
  sessions: Array<{
    sessionId: string;
    status: string;
    age: number;
    action: 'cleaned' | 'archived' | 'error' | 'skipped';
    reason?: string;
  }>;
}

/**
 * Clean up old persona interview sessions
 */
export async function cleanupSessions(
  username: string,
  options: CleanupOptions = {
    maxAgeInDays: 30,
    statuses: ['aborted', 'completed', 'finalized', 'applied'],
    dryRun: false,
    archiveBeforeDelete: true,
  }
): Promise<CleanupResult> {
  const result: CleanupResult = {
    cleaned: 0,
    archived: 0,
    errors: 0,
    sessions: [],
  };

  try {
    // Resolve interviews directory path
    const interviewsDir = path.join(systemPaths.profiles, username, 'persona', 'interviews');

    if (!fs.existsSync(interviewsDir)) {
      console.log(`[cleanup] No interviews directory found for user: ${username}`);
      return result;
    }

    // Load index
    const indexPath = path.join(interviewsDir, 'index.json');
    if (!fs.existsSync(indexPath)) {
      console.log('[cleanup] No index.json found');
      return result;
    }

    const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const now = Date.now();
    const maxAgeMs = options.maxAgeInDays * 24 * 60 * 60 * 1000;

    // Iterate through sessions
    for (const sessionMeta of index.sessions) {
      const sessionDir = path.join(interviewsDir, sessionMeta.sessionId);
      const sessionPath = path.join(sessionDir, 'session.json');

      if (!fs.existsSync(sessionPath)) {
        result.sessions.push({
          sessionId: sessionMeta.sessionId,
          status: sessionMeta.status,
          age: 0,
          action: 'error',
          reason: 'Session file not found',
        });
        result.errors++;
        continue;
      }

      // Calculate age
      const sessionCreatedAt = new Date(sessionMeta.createdAt).getTime();
      const ageMs = now - sessionCreatedAt;
      const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

      // Check if session should be cleaned
      const shouldClean =
        ageMs > maxAgeMs &&
        (!options.statuses || options.statuses.includes(sessionMeta.status as any));

      if (!shouldClean) {
        result.sessions.push({
          sessionId: sessionMeta.sessionId,
          status: sessionMeta.status,
          age: ageDays,
          action: 'skipped',
          reason: `Age: ${ageDays}d, Status: ${sessionMeta.status}`,
        });
        continue;
      }

      // Dry run - just report
      if (options.dryRun) {
        result.sessions.push({
          sessionId: sessionMeta.sessionId,
          status: sessionMeta.status,
          age: ageDays,
          action: options.archiveBeforeDelete ? 'archived' : 'cleaned',
          reason: `Would be ${options.archiveBeforeDelete ? 'archived' : 'deleted'}`,
        });
        if (options.archiveBeforeDelete) {
          result.archived++;
        } else {
          result.cleaned++;
        }
        continue;
      }

      // Archive or delete
      try {
        if (options.archiveBeforeDelete) {
          // Create archive directory
          const archiveDir = path.join(interviewsDir, '_archive');
          fs.mkdirSync(archiveDir, { recursive: true });

          // Move session to archive
          const archivePath = path.join(archiveDir, sessionMeta.sessionId);
          fs.renameSync(sessionDir, archivePath);

          result.sessions.push({
            sessionId: sessionMeta.sessionId,
            status: sessionMeta.status,
            age: ageDays,
            action: 'archived',
          });
          result.archived++;
        } else {
          // Delete session directory
          fs.rmSync(sessionDir, { recursive: true, force: true });

          result.sessions.push({
            sessionId: sessionMeta.sessionId,
            status: sessionMeta.status,
            age: ageDays,
            action: 'cleaned',
          });
          result.cleaned++;
        }
      } catch (error) {
        result.sessions.push({
          sessionId: sessionMeta.sessionId,
          status: sessionMeta.status,
          age: ageDays,
          action: 'error',
          reason: (error as Error).message,
        });
        result.errors++;
      }
    }

    // Update index to remove cleaned sessions (if not dry run)
    if (!options.dryRun) {
      const cleanedSessionIds = result.sessions
        .filter((s) => s.action === 'cleaned' || s.action === 'archived')
        .map((s) => s.sessionId);

      if (cleanedSessionIds.length > 0) {
        index.sessions = index.sessions.filter(
          (s: any) => !cleanedSessionIds.includes(s.sessionId)
        );
        index.totalSessions = index.sessions.length;
        index.lastCleanup = new Date().toISOString();

        fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
      }
    }

    // Audit cleanup
    if (!options.dryRun && (result.cleaned > 0 || result.archived > 0)) {
      await audit('action', 'info', {
        action: 'persona_sessions_cleaned',
        username,
        cleaned: result.cleaned,
        archived: result.archived,
        errors: result.errors,
        maxAgeDays: options.maxAgeInDays,
        actor: 'system',
      });
    }

    return result;
  } catch (error) {
    console.error('[cleanup] Error during cleanup:', error);
    throw error;
  }
}

/**
 * Get cleanup preview without actually cleaning
 */
export async function previewCleanup(
  username: string,
  maxAgeInDays: number = 30
): Promise<CleanupResult> {
  return cleanupSessions(username, {
    maxAgeInDays,
    statuses: ['aborted', 'completed', 'finalized', 'applied'],
    dryRun: true,
    archiveBeforeDelete: true,
  });
}
