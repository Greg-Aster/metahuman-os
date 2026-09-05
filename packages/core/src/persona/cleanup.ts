/**
 * Session Cleanup Utility
 *
 * Cleans up old persona interview sessions based on age and status.
 * Can be run manually or scheduled via cron.
 */

import fs from 'node:fs';
import path from 'node:path';
import { audit } from '../audit.js';
import {
  getPersonaSessionStoragePaths,
  listSessions,
  loadSession,
  removeSessionRecord,
  resolvePersonaInterviewsPath,
  type SessionStatus,
} from './session-manager.js';

export interface CleanupOptions {
  maxAgeInDays: number; // Sessions older than this will be cleaned up
  statuses?: SessionStatus[]; // Only cleanup these statuses
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
    // Use the same storage category and layout as Session Manager.
    const interviewsDir = resolvePersonaInterviewsPath(username);

    const sessions = await listSessions(username);
    const now = Date.now();
    const maxAgeMs = options.maxAgeInDays * 24 * 60 * 60 * 1000;

    // Iterate through sessions
    for (const sessionMeta of sessions) {
      const sessionPaths = getPersonaSessionStoragePaths(interviewsDir, sessionMeta.sessionId);
      const artifactsPath = sessionPaths.artifacts;

      if (!await loadSession(username, sessionMeta.sessionId)) {
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
        (!options.statuses || options.statuses.includes(sessionMeta.status));

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
          const archivePath = path.join(interviewsDir, '_archive', sessionMeta.sessionId);
          fs.mkdirSync(archivePath, { recursive: true });
          if (fs.existsSync(artifactsPath)) {
            fs.renameSync(artifactsPath, path.join(archivePath, 'artifacts'));
          }
          await removeSessionRecord(username, sessionMeta.sessionId, true);

          result.sessions.push({
            sessionId: sessionMeta.sessionId,
            status: sessionMeta.status,
            age: ageDays,
            action: 'archived',
          });
          result.archived++;
        } else {
          if (fs.existsSync(artifactsPath)) {
            fs.rmSync(artifactsPath, { recursive: true, force: true });
          }
          await removeSessionRecord(username, sessionMeta.sessionId, false);

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

    // Audit cleanup
    if (!options.dryRun && (result.cleaned > 0 || result.archived > 0)) {
      audit({
        level: 'info',
        category: 'action',
        event: 'persona_sessions_cleaned',
        details: {
          username,
          cleaned: result.cleaned,
          archived: result.archived,
          errors: result.errors,
          maxAgeDays: options.maxAgeInDays,
        },
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
