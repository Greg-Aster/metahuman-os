#!/usr/bin/env tsx
/**
 * Test Big Brother terminal discovery
 * 
 * Usage: 
 *   pnpm tsx scripts/test-big-brother-discovery.ts
 */

import { bigBrotherTerminal, ensureBigBrotherTerminal, openBigBrotherTab } from '@metahuman/core';

const LOG_PREFIX = '[test-big-brother-discovery]';

async function main() {
  console.log(`${LOG_PREFIX} Testing Big Brother terminal discovery...`);
  
  // Check current state
  const initialState = bigBrotherTerminal.getState();
  console.log(`${LOG_PREFIX} Initial state:`, initialState);
  
  // Start Big Brother terminal if not running
  if (!initialState.isRunning) {
    console.log(`${LOG_PREFIX} Starting Big Brother terminal...`);
    const started = await ensureBigBrotherTerminal();
    console.log(`${LOG_PREFIX} Started:`, started);
    
    // Wait a moment for it to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  // Get state after starting
  const runningState = bigBrotherTerminal.getState();
  console.log(`${LOG_PREFIX} Running state:`, runningState);
  
  // Test the terminal list API
  console.log(`${LOG_PREFIX} Testing terminal list API...`);
  try {
    const response = await fetch('http://localhost:4321/api/terminal/list');
    const data = await response.json();
    console.log(`${LOG_PREFIX} Terminal list response:`, JSON.stringify(data, null, 2));
    
    const bigBrother = data.terminals?.find((t: any) => t.isBigBrother || t.port === 3099);
    if (bigBrother) {
      console.log(`${LOG_PREFIX} ✅ Big Brother terminal found in list:`, bigBrother);
    } else {
      console.log(`${LOG_PREFIX} ❌ Big Brother terminal NOT found in list`);
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Error fetching terminal list:`, error);
  }
  
  // Test opening the terminal tab
  console.log(`${LOG_PREFIX} Testing openBigBrotherTab...`);
  openBigBrotherTab();
  console.log(`${LOG_PREFIX} Tab open event emitted`);
  
  console.log(`${LOG_PREFIX} Test complete. Check the web UI to see if the Big Brother tab appears.`);
}

// Run the script
main().catch((error) => {
  console.error(`${LOG_PREFIX} Fatal error:`, error);
  process.exit(1);
});