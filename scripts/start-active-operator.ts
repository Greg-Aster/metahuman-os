#!/usr/bin/env tsx
/** Enable full Active Operator mode through the server-owned runtime. */

import {
  parseActiveOperatorCliOptions,
  requestActiveOperator,
} from './active-operator-client.js';

const LOG_PREFIX = '[start-active-operator]';

async function main() {
  const options = parseActiveOperatorCliOptions(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: pnpm tsx scripts/start-active-operator.ts [options]');
    console.log('');
    console.log('Options:');
    console.log('  --username=USERNAME  Use the newest active session for this user (defaults to owner)');
    console.log('  --session=TOKEN      Use an explicit mh_session token');
    console.log('  --url=URL            MetaHuman server URL (defaults to http://127.0.0.1:4321)');
    console.log('  --help, -h           Show this help message');
    return;
  }

  console.log(`${LOG_PREFIX} Enabling full autonomy through ${options.serverUrl}...`);
  const result = await requestActiveOperator<{ success: boolean; mode: string; message: string }>(
    '/api/active-operator/control',
    options,
    { method: 'POST', body: JSON.stringify({ action: 'set-mode', mode: 'full' }) },
  );
  if (!result.success) throw new Error(result.message || 'Active Operator mode change failed');

  console.log(`${LOG_PREFIX} ✓ ${result.message}`);
  console.log(`${LOG_PREFIX} The MetaHuman server owns the running policy and work coordinator.`);
}

main().catch((error) => {
  console.error(`${LOG_PREFIX} Fatal error:`, error);
  process.exit(1);
});
