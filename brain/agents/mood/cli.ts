#!/usr/bin/env npx tsx
import { initGlobalLogger } from '@metahuman/core';
import { runCycle, type MoodOptions } from './core.js';

function triggerData(): Record<string, unknown> {
  try {
    const payload = JSON.parse(process.env.MH_TASK_PAYLOAD || '{}');
    return payload?.triggerData && typeof payload.triggerData === 'object' ? payload.triggerData : {};
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  initGlobalLogger('mood');
  const args = process.argv.slice(2);
  const options: MoodOptions = {
    baseline: args.includes('--baseline'),
    triggerData: triggerData(),
  };
  const result = await runCycle(options);
  if (!result.success) {
    console.error(`[mood] Failed: ${result.error || 'unknown error'}`);
    process.exit(1);
  }
  console.log(`[mood] Review complete: ${result.changed ? 'persona changed' : 'no change'}${result.activeFacet ? ` (${result.activeFacet})` : ''}`);
}

void main();
