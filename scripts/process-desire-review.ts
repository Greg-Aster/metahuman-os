#!/usr/bin/env tsx
/**
 * Submit desire review to the server-owned work coordinator.
 */

import { submitCoordinatorWork } from '@metahuman/core/queue';

async function main() {
  const username = 'greggles';
  
  console.log('[desire-review] Submitting review work...');
  try {
    const task = await submitCoordinatorWork({
      type: 'custom',
      handler: 'agent.desire-outcome-reviewer',
      resource: 'local-llm',
      source: 'user',
      username,
      priority: 'normal',
      input: { triggeredBy: 'process-desire-review' },
      idempotencyKey: `manual:desire-review:${new Date().toISOString().slice(0, 10)}`,
    });
    console.log(`[desire-review] Queued as ${task.id}`);
  } catch (error) {
    console.error('[desire-review] Error:', error);
    process.exitCode = 1;
  }
}

main().catch(console.error);
