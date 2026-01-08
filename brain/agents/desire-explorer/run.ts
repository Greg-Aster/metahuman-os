#!/usr/bin/env npx tsx
/**
 * Desire Explorer Agent — Runner
 *
 * Explores desires before planning to gather context and generate smart questions.
 *
 * Usage:
 *   npx tsx brain/agents/desire-explorer/run.ts
 *   ./bin/mh agent run desire-explorer
 */

import { runDesireExplorer } from './core.js';

async function main() {
  console.log('='.repeat(60));
  console.log('DESIRE EXPLORER AGENT');
  console.log('='.repeat(60));

  const startTime = Date.now();
  const result = await runDesireExplorer();
  const duration = Date.now() - startTime;

  console.log('');
  console.log('='.repeat(60));
  console.log(`Completed in ${duration}ms`);
  console.log(`  Explored: ${result.stats.explored}`);
  console.log(`  Questions sent: ${result.stats.questionsSent}`);
  console.log(`  Errors: ${result.stats.errors}`);

  if (result.errors.length > 0) {
    console.log('');
    console.log('Errors:');
    result.errors.forEach(e => console.log(`  - ${e}`));
  }

  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
