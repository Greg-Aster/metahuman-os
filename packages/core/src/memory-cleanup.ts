/**
 * Memory Cleanup Utilities
 * Scan for and repair/purge corrupted memory data
 */

import fs from 'node:fs';
import path from 'node:path';
import { isEventCorrupted, repairEvent } from './memory-validation.js';
import type { EpisodicEvent } from './memory.js';

export interface ScanResult {
  totalFiles: number;
  corruptedFiles: number;
  repairedFiles: number;
  unreparableFiles: number;
  corruptedPaths: string[];
  unreparablePaths: string[];
  errors: Array<{ path: string; error: string }>;
}

/**
 * Scan a directory recursively for corrupted memory files
 */
export async function scanForCorrupted(
  dir: string,
  options: { repair?: boolean; remove?: boolean } = {}
): Promise<ScanResult> {
  const result: ScanResult = {
    totalFiles: 0,
    corruptedFiles: 0,
    repairedFiles: 0,
    unreparableFiles: 0,
    corruptedPaths: [],
    unreparablePaths: [],
    errors: [],
  };

  if (!fs.existsSync(dir)) {
    return result;
  }

  await scanDirectory(dir, result, options);

  return result;
}

async function scanDirectory(
  dir: string,
  result: ScanResult,
  options: { repair?: boolean; remove?: boolean }
): Promise<void> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Recurse into subdirectories
      await scanDirectory(fullPath, result, options);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      // Check if this is a memory file
      result.totalFiles++;

      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        let eventData: any;

        try {
          eventData = JSON.parse(content);
        } catch (parseError) {
          // Malformed JSON
          result.corruptedFiles++;
          result.corruptedPaths.push(fullPath);
          result.errors.push({
            path: fullPath,
            error: `Invalid JSON: ${(parseError as Error).message}`,
          });

          if (options.remove) {
            console.log(`[cleanup] Removing malformed JSON file: ${fullPath}`);
            fs.unlinkSync(fullPath);
          }

          continue;
        }

        // Check if event is corrupted
        if (isEventCorrupted(eventData)) {
          result.corruptedFiles++;
          result.corruptedPaths.push(fullPath);

          if (options.repair) {
            // Attempt repair
            const repaired = repairEvent(eventData);
            if (repaired) {
              console.log(`[cleanup] Repairing corrupted event: ${fullPath}`);
              fs.writeFileSync(fullPath, JSON.stringify(repaired, null, 2));
              result.repairedFiles++;
            } else {
              console.log(`[cleanup] Cannot repair event: ${fullPath}`);
              result.unreparableFiles++;
              result.unreparablePaths.push(fullPath);

              if (options.remove) {
                console.log(`[cleanup] Removing unrepairable file: ${fullPath}`);
                fs.unlinkSync(fullPath);
              }
            }
          } else {
            result.unreparableFiles++;
            result.unreparablePaths.push(fullPath);
          }
        }
      } catch (error) {
        result.errors.push({
          path: fullPath,
          error: `Scan error: ${(error as Error).message}`,
        });
      }
    }
  }
}

/**
 * Print a scan result report
 */
export function printScanReport(result: ScanResult): void {
  console.log('\n========== MEMORY SCAN REPORT ==========');
  console.log(`Total files scanned: ${result.totalFiles}`);
  console.log(`Corrupted files found: ${result.corruptedFiles}`);
  console.log(`Files repaired: ${result.repairedFiles}`);
  console.log(`Unrepairable files: ${result.unreparableFiles}`);

  if (result.corruptedPaths.length > 0) {
    console.log('\nCorrupted file paths:');
    for (const p of result.corruptedPaths.slice(0, 10)) {
      console.log(`  - ${p}`);
    }
    if (result.corruptedPaths.length > 10) {
      console.log(`  ... and ${result.corruptedPaths.length - 10} more`);
    }
  }

  if (result.errors.length > 0) {
    console.log('\nErrors encountered:');
    for (const err of result.errors.slice(0, 5)) {
      console.log(`  - ${err.path}: ${err.error}`);
    }
    if (result.errors.length > 5) {
      console.log(`  ... and ${result.errors.length - 5} more`);
    }
  }

  console.log('========================================\n');
}

/**
 * Remove all corrupted events from a directory
 */
export async function purgeCorrupted(dir: string): Promise<number> {
  const result = await scanForCorrupted(dir, { remove: true });
  return result.unreparableFiles;
}

/**
 * Repair all repairable events in a directory
 */
export async function repairAll(dir: string): Promise<{ repaired: number; failed: number }> {
  const result = await scanForCorrupted(dir, { repair: true });
  return {
    repaired: result.repairedFiles,
    failed: result.unreparableFiles,
  };
}
