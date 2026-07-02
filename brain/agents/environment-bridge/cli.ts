#!/usr/bin/env node

import { initGlobalLogger } from '@metahuman/core';
import { runEnvironmentBridgeAgent } from './core.js';

function optionNumber(args: string[], name: string): number | undefined {
  const arg = args.find(value => value.startsWith(`${name}=`));
  return arg ? Number(arg.split('=')[1]) : undefined;
}

async function main() {
  initGlobalLogger('environment-bridge');

  const args = process.argv.slice(2);
  const result = await runEnvironmentBridgeAgent({
    once: args.includes('--once'),
    pollMs: optionNumber(args, '--poll-ms'),
    maxIdleMs: optionNumber(args, '--max-idle-ms'),
  });

  if (!result.success) {
    console.error('[environment-bridge] Failed:', result.error ?? 'unknown error');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('[environment-bridge] Fatal error:', error);
  process.exit(1);
});
