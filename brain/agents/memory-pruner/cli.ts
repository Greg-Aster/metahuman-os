#!/usr/bin/env npx tsx
/**
 * Memory Pruner Agent — CLI Wrapper
 *
 * Cleans up memory storage by removing duplicates and low-quality entries.
 *
 * Usage:
 *   tsx brain/agents/memory-pruner/cli.ts --username <name> [options]
 *
 * Options:
 *   --username <name>   Required: User to process
 *   --dry-run           Preview what would be deleted without actually deleting
 *   --verbose           Show detailed information about each pruned memory
 *   --min-length <n>    Minimum content length (default: 10)
 *   --similarity <n>    Similarity threshold for near-duplicates (default: 0.85)
 *
 * Examples:
 *   # Preview what would be pruned
 *   tsx brain/agents/memory-pruner/cli.ts --username greggles --dry-run --verbose
 *
 *   # Actually prune memories
 *   tsx brain/agents/memory-pruner/cli.ts --username greggles
 */

import { runPrunerForUser, type PrunerOptions } from './core.js';

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let username: string | null = null;
  let dryRun = false;
  let verbose = false;
  let minContentLength = 10;
  let similarityThreshold = 0.85;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--username':
        username = args[++i];
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--verbose':
        verbose = true;
        break;
      case '--min-length':
        minContentLength = parseInt(args[++i], 10);
        break;
      case '--similarity':
        similarityThreshold = parseFloat(args[++i]);
        break;
      case '--help':
      case '-h':
        console.log(`
Memory Pruner Agent

Cleans up memory storage by removing duplicates and low-quality entries.

Usage:
  tsx brain/agents/memory-pruner/cli.ts --username <name> [options]

Options:
  --username <name>   Required: User to process
  --dry-run           Preview what would be deleted without actually deleting
  --verbose           Show detailed information about each pruned memory
  --min-length <n>    Minimum content length (default: 10)
  --similarity <n>    Similarity threshold for near-duplicates (default: 0.85)

Examples:
  # Preview what would be pruned (recommended first run)
  tsx brain/agents/memory-pruner/cli.ts --username greggles --dry-run --verbose

  # Actually prune memories
  tsx brain/agents/memory-pruner/cli.ts --username greggles
`);
        process.exit(0);
    }
  }

  if (!username) {
    console.error('Error: --username is required');
    console.error('Usage: tsx brain/agents/memory-pruner/cli.ts --username <name> [--dry-run] [--verbose]');
    process.exit(1);
  }

  console.log(`\n🧹 Memory Pruner Agent`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`User: ${username}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (preview only)' : 'LIVE (will delete files)'}`);
  console.log(`Min content length: ${minContentLength}`);
  console.log(`Similarity threshold: ${similarityThreshold}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const options: PrunerOptions = {
    dryRun,
    verbose,
    minContentLength,
    similarityThreshold,
  };

  try {
    const result = await runPrunerForUser(username, options);

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    if (result.memoriesPruned > 0) {
      console.log(`✅ Pruned ${result.memoriesPruned} of ${result.memoriesScanned} memories`);

      if (verbose && result.prunedMemories.length > 0) {
        console.log(`\nPruned memories:`);
        for (const pm of result.prunedMemories.slice(0, 20)) {
          console.log(`  - ${pm.id}: ${pm.reason.type} - ${pm.reason.description}`);
        }
        if (result.prunedMemories.length > 20) {
          console.log(`  ... and ${result.prunedMemories.length - 20} more`);
        }
      }
    } else {
      console.log(`✅ No memories need pruning (scanned ${result.memoriesScanned})`);
    }

    if (dryRun && result.memoriesPruned > 0) {
      console.log(`\n💡 Run without --dry-run to actually delete these memories`);
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error(`\n❌ Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
