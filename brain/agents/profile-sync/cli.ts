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
 *   --user=<username> Sync single user (default: all users)
 *
 * Login sync uses: --pull-only --full --skip-config
 */

import {
  getLoggedInUsers,
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
  const daysArg = args.find(a => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : undefined;
  const singleUser = args.find(a => a.startsWith('--user='))?.split('=')[1];

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
      // Sync all logged-in users
      const users = getLoggedInUsers();
      console.log(`[profile-sync] Found ${users.length} logged-in users to sync`);

      for (const user of users) {
        try {
          const result = await withUserContext(
            { userId: user.userId, username: user.username, role: user.role },
            async () => syncUserProfile(user.username, options, onProgress)
          );

          totalProfileFiles += result.profileFiles;
          totalMemories += result.memoriesImported;
          totalCredentials += result.credentialsSynced ? 1 : 0;
          allErrors.push(...result.errors);
        } catch (e) {
          console.error(`[profile-sync] Failed to sync ${user.username}:`, e);
          allErrors.push(`User ${user.username}: ${(e as Error).message}`);
        }
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
