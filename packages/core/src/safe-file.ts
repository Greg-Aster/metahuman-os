/**
 * Safe File Operations
 *
 * Provides atomic file writes with automatic backups to prevent data loss.
 * - Creates timestamped backups before writing
 * - Validates JSON before writing
 * - Can recover from corrupted files
 */

import fs from 'node:fs';
import path from 'node:path';

const LOG_PREFIX = '[safe-file]';
const MAX_BACKUPS = 5;

/**
 * Get the backup directory for a file
 */
function getBackupDir(filePath: string): string {
  const dir = path.dirname(filePath);
  return path.join(dir, '.backups');
}

/**
 * Get backup filename with timestamp
 */
function getBackupName(filePath: string): string {
  const basename = path.basename(filePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${basename}.${timestamp}.bak`;
}

/**
 * Create a backup of a file before modifying it
 */
export function backupFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    // Don't backup empty/corrupted files
    return null;
  }

  try {
    const backupDir = getBackupDir(filePath);
    fs.mkdirSync(backupDir, { recursive: true });

    const backupPath = path.join(backupDir, getBackupName(filePath));
    fs.copyFileSync(filePath, backupPath);

    // Clean up old backups (keep only MAX_BACKUPS)
    cleanupOldBackups(filePath);

    console.log(`${LOG_PREFIX} Backed up ${path.basename(filePath)} to ${backupPath}`);
    return backupPath;
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to backup ${filePath}:`, error);
    return null;
  }
}

/**
 * Clean up old backups, keeping only the most recent MAX_BACKUPS
 */
function cleanupOldBackups(filePath: string): void {
  const backupDir = getBackupDir(filePath);
  const basename = path.basename(filePath);

  if (!fs.existsSync(backupDir)) return;

  const backups = fs.readdirSync(backupDir)
    .filter(f => f.startsWith(basename) && f.endsWith('.bak'))
    .map(f => ({
      name: f,
      path: path.join(backupDir, f),
      mtime: fs.statSync(path.join(backupDir, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.mtime - a.mtime);

  // Remove old backups
  for (let i = MAX_BACKUPS; i < backups.length; i++) {
    try {
      fs.unlinkSync(backups[i].path);
    } catch {}
  }
}

/**
 * Get list of available backups for a file
 */
export function listBackups(filePath: string): Array<{ path: string; timestamp: Date; size: number }> {
  const backupDir = getBackupDir(filePath);
  const basename = path.basename(filePath);

  if (!fs.existsSync(backupDir)) return [];

  return fs.readdirSync(backupDir)
    .filter(f => f.startsWith(basename) && f.endsWith('.bak'))
    .map(f => {
      const fullPath = path.join(backupDir, f);
      const stats = fs.statSync(fullPath);
      return {
        path: fullPath,
        timestamp: stats.mtime,
        size: stats.size,
      };
    })
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

/**
 * Restore a file from its most recent backup
 */
export function restoreFromBackup(filePath: string): boolean {
  const backups = listBackups(filePath);

  if (backups.length === 0) {
    console.error(`${LOG_PREFIX} No backups found for ${filePath}`);
    return false;
  }

  // Find the first non-empty backup
  for (const backup of backups) {
    if (backup.size > 0) {
      try {
        fs.copyFileSync(backup.path, filePath);
        console.log(`${LOG_PREFIX} Restored ${filePath} from ${backup.path}`);
        return true;
      } catch (error) {
        console.error(`${LOG_PREFIX} Failed to restore from ${backup.path}:`, error);
      }
    }
  }

  console.error(`${LOG_PREFIX} All backups are empty/corrupted`);
  return false;
}

/**
 * Safely write JSON to a file with backup
 */
export function safeWriteJSON(filePath: string, data: unknown): void {
  // Validate the data is serializable
  let jsonString: string;
  try {
    jsonString = JSON.stringify(data, null, 2);
  } catch (error) {
    throw new Error(`Failed to serialize data: ${(error as Error).message}`);
  }

  // Backup existing file
  backupFile(filePath);

  // Ensure directory exists
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  // Write to temp file first (atomic write)
  const tempPath = `${filePath}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tempPath, jsonString, 'utf-8');

    // Verify the temp file is valid
    const written = fs.readFileSync(tempPath, 'utf-8');
    JSON.parse(written); // Validate JSON

    // Rename temp to final (atomic on most filesystems)
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    // Clean up temp file
    try { fs.unlinkSync(tempPath); } catch {}
    throw error;
  }
}

/**
 * Safely read JSON from a file, recovering from backup if corrupted
 */
export function safeReadJSON<T>(filePath: string, defaultValue?: T): T {
  // Check if file exists
  if (!fs.existsSync(filePath)) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`File not found: ${filePath}`);
  }

  // Check if file is empty
  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    console.warn(`${LOG_PREFIX} File is empty/corrupted: ${filePath}`);

    // Try to restore from backup
    if (restoreFromBackup(filePath)) {
      return safeReadJSON(filePath, defaultValue);
    }

    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`File is corrupted and no backup available: ${filePath}`);
  }

  // Try to read and parse
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (error) {
    console.warn(`${LOG_PREFIX} Failed to parse ${filePath}:`, error);

    // Try to restore from backup
    if (restoreFromBackup(filePath)) {
      return safeReadJSON(filePath, defaultValue);
    }

    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw error;
  }
}

/**
 * Check if a JSON file is valid (exists and parseable)
 */
export function isValidJSON(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;

  try {
    const stats = fs.statSync(filePath);
    if (stats.size === 0) return false;

    const content = fs.readFileSync(filePath, 'utf-8');
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scan a directory for corrupted JSON files and attempt recovery
 */
export function recoverCorruptedFiles(directory: string): { recovered: string[]; failed: string[] } {
  const recovered: string[] = [];
  const failed: string[] = [];

  if (!fs.existsSync(directory)) {
    return { recovered, failed };
  }

  const scanDir = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== '.backups' && entry.name !== 'node_modules') {
          scanDir(fullPath);
        }
      } else if (entry.name.endsWith('.json')) {
        if (!isValidJSON(fullPath)) {
          console.log(`${LOG_PREFIX} Found corrupted file: ${fullPath}`);
          if (restoreFromBackup(fullPath)) {
            recovered.push(fullPath);
          } else {
            failed.push(fullPath);
          }
        }
      }
    }
  };

  scanDir(directory);
  return { recovered, failed };
}
