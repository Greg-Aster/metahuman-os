#!/usr/bin/env npx tsx
import { initGlobalLogger } from '@metahuman/core';
import { parseMoodArgs, parseMoodTriggerData, runCycle, type MoodOptions } from './core.js';

function triggerData(): Record<string, unknown> {
  const payload = JSON.parse(process.env.MH_TASK_PAYLOAD || '{}') as unknown;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('MH_TASK_PAYLOAD must contain a JSON object');
  }
  return parseMoodTriggerData((payload as Record<string, unknown>).triggerData);
}

async function main(): Promise<void> {
  initGlobalLogger('mood');
  const args = process.argv.slice(2);
  const options: MoodOptions = {
    ...parseMoodArgs(args),
    triggerData: triggerData(),
  };
  const result = await runCycle(options);
  if (!result.success) {
    console.error(`[mood] Failed: ${result.error || 'unknown error'}`);
    process.exit(1);
  }
  console.log(`[mood] Review complete: ${result.changed ? 'persona changed' : 'no change'}${result.activeFacet ? ` (${result.activeFacet})` : ''}`);
}

void main().catch(error => {
  console.error(`[mood] Failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
