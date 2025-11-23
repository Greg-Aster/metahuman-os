#!/usr/bin/env tsx
/**
 * Cleanup script for archiving old training runs
 *
 * Strategy:
 * - Keep the latest successful run (safetensors + GGUF)
 * - For older runs: Keep safetensors (for retraining), delete GGUF (saves space)
 * - Delete failed runs completely (no usable output)
 *
 * Usage:
 *   pnpm tsx scripts/cleanup-old-training-runs.ts --username greggles [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from '@metahuman/core';

interface RunInfo {
  runLabel: string;
  runPath: string;
  ggufPath: string;
  safetensorsPath: string;
  hasGGUF: boolean;
  hasSafetensors: boolean;
  ggufSize: number;
  safetensorsSize: number;
  timestamp: Date;
  isLatest: boolean;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let username: string | null = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      username = args[i + 1];
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  if (!username) {
    console.error('ERROR: --username <name> is required');
    console.error('\nUsage: pnpm tsx scripts/cleanup-old-training-runs.ts --username <username> [--dry-run]');
    process.exit(1);
  }

  return { username, dryRun };
}

function getRunInfo(username: string, dateDir: string, runLabel: string): RunInfo {
  const profileRoot = path.join(systemPaths.root, 'profiles', username);
  const runPath = path.join(profileRoot, 'out', 'adapters', dateDir, runLabel);
  const ggufPath = path.join(runPath, 'adapter.gguf');
  const safetensorsDir = path.join(runPath, 'adapter');
  const safetensorsPath = path.join(safetensorsDir, 'adapter_model.safetensors');

  const hasGGUF = fs.existsSync(ggufPath);
  const hasSafetensors = fs.existsSync(safetensorsPath);

  let ggufSize = 0;
  let safetensorsSize = 0;

  if (hasGGUF) {
    ggufSize = fs.statSync(ggufPath).size;
  }

  if (hasSafetensors) {
    safetensorsSize = fs.statSync(safetensorsPath).size;
  }

  // Extract timestamp from run label (format: YYYY-MM-DD-HHMMSS-xxxxx)
  const match = runLabel.match(/^(\d{4}-\d{2}-\d{2})-(\d{6})/);
  const timestamp = match ? new Date(`${match[1]}T${match[2].slice(0, 2)}:${match[2].slice(2, 4)}:${match[2].slice(4, 6)}`) : new Date(0);

  return {
    runLabel,
    runPath,
    ggufPath,
    safetensorsPath,
    hasGGUF,
    hasSafetensors,
    ggufSize,
    safetensorsSize,
    timestamp,
    isLatest: false,
  };
}

function formatSize(bytes: number): string {
  const gb = bytes / (1024 ** 3);
  const mb = bytes / (1024 ** 2);
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${mb.toFixed(2)} MB`;
}

async function main() {
  const { username, dryRun } = parseArgs();

  console.log(`\n🧹 Cleanup Old Training Runs`);
  console.log(`User: ${username}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (will delete files)'}\n`);

  const profileRoot = path.join(systemPaths.root, 'profiles', username);
  const adaptersRoot = path.join(profileRoot, 'out', 'adapters');

  if (!fs.existsSync(adaptersRoot)) {
    console.log('No training runs found.');
    return;
  }

  // Get all date directories
  const dateDirs = fs.readdirSync(adaptersRoot).filter((name) => {
    const stat = fs.statSync(path.join(adaptersRoot, name));
    return stat.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(name);
  });

  let totalSpaceSaved = 0;
  let filesDeleted = 0;

  for (const dateDir of dateDirs) {
    const datePath = path.join(adaptersRoot, dateDir);
    const runDirs = fs.readdirSync(datePath).filter((name) => {
      const stat = fs.statSync(path.join(datePath, name));
      return stat.isDirectory() && /^\d{4}-\d{2}-\d{2}-\d{6}-[a-f0-9]{6}$/.test(name);
    });

    if (runDirs.length === 0) continue;

    // Get info for all runs
    const runs = runDirs.map((runLabel) => getRunInfo(username, dateDir, runLabel));

    // Sort by timestamp (newest first)
    runs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Mark the latest run with a GGUF
    const latestWithGGUF = runs.find((r) => r.hasGGUF);
    if (latestWithGGUF) {
      latestWithGGUF.isLatest = true;
    }

    console.log(`\n📅 ${dateDir} (${runs.length} runs)`);

    for (const run of runs) {
      if (run.isLatest) {
        console.log(`  ✅ ${run.runLabel} - KEEP (latest successful)`);
        console.log(`     GGUF: ${formatSize(run.ggufSize)} | Safetensors: ${formatSize(run.safetensorsSize)}`);
      } else if (!run.hasGGUF && !run.hasSafetensors) {
        console.log(`  ❌ ${run.runLabel} - DELETE (failed run, no output)`);
        if (!dryRun) {
          fs.rmSync(run.runPath, { recursive: true, force: true });
          filesDeleted++;
        }
      } else if (run.hasGGUF) {
        console.log(`  🗜️  ${run.runLabel} - ARCHIVE (delete GGUF, keep safetensors)`);
        console.log(`     Will save: ${formatSize(run.ggufSize)}`);
        if (!dryRun) {
          fs.rmSync(run.ggufPath);
          totalSpaceSaved += run.ggufSize;
          filesDeleted++;
        } else {
          totalSpaceSaved += run.ggufSize;
        }
      } else {
        console.log(`  📦 ${run.runLabel} - KEEP (already archived, safetensors only)`);
        console.log(`     Safetensors: ${formatSize(run.safetensorsSize)}`);
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total space ${dryRun ? 'that would be' : ''} saved: ${formatSize(totalSpaceSaved)}`);
  console.log(`Files ${dryRun ? 'that would be' : ''} deleted: ${filesDeleted}`);

  if (dryRun) {
    console.log(`\n⚠️  This was a DRY RUN - no files were actually deleted.`);
    console.log(`Run without --dry-run to perform cleanup.`);
  } else {
    console.log(`\n✅ Cleanup complete!`);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
