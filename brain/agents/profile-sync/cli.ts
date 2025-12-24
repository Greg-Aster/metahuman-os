#!/usr/bin/env node
/**
 * Profile Sync Agent — CLI Entry Point
 *
 * Thin wrapper that parses command-line args and calls core logic.
 * Used when running via tsx/process spawn on web/desktop.
 *
 * Command line args:
 *   --pull-only       Only download from server, don't push
 *   --memories-only   Only sync memories, skip profile
 *   --profile-only    Only sync profile, skip memories
 *   --full            Force complete memory sync (ignore lastMemorySyncAt)
 *   --skip-config     Skip etc/ directory (device-specific configs)
 *   --days=N          Only sync memories from last N days
 *   --user=<username> Sync single user
 *   --all-users       Sync all logged-in users (default when run from CLI without MH_TRIGGER_USERNAME)
 *
 * Environment variables:
 *   MH_TRIGGER_USERNAME  When set (by API), automatically targets that user only
 *
 * Login sync uses: --pull-only --full --skip-config
 */

import {
  getTargetUser,
  withUserContext,
  initGlobalLogger,
} from '@metahuman/core';
import {
  syncUserProfile,
  saveSyncState,
  printHeader,
  type SyncOptions,
  type SyncProgress,
} from './core.js';

async function main() {
  initGlobalLogger('profile-sync');

  // Parse command line args
  const args = process.argv.slice(2);
  const pullOnly = args.includes('--pull-only');
  const memoriesOnly = args.includes('--memories-only');
  const profileOnly = args.includes('--profile-only');
  const fullSync = args.includes('--full');
  const skipConfig = args.includes('--skip-config');
  const allUsers = args.includes('--all-users');
  const daysArg = args.find(a => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : undefined;
  const userArg = args.find(a => a.startsWith('--user='))?.split('=')[1];

  // Determine target user(s):
  // 1. Explicit --user= argument takes priority
  // 2. MH_TRIGGER_USERNAME from API trigger (single user mode)
  // 3. --all-users flag syncs all logged-in users
  // 4. Default: if triggered via API, use trigger user; otherwise all users
  const triggerUsername = process.env.MH_TRIGGER_USERNAME;
  const singleUser = userArg || (triggerUsername && !allUsers ? triggerUsername : undefined);

  const options: SyncOptions = {
    pullOnly,
    memoriesOnly,
    profileOnly,
    days,
    fullSync,
    skipConfig,
  };

  try {
    printHeader('PROFILE SYNC AGENT');
    console.log(`  Started: ${new Date().toISOString()}`);
    console.log(`  Mode: ${pullOnly ? 'pull-only' : 'full sync'}`);
    if (memoriesOnly) console.log(`  Scope: memories only`);
    if (profileOnly) console.log(`  Scope: profile only`);
    if (fullSync) console.log(`  Memory sync: full (ignoring timestamp)`);
    if (skipConfig) console.log(`  Config: skipping (device-specific)`);
    if (days) console.log(`  Time range: last ${days} days`);
    if (singleUser) console.log(`  User: ${singleUser}`);

    let totalProfileFiles = 0;
    let totalMemories = 0;
    let totalCredentials = 0;
    const allErrors: string[] = [];

    // Progress callback for UI
    const onProgress = (progress: SyncProgress) => {
      saveSyncState({
        phase: progress.phase,
        message: progress.message,
        current: progress.current,
        total: progress.total,
        updatedAt: new Date().toISOString(),
      });
    };

    if (singleUser) {
      // Sync single user
      const result = await withUserContext(
        { userId: singleUser, username: singleUser, role: 'owner' },
        async () => syncUserProfile(singleUser, options, onProgress)
      );
      totalProfileFiles = result.profileFiles;
      totalMemories = result.memoriesImported;
      totalCredentials = result.credentialsSynced ? 1 : 0;
      allErrors.push(...result.errors);
    } else {
      // SECURITY: Get target user - prioritizes explicit username, then API trigger, then most recently active
      const activeUser = getTargetUser();

      if (!activeUser) {
        console.log('[profile-sync] No active users found');
        saveSyncState({
          phase: 'complete',
          message: 'No active users to sync',
          completedAt: new Date().toISOString(),
        });
        return;
      }

      console.log(`[profile-sync] Processing user: ${activeUser.username}`);

      try {
        const result = await withUserContext(
          { userId: activeUser.userId, username: activeUser.username, role: activeUser.role },
          async () => syncUserProfile(activeUser.username, options, onProgress)
        );

        totalProfileFiles += result.profileFiles;
        totalMemories += result.memoriesImported;
        totalCredentials += result.credentialsSynced ? 1 : 0;
        allErrors.push(...result.errors);
      } catch (e) {
        console.error(`[profile-sync] Failed to sync ${activeUser.username}:`, e);
        allErrors.push(`User ${activeUser.username}: ${(e as Error).message}`);
      }
    }

    // Save final state
    saveSyncState({
      phase: 'complete',
      message: `Sync complete: ${totalProfileFiles} profile files, ${totalMemories} memories`,
      profileFiles: totalProfileFiles,
      memoriesImported: totalMemories,
      credentialsSynced: totalCredentials > 0,
      errors: allErrors,
      completedAt: new Date().toISOString(),
    });

    // Print final summary
    printHeader('SYNC COMPLETE');
    console.log(`  Profile files: ${totalProfileFiles}`);
    console.log(`  Memories imported: ${totalMemories}`);
    console.log(`  Credentials: ${totalCredentials > 0 ? 'synced' : 'skipped'}`);
    console.log(`  Finished: ${new Date().toISOString()}`);

    if (allErrors.length > 0) {
      console.log(`\n  Errors (${allErrors.length}):`);
      for (const err of allErrors) {
        console.log(`     - ${err}`);
      }
    } else {
      console.log(`\n  No errors`);
    }
    console.log('');

  } catch (error) {
    console.error('[profile-sync] Error during sync:', (error as Error).message);

    saveSyncState({
      phase: 'error',
      message: (error as Error).message,
      error: (error as Error).message,
      completedAt: new Date().toISOString(),
    });
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
