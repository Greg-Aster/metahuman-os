#!/usr/bin/env node

import { initGlobalLogger } from '@metahuman/core';
import { runEnvironmentBridgeAgent } from './core.js';

function argValue(args: string[], ...names: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    for (const name of names) {
      if (arg === name) {
        return args[index + 1]?.trim() || undefined;
      }
      if (arg.startsWith(`${name}=`)) {
        return arg.slice(name.length + 1).trim() || undefined;
      }
    }
  }
  return undefined;
}

async function main() {
  initGlobalLogger('environment-bridge');

  const args = process.argv.slice(2);
  const result = await runEnvironmentBridgeAgent({
    enabled: !args.includes('--disable'),
    adapter: argValue(args, '--adapter'),
    username: argValue(args, '--username', '--user') ?? process.env.MH_TRIGGER_USERNAME,
    url: argValue(args, '--url'),
    roomName: argValue(args, '--room', '--room-name'),
    graphName: argValue(args, '--graph', '--graph-name'),
  });

  if (!result.success) {
    console.error('[environment-bridge] Failed:', result.error ?? 'unknown error');
    process.exit(1);
  }

  process.exit(0);
}

main().catch(error => {
  console.error('[environment-bridge] Fatal error:', error);
  process.exit(1);
});
