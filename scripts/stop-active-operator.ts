#!/usr/bin/env tsx
/**
 * Stop Active Operator from command line
 * 
 * Usage: 
 *   pnpm tsx scripts/stop-active-operator.ts
 */

import { stopActiveOperatorService, getActiveOperatorServiceStatus } from '@metahuman/core/active-operator';
import { audit } from '@metahuman/core';

const LOG_PREFIX = '[stop-active-operator]';

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: pnpm tsx scripts/stop-active-operator.ts');
      console.log('');
      console.log('Stops the Active Operator service if it is running.');
      process.exit(0);
    }
  }

  console.log(`${LOG_PREFIX} Stopping Active Operator...`);
  
  // Check current status
  const statusBefore = getActiveOperatorServiceStatus();
  if (!statusBefore.isRunning) {
    console.log(`${LOG_PREFIX} Active Operator is not running.`);
    process.exit(0);
  }

  console.log(`${LOG_PREFIX} Active Operator is currently running for user: ${statusBefore.username}`);
  if (statusBefore.currentTask) {
    console.log(`${LOG_PREFIX} Current task: ${statusBefore.currentTask.type}`);
  }

  // Stop the service
  const result = await stopActiveOperatorService();
  
  if (result.success) {
    console.log(`${LOG_PREFIX} ✓ ${result.message}`);
    
    // Audit the manual stop
    audit({
      category: 'system',
      level: 'info',
      event: 'active_operator_manual_stop',
      actor: 'cli',
      details: {
        method: 'command_line_script',
        previousUsername: statusBefore.username
      }
    });

    // Show final status
    const statusAfter = getActiveOperatorServiceStatus();
    console.log(`${LOG_PREFIX} Status:`);
    console.log(`  - Running: ${statusAfter.isRunning}`);
    console.log('');
    console.log(`${LOG_PREFIX} Active Operator has been stopped.`);
    
  } else {
    console.error(`${LOG_PREFIX} ✗ Failed to stop: ${result.message}`);
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  console.error(`${LOG_PREFIX} Fatal error:`, error);
  process.exit(1);
});