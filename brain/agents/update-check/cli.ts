#!/usr/bin/env node
/**
 * Update Check Agent — CLI Entry Point
 *
 * Usage:
 *   tsx brain/agents/update-check/cli.ts
 *   tsx brain/agents/update-check/cli.ts --mobile --server=https://example.com --version-code=1
 */

import { initGlobalLogger } from '@metahuman/core';
import { runUpdateCheck } from './core.js';

async function main() {
  initGlobalLogger('update-check');

  const args = process.argv.slice(2);
  const isMobile = args.includes('--mobile');
  const serverUrl = args.find(a => a.startsWith('--server='))?.split('=')[1];
  const versionCode = parseInt(args.find(a => a.startsWith('--version-code='))?.split('=')[1] || '1', 10);

  try {
    console.log('[update-check] Checking for updates...');

    const result = await runUpdateCheck({
      mobile: isMobile,
      serverUrl,
      versionCode,
    });

    if (result.updateAvailable) {
      console.log(`[update-check] Update available: ${result.currentVersion} -> ${result.latestVersion}`);
    } else {
      console.log(`[update-check] Current version ${result.currentVersion} is up to date`);
    }

  } catch (error) {
    console.error('[update-check] Error during check:', (error as Error).message);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
