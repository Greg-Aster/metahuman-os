#!/usr/bin/env tsx
/**
 * Check Active Operator status from command line
 * 
 * Usage: 
 *   pnpm tsx scripts/active-operator-status.ts
 */

import { getActiveOperatorServiceStatus } from '@metahuman/core/active-operator';
import { loadActiveOperatorConfig } from '@metahuman/core/active-operator';
import { getModeController } from '@metahuman/core/active-operator';

const LOG_PREFIX = '[active-operator-status]';

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: pnpm tsx scripts/active-operator-status.ts');
      console.log('');
      console.log('Shows the current status of the Active Operator service.');
      process.exit(0);
    }
  }

  // Get service status
  const status = getActiveOperatorServiceStatus();
  const config = loadActiveOperatorConfig();
  const modeController = getModeController();

  console.log(`${LOG_PREFIX} Active Operator Status`);
  console.log('═'.repeat(50));
  
  // Service status
  console.log(`Service: ${status.isRunning ? '🟢 RUNNING' : '🔴 STOPPED'}`);
  if (status.isRunning && status.username) {
    console.log(`Username: ${status.username}`);
  }
  
  // Mode
  console.log(`Mode: ${modeController.getMode()}`);
  console.log(`Enabled in config: ${config.enabled ? 'Yes' : 'No'}`);
  
  // Current activity
  if (status.currentTask) {
    console.log(`\nCurrent Task:`);
    console.log(`  Type: ${status.currentTask.type}`);
    console.log(`  Priority: ${status.currentTask.priority}`);
    console.log(`  Queued: ${new Date(status.currentTask.queuedAt).toLocaleString()}`);
  }
  
  // Queue status
  console.log(`\nQueue:`);
  console.log(`  Length: ${status.queueLength}`);
  console.log(`  Consecutive tasks: ${status.consecutiveTasks}`);
  
  // Configuration
  console.log(`\nConfiguration:`);
  console.log(`  Decision Model: ${config.decisionModel}`);
  console.log(`  Cooldown: ${config.cooldownMs}ms`);
  console.log(`  Max Consecutive Tasks: ${config.maxConsecutiveTasks}`);
  console.log(`  Enabled Task Types: ${config.enabledTaskTypes.length}`);
  if (config.enabledTaskTypes.length > 0 && config.enabledTaskTypes.length < 10) {
    config.enabledTaskTypes.forEach(type => {
      console.log(`    - ${type}`);
    });
  }
  
  // Big Brother mode
  if (config.bigBrotherMode?.enabled) {
    console.log(`\nBig Brother Mode:`);
    console.log(`  Enabled: Yes`);
    console.log(`  Delegate All: ${config.bigBrotherMode.delegateAll ? 'Yes' : 'No'}`);
    if (config.bigBrotherMode.projectPath) {
      console.log(`  Project Path: ${config.bigBrotherMode.projectPath}`);
    }
  }
  
  console.log('═'.repeat(50));
}

// Run the script
main().catch((error) => {
  console.error(`${LOG_PREFIX} Fatal error:`, error);
  process.exit(1);
});