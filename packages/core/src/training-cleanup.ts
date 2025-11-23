/**
 * Shared cleanup utilities for training workflows
 * Automatically cleans up old training runs to prevent storage bloat
 */

import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from './paths.js';
import { audit } from './audit.js';

interface RunInfo {
  runLabel: string;
  runPath: string;
  ggufPath: string;
  safetensorsPath: string;
  hasGGUF: boolean;
  hasSafetensors: boolean;
  ggufSize: number;
  timestamp: Date;
}

function getRunInfo(profileRoot: string, dateDir: string, runLabel: string, isFineTune: boolean): RunInfo {
  const baseDir = isFineTune ? 'fine-tuned-models' : 'adapters';
  const runPath = path.join(profileRoot, 'out', baseDir, dateDir, runLabel);

  const ggufPath = isFineTune
    ? path.join(runPath, 'model-Q6_K.gguf')
    : path.join(runPath, 'adapter.gguf');

  const safetensorsPath = isFineTune
    ? path.join(runPath, 'model')
    : path.join(runPath, 'adapter', 'adapter_model.safetensors');

  const hasGGUF = fs.existsSync(ggufPath);
  const hasSafetensors = fs.existsSync(safetensorsPath);

  let ggufSize = 0;
  if (hasGGUF) {
    ggufSize = fs.statSync(ggufPath).size;
  }

  // Extract timestamp from run label (format: YYYY-MM-DD-HHMMSS-xxxxx)
  const match = runLabel.match(/^(\d{4}-\d{2}-\d{2})-(\d{6})/);
  const timestamp = match
    ? new Date(`${match[1]}T${match[2].slice(0, 2)}:${match[2].slice(2, 4)}:${match[2].slice(4, 6)}`)
    : new Date(0);

  return {
    runLabel,
    runPath,
    ggufPath,
    safetensorsPath,
    hasGGUF,
    hasSafetensors,
    ggufSize,
    timestamp,
  };
}

function formatSize(bytes: number): string {
  const gb = bytes / (1024 ** 3);
  const mb = bytes / (1024 ** 2);
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${mb.toFixed(2)} MB`;
}

/**
 * Clean up old training runs automatically
 * Strategy:
 * - Keep current run (just completed)
 * - Keep previous successful run (as backup)
 * - Archive older runs: delete GGUF, keep safetensors
 * - Delete failed runs completely
 */
export async function autoCleanupTrainingRuns(
  username: string,
  currentRunLabel: string,
  isFineTune: boolean = false
): Promise<void> {
  console.log(`\n🧹 Auto-cleanup: Archiving old training runs...`);

  const profileRoot = path.join(systemPaths.root, 'profiles', username);
  const baseDir = isFineTune ? 'fine-tuned-models' : 'adapters';
  const runsRoot = path.join(profileRoot, 'out', baseDir);

  if (!fs.existsSync(runsRoot)) {
    return;
  }

  const dateDirs = fs.readdirSync(runsRoot).filter((name) => {
    const stat = fs.statSync(path.join(runsRoot, name));
    return stat.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(name);
  });

  let totalSpaceSaved = 0;
  let runsArchived = 0;
  let runsDeleted = 0;

  for (const dateDir of dateDirs) {
    const datePath = path.join(runsRoot, dateDir);
    const runDirs = fs.readdirSync(datePath).filter((name) => {
      const stat = fs.statSync(path.join(datePath, name));
      return stat.isDirectory() && /^\d{4}-\d{2}-\d{2}-\d{6}-[a-f0-9]{6}$/.test(name);
    });

    if (runDirs.length === 0) continue;

    // Get info for all runs
    const runs = runDirs.map((runLabel) => getRunInfo(profileRoot, dateDir, runLabel, isFineTune));

    // Sort by timestamp (newest first)
    runs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Find successful runs (have GGUF)
    const successfulRuns = runs.filter((r) => r.hasGGUF);

    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      const isCurrent = run.runLabel === currentRunLabel;
      const isPreviousSuccess = successfulRuns.indexOf(run) === 1; // Second newest successful run

      if (isCurrent) {
        console.log(`  ✅ ${run.runLabel} - KEEP (current run)`);
      } else if (isPreviousSuccess) {
        console.log(`  💾 ${run.runLabel} - KEEP (previous backup)`);
      } else if (!run.hasGGUF && !run.hasSafetensors) {
        // Failed run - delete completely
        console.log(`  ❌ ${run.runLabel} - DELETE (failed run)`);
        try {
          fs.rmSync(run.runPath, { recursive: true, force: true });
          runsDeleted++;
          audit({
            level: 'info',
            category: 'action',
            event: 'training_cleanup_delete',
            details: { runLabel: run.runLabel, reason: 'failed_run' },
            actor: 'auto-cleanup',
          });
        } catch (err) {
          console.warn(`    ⚠️  Failed to delete: ${(err as Error).message}`);
        }
      } else if (run.hasGGUF) {
        // Old successful run - archive (delete GGUF, keep safetensors)
        console.log(`  🗜️  ${run.runLabel} - ARCHIVE (delete GGUF: ${formatSize(run.ggufSize)})`);
        try {
          if (isFineTune) {
            // For fine-tunes, delete the Q6_K GGUF but keep model/ directory
            fs.rmSync(run.ggufPath, { force: true });
          } else {
            // For LoRA adapters, delete the GGUF but keep adapter/ directory
            fs.rmSync(run.ggufPath, { force: true });
          }
          totalSpaceSaved += run.ggufSize;
          runsArchived++;
          audit({
            level: 'info',
            category: 'action',
            event: 'training_cleanup_archive',
            details: { runLabel: run.runLabel, spaceSaved: run.ggufSize },
            actor: 'auto-cleanup',
          });
        } catch (err) {
          console.warn(`    ⚠️  Failed to archive: ${(err as Error).message}`);
        }
      } else {
        // Already archived
        console.log(`  📦 ${run.runLabel} - KEEP (already archived)`);
      }
    }
  }

  if (runsArchived > 0 || runsDeleted > 0) {
    console.log(`\n✅ Cleanup complete:`);
    console.log(`   Archived: ${runsArchived} runs (saved ${formatSize(totalSpaceSaved)})`);
    console.log(`   Deleted: ${runsDeleted} failed runs`);
  } else {
    console.log(`   Nothing to clean up`);
  }
}

/**
 * Clean up old work directories (temporary training artifacts)
 * Deletes directories older than 7 days
 */
export function cleanupOldWorkDirectories(username: string): void {
  const workRoot = path.join(systemPaths.root, 'metahuman-runs', username);

  if (!fs.existsSync(workRoot)) {
    return;
  }

  console.log(`\n🧹 Cleaning up old work directories...`);

  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const dateDirs = fs.readdirSync(workRoot);

  let deletedDirs = 0;

  for (const dateDir of dateDirs) {
    const dirPath = path.join(workRoot, dateDir);

    try {
      const stats = fs.statSync(dirPath);
      if (stats.isDirectory() && stats.mtimeMs < sevenDaysAgo) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        console.log(`  ❌ Deleted: ${dateDir} (older than 7 days)`);
        deletedDirs++;
      }
    } catch (err) {
      console.warn(`  ⚠️  Failed to check/delete ${dateDir}: ${(err as Error).message}`);
    }
  }

  if (deletedDirs > 0) {
    console.log(`✅ Deleted ${deletedDirs} old work directories`);
  } else {
    console.log(`   No old directories to clean up`);
  }
}
