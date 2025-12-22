/**
 * Backup Skill
 *
 * Creates backups of profile data (persona, memories, tasks, config).
 * Part of Phase 5: System Operator
 */

import * as fs from 'fs';
import * as path from 'path';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createWriteStream, createReadStream } from 'fs';
import { getProfilePaths, systemPaths } from '../paths.js';
import { storageClient } from '../storage-router.js';
import { audit } from '../audit.js';
import type { BackupResult } from './types.js';

export interface BackupOptions {
  username: string;
  compress?: boolean;
  includeMemories?: boolean;
  includePersona?: boolean;
  includeTasks?: boolean;
  includeConfig?: boolean;
  includeState?: boolean;
  outputDir?: string;
}

interface BackupManifest {
  version: 1;
  createdAt: string;
  username: string;
  profile: string;
  compressed: boolean;
  files: Array<{
    relativePath: string;
    size: number;
    checksum?: string;
  }>;
  totalSize: number;
  totalFiles: number;
}

/**
 * Get the default backup directory.
 */
function getBackupDir(): string {
  return path.join(systemPaths.root, 'backups');
}

/**
 * Ensure backup directory exists.
 */
function ensureBackupDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Generate a backup filename.
 */
function generateBackupName(username: string, compress: boolean): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = compress ? 'tar.gz' : 'tar';
  return `backup-${username}-${timestamp}.${ext}`;
}

/**
 * Recursively get all files in a directory.
 */
function getFilesRecursively(dir: string, baseDir: string = dir): Array<{ path: string; relativePath: string; size: number }> {
  const files: Array<{ path: string; relativePath: string; size: number }> = [];

  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      files.push(...getFilesRecursively(fullPath, baseDir));
    } else if (entry.isFile()) {
      const stats = fs.statSync(fullPath);
      files.push({
        path: fullPath,
        relativePath,
        size: stats.size,
      });
    }
  }

  return files;
}

/**
 * Copy files to backup directory (uncompressed backup).
 */
function copyFilesToBackup(
  files: Array<{ path: string; relativePath: string }>,
  destDir: string,
  sourceBaseDir: string
): number {
  let copiedCount = 0;

  for (const file of files) {
    const destPath = path.join(destDir, file.relativePath);
    const destDirPath = path.dirname(destPath);

    fs.mkdirSync(destDirPath, { recursive: true });
    fs.copyFileSync(file.path, destPath);
    copiedCount++;
  }

  return copiedCount;
}

/**
 * Create a backup of a user's profile.
 */
export async function createBackup(options: BackupOptions): Promise<BackupResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  const warnings: string[] = [];

  const {
    username,
    compress = true,
    includeMemories = true,
    includePersona = true,
    includeTasks = true,
    includeConfig = true,
    includeState = true,
    outputDir,
  } = options;

  const profilePaths = getProfilePaths(username);
  const backupDir = outputDir || getBackupDir();
  ensureBackupDir(backupDir);

  const backupName = generateBackupName(username, compress);
  const backupPath = path.join(backupDir, compress ? backupName.replace('.tar.gz', '') : backupName);

  // Collect files to backup
  const allFiles: Array<{ path: string; relativePath: string; size: number }> = [];

  if (includePersona && fs.existsSync(profilePaths.persona)) {
    const personaFiles = getFilesRecursively(profilePaths.persona, profilePaths.root);
    allFiles.push(...personaFiles.map(f => ({
      ...f,
      relativePath: path.join('persona', f.relativePath),
    })));
  }

  if (includeMemories && fs.existsSync(profilePaths.episodic)) {
    const memoryFiles = getFilesRecursively(profilePaths.episodic, profilePaths.root);
    allFiles.push(...memoryFiles.map(f => ({
      ...f,
      relativePath: path.join('memory', 'episodic', f.relativePath),
    })));
  }

  if (includeTasks && fs.existsSync(profilePaths.tasks)) {
    const taskFiles = getFilesRecursively(profilePaths.tasks, profilePaths.root);
    allFiles.push(...taskFiles.map(f => ({
      ...f,
      relativePath: path.join('memory', 'tasks', f.relativePath),
    })));
  }

  if (includeConfig && fs.existsSync(profilePaths.etc)) {
    const configFiles = getFilesRecursively(profilePaths.etc, profilePaths.root);
    allFiles.push(...configFiles.map(f => ({
      ...f,
      relativePath: path.join('etc', f.relativePath),
    })));
  }

  if (includeState && fs.existsSync(profilePaths.state)) {
    const stateFiles = getFilesRecursively(profilePaths.state, profilePaths.root);
    allFiles.push(...stateFiles.map(f => ({
      ...f,
      relativePath: path.join('state', f.relativePath),
    })));
  }

  if (allFiles.length === 0) {
    errors.push('No files found to backup');
    return {
      success: false,
      operation: 'backup',
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      details: {
        backupPath: '',
        filesBackedUp: 0,
        totalSize: 0,
        profile: username,
      },
      errors,
      warnings,
    };
  }

  // Create backup directory
  fs.mkdirSync(backupPath, { recursive: true });

  // Copy files
  let filesBackedUp = 0;
  let totalSize = 0;

  for (const file of allFiles) {
    try {
      const destPath = path.join(backupPath, file.relativePath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(file.path, destPath);
      filesBackedUp++;
      totalSize += file.size;
    } catch (error) {
      warnings.push(`Failed to backup ${file.relativePath}: ${(error as Error).message}`);
    }
  }

  // Create manifest
  const manifest: BackupManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    username,
    profile: profilePaths.root,
    compressed: compress,
    files: allFiles.map(f => ({
      relativePath: f.relativePath,
      size: f.size,
    })),
    totalSize,
    totalFiles: filesBackedUp,
  };

  fs.writeFileSync(
    path.join(backupPath, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  // Compress if requested (simple directory for now, could add tar.gz)
  let finalBackupPath = backupPath;
  if (compress) {
    // For now, keep as directory - could add archiving later
    finalBackupPath = backupPath;
  }

  audit({
    category: 'action',
    level: 'info',
    event: 'backup_created',
    actor: 'system-operator',
    details: {
      username,
      backupPath: finalBackupPath,
      filesBackedUp,
      totalSize,
    },
  });

  return {
    success: errors.length === 0,
    operation: 'backup',
    startedAt: new Date(startTime).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    details: {
      backupPath: finalBackupPath,
      filesBackedUp,
      totalSize,
      profile: username,
    },
    errors,
    warnings,
  };
}

/**
 * List available backups for a user.
 */
export function listBackups(username?: string): Array<{
  name: string;
  path: string;
  createdAt: string;
  size: number;
  username: string;
}> {
  const backupDir = getBackupDir();
  if (!fs.existsSync(backupDir)) return [];

  const backups: Array<{
    name: string;
    path: string;
    createdAt: string;
    size: number;
    username: string;
  }> = [];

  const entries = fs.readdirSync(backupDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('backup-')) continue;

    const backupPath = path.join(backupDir, entry.name);
    const manifestPath = path.join(backupPath, 'manifest.json');

    if (!fs.existsSync(manifestPath)) continue;

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;

      if (username && manifest.username !== username) continue;

      backups.push({
        name: entry.name,
        path: backupPath,
        createdAt: manifest.createdAt,
        size: manifest.totalSize,
        username: manifest.username,
      });
    } catch {
      // Skip invalid backups
    }
  }

  // Sort by date, newest first
  backups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return backups;
}

/**
 * Delete old backups, keeping the most recent N.
 */
export function pruneBackups(username: string, keepCount: number): number {
  const backups = listBackups(username);
  let deleted = 0;

  for (const backup of backups.slice(keepCount)) {
    try {
      fs.rmSync(backup.path, { recursive: true, force: true });
      deleted++;

      audit({
        category: 'action',
        level: 'info',
        event: 'backup_pruned',
        actor: 'system-operator',
        details: {
          username,
          backupName: backup.name,
          createdAt: backup.createdAt,
        },
      });
    } catch (error) {
      console.warn(`Failed to delete backup ${backup.name}:`, (error as Error).message);
    }
  }

  return deleted;
}

/**
 * Restore a backup (dry run by default).
 */
export function restoreBackup(
  backupPath: string,
  targetUsername: string,
  dryRun = true
): { success: boolean; filesRestored: number; errors: string[] } {
  const manifestPath = path.join(backupPath, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    return { success: false, filesRestored: 0, errors: ['Manifest not found'] };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;
  const profilePaths = getProfilePaths(targetUsername);
  const errors: string[] = [];
  let filesRestored = 0;

  for (const file of manifest.files) {
    const sourcePath = path.join(backupPath, file.relativePath);
    const destPath = path.join(profilePaths.root, file.relativePath);

    if (!fs.existsSync(sourcePath)) {
      errors.push(`Source file not found: ${file.relativePath}`);
      continue;
    }

    if (!dryRun) {
      try {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(sourcePath, destPath);
        filesRestored++;
      } catch (error) {
        errors.push(`Failed to restore ${file.relativePath}: ${(error as Error).message}`);
      }
    } else {
      filesRestored++;
    }
  }

  if (!dryRun) {
    audit({
      category: 'action',
      level: 'info',
      event: 'backup_restored',
      actor: 'system-operator',
      details: {
        username: targetUsername,
        backupPath,
        filesRestored,
        errors: errors.length,
      },
    });
  }

  return {
    success: errors.length === 0,
    filesRestored,
    errors,
  };
}
