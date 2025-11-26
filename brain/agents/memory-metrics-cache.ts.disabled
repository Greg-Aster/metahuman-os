import path from 'node:path';
import {
  initGlobalLogger,
  listUsers,
  withUserContext,
  getUserContext,
  audit,
  updateMetricsCache,
  cleanupOrphanedToolOutputs,
} from '../../packages/core/src/index.js';

async function refreshUser(userId: string): Promise<void> {
  await withUserContext(userId, async () => {
    const ctx = getUserContext();
    if (!ctx?.profilePaths) {
      return;
    }

    const profileName = path.basename(ctx.profilePaths.root);

    try {
      await updateMetricsCache(ctx.username, {
        profilePaths: ctx.profilePaths,
        profileName,
      });
      await cleanupOrphanedToolOutputs(ctx.profilePaths, 90);
    } catch (error) {
      audit({
        level: 'error',
        category: 'system',
        event: 'memory_metrics_background_failed',
        actor: 'memory-metrics-cache',
        details: {
          profile: profileName,
          error: (error as Error).message,
        },
      });
    }
  });
}

async function main(): Promise<void> {
  initGlobalLogger();

  const users = await listUsers();
  if (users.length === 0) {
    console.log('[memory-metrics-cache] No users found.');
    return;
  }

  for (const user of users) {
    console.log(`[memory-metrics-cache] Updating metrics for ${user.username}`);
    await refreshUser(user.userId);
  }

  console.log('[memory-metrics-cache] Metrics refresh complete.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('[memory-metrics-cache] Fatal error:', error);
    process.exit(1);
  });
}
