#!/usr/bin/env tsx
/** Report Active Operator configuration and server-owned runtime status. */

import { loadActiveOperatorConfig } from '@metahuman/core/active-operator';
import {
  parseActiveOperatorCliOptions,
  requestActiveOperator,
} from './active-operator-client.js';

const LOG_PREFIX = '[active-operator-status]';

async function main() {
  const options = parseActiveOperatorCliOptions(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: pnpm tsx scripts/active-operator-status.ts [options]');
    console.log('');
    console.log('Options:');
    console.log('  --username=USERNAME  Use the newest active session for this user (defaults to owner)');
    console.log('  --session=TOKEN      Use an explicit mh_session token');
    console.log('  --url=URL            MetaHuman server URL (defaults to http://127.0.0.1:4321)');
    console.log('  --help, -h           Show this help message');
    return;
  }

  const config = loadActiveOperatorConfig();
  console.log(`${LOG_PREFIX} Active Operator Status`);
  console.log('═'.repeat(50));

  try {
    const status = await requestActiveOperator<{
      mode: string;
      health: string;
      healthMessage?: string;
      isExecuting: boolean;
      consecutiveTasks: number;
      policy: { running: boolean; evaluationsLastHour: number; scheduledAt?: string; pauseUntil?: string };
      queue: { length: number; tasks: Array<{ type: string; handler: string; state: string }> };
    }>('/api/active-operator/status', options);

    console.log(`Server: reachable (${options.serverUrl})`);
    console.log(`Mode: ${status.mode}`);
    console.log(`Health: ${status.health}${status.healthMessage ? ` — ${status.healthMessage}` : ''}`);
    console.log(`Policy: ${status.policy.running ? 'running' : 'stopped'}`);
    console.log(`Executing policy: ${status.isExecuting ? 'yes' : 'no'}`);
    console.log(`Active coordinator work: ${status.queue.length}`);
    console.log(`Consecutive autonomous tasks: ${status.consecutiveTasks}`);
    console.log(`Policy evaluations in last hour: ${status.policy.evaluationsLastHour}`);
    if (status.policy.scheduledAt) console.log(`Next policy evaluation: ${status.policy.scheduledAt}`);
    if (status.policy.pauseUntil) console.log(`Policy paused until: ${status.policy.pauseUntil}`);
  } catch (error) {
    console.log(`Server runtime: unavailable — ${(error as Error).message}`);
    console.log(`Configured mode: ${config.autonomyMode}`);
    process.exitCode = 1;
  }

  console.log('\nPersisted policy limits:');
  console.log(`  Cooldown: ${config.cooldownMs}ms`);
  console.log(`  Maximum consecutive tasks: ${config.maxConsecutiveTasks}`);
  console.log(`  Maximum evaluations/hour: ${config.maxEvaluationsPerHour}`);
  console.log(`  User-presence cooldown: ${config.userPresenceCooldownMs}ms`);
  console.log('═'.repeat(50));
}

main().catch((error) => {
  console.error(`${LOG_PREFIX} Fatal error:`, error);
  process.exit(1);
});
