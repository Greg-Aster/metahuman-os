#!/usr/bin/env tsx
/**
 * Migrate Legacy Desires to Folder-Based Storage
 *
 * This script migrates desires from the old status-based directory structure:
 *   desires/{status}/{id}.json
 *
 * To the new folder-based structure:
 *   desires/folders/{id}/manifest.json
 *
 * It also copies related plans and reviews into the desire folder.
 */

import * as fs from 'fs';
import * as path from 'path';

const PROFILE_PATH = '/media/greggles/STACK/metahuman-profiles/greggles';
const DESIRES_PATH = path.join(PROFILE_PATH, 'persona/desires');

// Legacy status directories to scan
const LEGACY_STATUS_DIRS = [
  'nascent',
  'pending',
  'active',
  'awaiting_approval',
  'completed',
  'rejected',
  'abandoned',
];

interface MigrationResult {
  id: string;
  source: string;
  status: 'migrated' | 'skipped' | 'error';
  reason?: string;
}

async function migrateDesire(desireFile: string, statusDir: string): Promise<MigrationResult> {
  const id = path.basename(desireFile, '.json');
  const sourcePath = path.join(DESIRES_PATH, statusDir, desireFile);
  const folderPath = path.join(DESIRES_PATH, 'folders', id);
  const manifestPath = path.join(folderPath, 'manifest.json');

  // Check if already migrated
  if (fs.existsSync(manifestPath)) {
    return { id, source: statusDir, status: 'skipped', reason: 'Already exists in folder storage' };
  }

  try {
    // Read legacy desire
    const desireData = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));

    // Create folder structure
    const subdirs = ['scratchpad', 'plans', 'reviews', 'executions'];
    fs.mkdirSync(folderPath, { recursive: true });
    for (const subdir of subdirs) {
      const subdirPath = path.join(folderPath, subdir);
      fs.mkdirSync(subdirPath, { recursive: true });
      fs.writeFileSync(path.join(subdirPath, '.gitkeep'), '');
    }

    // Update desire with folder path
    desireData.folderPath = `folders/${id}`;

    // Initialize scratchpad summary if missing
    if (!desireData.scratchpad) {
      desireData.scratchpad = {
        entryCount: 0,
        lastEntryNumber: 0,
      };
    }

    // Initialize metrics if missing
    if (!desireData.metrics) {
      desireData.metrics = {
        cycleCount: 0,
        completionCount: 0,
        currentCycle: 1,
        totalActiveTimeMs: 0,
        totalIdleTimeMs: 0,
        avgCycleTimeMs: 0,
        lastActivityAt: desireData.updatedAt || desireData.createdAt,
        peakStrength: desireData.strength || 0,
        troughStrength: desireData.strength || 1,
        reinforcementCount: 0,
        decayCount: 0,
        netReinforcement: 0,
        planVersionCount: desireData.plan ? 1 : 0,
        planRejectionCount: 0,
        planRevisionCount: 0,
        executionAttemptCount: 0,
        executionSuccessCount: 0,
        executionFailCount: 0,
        avgSuccessScore: 0,
        userInputCount: 0,
        userApprovalCount: 0,
        userRejectionCount: 0,
        userCritiqueCount: 0,
      };
    }

    // Copy plan if exists in legacy plans directory
    const legacyPlanPath = path.join(DESIRES_PATH, 'plans', `plan-${id}.json`);
    if (fs.existsSync(legacyPlanPath)) {
      const planData = JSON.parse(fs.readFileSync(legacyPlanPath, 'utf-8'));
      const version = planData.version || 1;
      fs.writeFileSync(
        path.join(folderPath, 'plans', `v${version}.json`),
        JSON.stringify(planData, null, 2)
      );
      console.log(`  - Copied plan v${version}`);
    }

    // Copy review if exists in legacy reviews directory
    const legacyReviewPath = path.join(DESIRES_PATH, 'reviews', `review-${id}.json`);
    if (fs.existsSync(legacyReviewPath)) {
      const reviewData = JSON.parse(fs.readFileSync(legacyReviewPath, 'utf-8'));
      const reviewId = reviewData.id || `review-${id}`;
      fs.writeFileSync(
        path.join(folderPath, 'reviews', `${reviewId}.json`),
        JSON.stringify(reviewData, null, 2)
      );
      console.log(`  - Copied review ${reviewId}`);
    }

    // Add migration scratchpad entry
    const migrationEntry = {
      timestamp: new Date().toISOString(),
      type: 'system_event',
      description: `Migrated from legacy storage (${statusDir}/${desireFile})`,
      actor: 'migration-script',
      data: {
        legacyPath: sourcePath,
        newPath: manifestPath,
      },
    };

    desireData.scratchpad.entryCount = 1;
    desireData.scratchpad.lastEntryNumber = 1;
    desireData.scratchpad.lastEntryAt = migrationEntry.timestamp;
    desireData.scratchpad.lastEntryType = 'system_event';

    fs.writeFileSync(
      path.join(folderPath, 'scratchpad', '0001-system_event.json'),
      JSON.stringify(migrationEntry, null, 2)
    );

    // Write manifest
    fs.writeFileSync(manifestPath, JSON.stringify(desireData, null, 2));

    return { id, source: statusDir, status: 'migrated' };
  } catch (error) {
    return {
      id,
      source: statusDir,
      status: 'error',
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main() {
  console.log('=== Legacy Desire Migration ===\n');
  console.log(`Profile: ${PROFILE_PATH}`);
  console.log(`Desires path: ${DESIRES_PATH}\n`);

  const results: MigrationResult[] = [];

  // Scan each legacy status directory
  for (const statusDir of LEGACY_STATUS_DIRS) {
    const dirPath = path.join(DESIRES_PATH, statusDir);

    if (!fs.existsSync(dirPath)) {
      console.log(`[${statusDir}] Directory does not exist, skipping`);
      continue;
    }

    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));

    if (files.length === 0) {
      console.log(`[${statusDir}] No desires found`);
      continue;
    }

    console.log(`[${statusDir}] Found ${files.length} desire(s)`);

    for (const file of files) {
      console.log(`  Processing: ${file}`);
      const result = await migrateDesire(file, statusDir);
      results.push(result);

      if (result.status === 'migrated') {
        console.log(`    -> Migrated successfully`);
      } else if (result.status === 'skipped') {
        console.log(`    -> Skipped: ${result.reason}`);
      } else {
        console.log(`    -> ERROR: ${result.reason}`);
      }
    }
  }

  // Summary
  console.log('\n=== Migration Summary ===');
  const migrated = results.filter(r => r.status === 'migrated');
  const skipped = results.filter(r => r.status === 'skipped');
  const errors = results.filter(r => r.status === 'error');

  console.log(`Migrated: ${migrated.length}`);
  console.log(`Skipped:  ${skipped.length}`);
  console.log(`Errors:   ${errors.length}`);

  if (errors.length > 0) {
    console.log('\nErrors:');
    for (const err of errors) {
      console.log(`  - ${err.id}: ${err.reason}`);
    }
  }

  console.log('\n=== Next Steps ===');
  console.log('1. Verify migrated desires appear in the UI');
  console.log('2. Run: rm -rf /media/greggles/STACK/metahuman-profiles/greggles/persona/desires/{nascent,pending,active,awaiting_approval,completed,rejected,abandoned,plans,reviews}');
  console.log('   (This will delete the legacy directories after verification)');
}

main().catch(console.error);
