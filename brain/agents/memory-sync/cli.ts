#!/usr/bin/env node
/**
 * Memory Sync Agent — CLI Entry Point
 *
 * Usage:
 *   tsx brain/agents/memory-sync/cli.ts
 *   tsx brain/agents/memory-sync/cli.ts --pull-only
 *   tsx brain/agents/memory-sync/cli.ts --push-only
 *   tsx brain/agents/memory-sync/cli.ts --user=<username>
 */

import { initGlobalLogger } from '@metahuman/core';
import { runMemorySync } from './core.js';

async function main() {
  initGlobalLogger('memory-sync');

  // Parse command line args
  const args = process.argv.slice(2);
  const pullOnly = args.includes('--pull-only');
  const pushOnly = args.includes('--push-only');
  const singleUser = args.find(a => a.startsWith('--user='))?.split('=')[1];

  try {
    console.log('══════════════════════════════════════════════════');
    console.log('  MEMORY SYNC AGENT');
    console.log('══════════════════════════════════════════════════');
    console.log(`  Started: ${new Date().toISOString()}`);
    console.log(`  Mode: ${pullOnly ? 'pull-only' : pushOnly ? 'push-only' : 'full sync'}`);
    if (singleUser) console.log(`  User: ${singleUser}`);

    const result = await runMemorySync({
      pullOnly,
      pushOnly,
      username: singleUser,
    });

    console.log('══════════════════════════════════════════════════');
    console.log('  SYNC COMPLETE');
    console.log('══════════════════════════════════════════════════');
    console.log(`  ↓ Pulled: ${result.totalPulled} memories`);
    console.log(`  ↑ Pushed: ${result.totalPushed} memories`);
    if (result.totalConflicts > 0) {
      console.log(`  ⚡ Conflicts: ${result.totalConflicts} (skipped)`);
    }
    console.log(`  ⏱️  Finished: ${new Date().toISOString()}`);

    if (result.errors.length > 0) {
      console.log(`\n  ⚠️  Errors (${result.errors.length}):`);
      for (const err of result.errors) {
        console.log(`     - ${err}`);
      }
    } else {
      console.log(`\n  ✓ No errors`);
    }
    console.log('');

  } catch (error) {
    console.error('[memory-sync] Error during sync:', (error as Error).message);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
