/**
 * Housekeeping Skill
 *
 * Cleans up logs, temp files, stale locks, and caches.
 * Part of Phase 5: System Operator
 */

import * as fs from 'fs';
import * as path from 'path';
import { systemPaths } from '../paths.js';
import { audit } from '../audit.js';
import type { HousekeepingResult } from './types.js';

export interface HousekeepingOptions {
  maxLogAgeDays?: number;
  maxTempAgeDays?: number;
  cleanLogs?: boolean;
  cleanTemp?: boolean;
  cleanCache?: boolean;
  cleanStaleLocks?: boolean;
  dryRun?: boolean;
}

interface FileStats {
  path: string;
  size: number;
  ageInDays: number;
}

/**
 * Get age of a file in days.
 */
function getFileAgeDays(filepath: string): number {
  try {
    const stats = fs.statSync(filepath);
    const now = Date.now();
    const mtime = stats.mtime.getTime();
    return (now - mtime) / (1000 * 60 * 60 * 24);
  } catch {
    return 0;
  }
}

/**
 * Get size of a file.
 */
function getFileSize(filepath: string): number {
  try {
    return fs.statSync(filepath).size;
  } catch {
    return 0;
  }
}

/**
 * Recursively get files older than N days.
 */
function getOldFiles(dir: string, maxAgeDays: number): FileStats[] {
  const oldFiles: FileStats[] = [];

  if (!fs.existsSync(dir)) return oldFiles;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      oldFiles.push(...getOldFiles(fullPath, maxAgeDays));
    } else if (entry.isFile()) {
      const ageInDays = getFileAgeDays(fullPath);
      if (ageInDays > maxAgeDays) {
        oldFiles.push({
          path: fullPath,
          size: getFileSize(fullPath),
          ageInDays,
        });
      }
    }
  }

  return oldFiles;
}

/**
 * Clean up old log files.
 */
function cleanLogs(maxAgeDays: number, dryRun: boolean): { removed: number; spaceReclaimed: number } {
  const logDir = systemPaths.logs;
  let removed = 0;
  let spaceReclaimed = 0;

  if (!fs.existsSync(logDir)) {
    return { removed: 0, spaceReclaimed: 0 };
  }

  // Clean audit logs
  const auditDir = path.join(logDir, 'audit');
  if (fs.existsSync(auditDir)) {
    const oldAuditFiles = getOldFiles(auditDir, maxAgeDays);
    for (const file of oldAuditFiles) {
      if (!dryRun) {
        try {
          fs.unlinkSync(file.path);
          removed++;
          spaceReclaimed += file.size;
        } catch {
          // Skip errors
        }
      } else {
        removed++;
        spaceReclaimed += file.size;
      }
    }
  }

  // Clean run logs
  const runDir = path.join(logDir, 'run');
  if (fs.existsSync(runDir)) {
    // Clean agent logs
    const agentLogsDir = path.join(runDir, 'agents');
    if (fs.existsSync(agentLogsDir)) {
      const oldAgentFiles = getOldFiles(agentLogsDir, maxAgeDays);
      for (const file of oldAgentFiles) {
        if (!dryRun) {
          try {
            fs.unlinkSync(file.path);
            removed++;
            spaceReclaimed += file.size;
          } catch {
            // Skip errors
          }
        } else {
          removed++;
          spaceReclaimed += file.size;
        }
      }
    }
  }

  return { removed, spaceReclaimed };
}

/**
 * Clean up stale lock files.
 */
function cleanStaleLocks(dryRun: boolean): number {
  const locksDir = path.join(systemPaths.logs, 'run', 'locks');
  let removed = 0;

  if (!fs.existsSync(locksDir)) return 0;

  const entries = fs.readdirSync(locksDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.lock')) continue;

    const lockPath = path.join(locksDir, entry.name);

    try {
      const content = fs.readFileSync(lockPath, 'utf8');
      const lockData = JSON.parse(content);
      const pid = lockData.pid;

      // Check if process is still running
      let isRunning = false;
      try {
        // Sending signal 0 checks if process exists without killing it
        process.kill(pid, 0);
        isRunning = true;
      } catch {
        isRunning = false;
      }

      if (!isRunning) {
        if (!dryRun) {
          fs.unlinkSync(lockPath);
        }
        removed++;
      }
    } catch {
      // If lock file is malformed, remove it
      if (!dryRun) {
        try {
          fs.unlinkSync(lockPath);
          removed++;
        } catch {
          // Skip errors
        }
      } else {
        removed++;
      }
    }
  }

  return removed;
}

/**
 * Clean up temporary files.
 */
function cleanTempFiles(maxAgeDays: number, dryRun: boolean): { removed: number; spaceReclaimed: number } {
  let removed = 0;
  let spaceReclaimed = 0;

  // Check for temp directories in various locations
  const tempDirs = [
    path.join(systemPaths.root, 'tmp'),
    path.join(systemPaths.root, '.tmp'),
    path.join(systemPaths.root, 'temp'),
  ];

  for (const tempDir of tempDirs) {
    if (!fs.existsSync(tempDir)) continue;

    const oldFiles = getOldFiles(tempDir, maxAgeDays);
    for (const file of oldFiles) {
      if (!dryRun) {
        try {
          fs.unlinkSync(file.path);
          removed++;
          spaceReclaimed += file.size;
        } catch {
          // Skip errors
        }
      } else {
        removed++;
        spaceReclaimed += file.size;
      }
    }
  }

  return { removed, spaceReclaimed };
}

/**
 * Clean up cache files.
 */
function cleanCacheFiles(dryRun: boolean): { removed: number; spaceReclaimed: number } {
  let removed = 0;
  let spaceReclaimed = 0;

  // Check for cache directories
  const cacheDirs = [
    path.join(systemPaths.root, '.cache'),
    path.join(systemPaths.root, 'cache'),
  ];

  for (const cacheDir of cacheDirs) {
    if (!fs.existsSync(cacheDir)) continue;

    // Only clear files, keep directory structure
    const files = getOldFiles(cacheDir, 0); // All files
    for (const file of files) {
      if (!dryRun) {
        try {
          fs.unlinkSync(file.path);
          removed++;
          spaceReclaimed += file.size;
        } catch {
          // Skip errors
        }
      } else {
        removed++;
        spaceReclaimed += file.size;
      }
    }
  }

  return { removed, spaceReclaimed };
}

/**
 * Run housekeeping operations.
 */
export async function runHousekeeping(options: HousekeepingOptions = {}): Promise<HousekeepingResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];

  const {
    maxLogAgeDays = 30,
    maxTempAgeDays = 7,
    cleanLogs: shouldCleanLogs = true,
    cleanTemp = true,
    cleanCache = true,
    cleanStaleLocks: shouldCleanLocks = true,
    dryRun = false,
  } = options;

  let logsRotated = 0;
  let tempFilesRemoved = 0;
  let cacheCleared = 0;
  let spaceReclaimed = 0;
  let staleLocksRemoved = 0;

  // Clean logs
  if (shouldCleanLogs) {
    try {
      const result = cleanLogs(maxLogAgeDays, dryRun);
      logsRotated = result.removed;
      spaceReclaimed += result.spaceReclaimed;
    } catch (error) {
      errors.push(`Log cleanup failed: ${(error as Error).message}`);
    }
  }

  // Clean temp files
  if (cleanTemp) {
    try {
      const result = cleanTempFiles(maxTempAgeDays, dryRun);
      tempFilesRemoved = result.removed;
      spaceReclaimed += result.spaceReclaimed;
    } catch (error) {
      errors.push(`Temp cleanup failed: ${(error as Error).message}`);
    }
  }

  // Clean cache
  if (cleanCache) {
    try {
      const result = cleanCacheFiles(dryRun);
      cacheCleared = result.removed;
      spaceReclaimed += result.spaceReclaimed;
    } catch (error) {
      errors.push(`Cache cleanup failed: ${(error as Error).message}`);
    }
  }

  // Clean stale locks
  if (shouldCleanLocks) {
    try {
      staleLocksRemoved = cleanStaleLocks(dryRun);
    } catch (error) {
      errors.push(`Lock cleanup failed: ${(error as Error).message}`);
    }
  }

  if (!dryRun) {
    audit({
      category: 'action',
      level: 'info',
      event: 'housekeeping_completed',
      actor: 'system-operator',
      details: {
        logsRotated,
        tempFilesRemoved,
        cacheCleared,
        staleLocksRemoved,
        spaceReclaimed,
      },
    });
  }

  return {
    success: errors.length === 0,
    operation: 'housekeeping',
    startedAt: new Date(startTime).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    details: {
      logsRotated,
      tempFilesRemoved,
      cacheCleared,
      spaceReclaimed,
      staleLocksRemoved,
    },
    errors,
    warnings,
  };
}

/**
 * Get current system disk usage stats.
 */
export function getDiskUsage(): {
  logs: number;
  temp: number;
  cache: number;
  total: number;
} {
  let logs = 0;
  let temp = 0;
  let cache = 0;

  // Calculate log size
  if (fs.existsSync(systemPaths.logs)) {
    const logFiles = getOldFiles(systemPaths.logs, 0);
    logs = logFiles.reduce((sum, f) => sum + f.size, 0);
  }

  // Calculate temp size
  const tempDirs = [
    path.join(systemPaths.root, 'tmp'),
    path.join(systemPaths.root, '.tmp'),
    path.join(systemPaths.root, 'temp'),
  ];
  for (const dir of tempDirs) {
    if (fs.existsSync(dir)) {
      const files = getOldFiles(dir, 0);
      temp += files.reduce((sum, f) => sum + f.size, 0);
    }
  }

  // Calculate cache size
  const cacheDirs = [
    path.join(systemPaths.root, '.cache'),
    path.join(systemPaths.root, 'cache'),
  ];
  for (const dir of cacheDirs) {
    if (fs.existsSync(dir)) {
      const files = getOldFiles(dir, 0);
      cache += files.reduce((sum, f) => sum + f.size, 0);
    }
  }

  return {
    logs,
    temp,
    cache,
    total: logs + temp + cache,
  };
}
