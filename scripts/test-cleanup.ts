#!/usr/bin/env tsx
/**
 * Test the auto-cleanup functionality
 */

import { autoCleanupTrainingRuns, cleanupOldWorkDirectories } from '@metahuman/core';

async function main() {
  console.log('Testing auto-cleanup functions...\n');

  try {
    await autoCleanupTrainingRuns('greggles', '2025-11-22-060353-b09636', false);
    cleanupOldWorkDirectories('greggles');
    console.log('\n✅ Test complete!');
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
}

main();
