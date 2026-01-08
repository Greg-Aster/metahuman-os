#!/usr/bin/env tsx
/**
 * Start Active Operator from command line
 * 
 * Usage: 
 *   pnpm tsx scripts/start-active-operator.ts
 *   pnpm tsx scripts/start-active-operator.ts --username=greggles
 */

import { startActiveOperatorService, getActiveOperatorServiceStatus } from '@metahuman/core/active-operator';
import { getUsers } from '@metahuman/core';
import { audit } from '@metahuman/core';

const LOG_PREFIX = '[start-active-operator]';

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let username: string | undefined;
  
  for (const arg of args) {
    if (arg.startsWith('--username=')) {
      username = arg.split('=')[1];
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: pnpm tsx scripts/start-active-operator.ts [--username=USERNAME]');
      console.log('');
      console.log('Options:');
      console.log('  --username=USERNAME  Specify the username to run as (defaults to owner)');
      console.log('  --help, -h          Show this help message');
      process.exit(0);
    }
  }

  // If no username provided, find the owner
  if (!username) {
    const users = getUsers();
    const owner = users.find(u => u.role === 'owner');
    if (!owner) {
      console.error(`${LOG_PREFIX} Error: No owner user found. Please specify --username`);
      process.exit(1);
    }
    username = owner.username;
    console.log(`${LOG_PREFIX} No username specified, using owner: ${username}`);
  }

  console.log(`${LOG_PREFIX} Starting Active Operator for user: ${username}`);
  
  // Check current status
  const statusBefore = getActiveOperatorServiceStatus();
  if (statusBefore.isRunning) {
    console.log(`${LOG_PREFIX} Active Operator is already running for ${statusBefore.username}`);
    process.exit(0);
  }

  // Start the service
  const result = await startActiveOperatorService(username);
  
  if (result.success) {
    console.log(`${LOG_PREFIX} ✓ ${result.message}`);
    
    // Audit the manual start
    audit({
      category: 'system',
      level: 'info',
      event: 'active_operator_manual_start',
      actor: 'cli',
      details: {
        username,
        method: 'command_line_script'
      }
    });

    // Show status
    const statusAfter = getActiveOperatorServiceStatus();
    console.log(`${LOG_PREFIX} Status:`);
    console.log(`  - Running: ${statusAfter.isRunning}`);
    console.log(`  - Username: ${statusAfter.username}`);
    console.log(`  - Queue Length: ${statusAfter.queueLength}`);
    console.log('');
    console.log(`${LOG_PREFIX} Active Operator is now running in the background.`);
    console.log(`${LOG_PREFIX} Use the web UI or stop-active-operator.ts to stop it.`);
    
    // Keep the process alive
    console.log(`${LOG_PREFIX} Press Ctrl+C to exit (Active Operator will continue running)`);
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log(`\n${LOG_PREFIX} Script exiting. Active Operator will continue running.`);
      process.exit(0);
    });
    
    // Keep process alive
    setInterval(() => {
      // Just keep the process running
    }, 60000);
    
  } else {
    console.error(`${LOG_PREFIX} ✗ Failed to start: ${result.message}`);
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  console.error(`${LOG_PREFIX} Fatal error:`, error);
  process.exit(1);
});