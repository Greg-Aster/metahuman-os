/**
 * Profile Sync Handlers
 *
 * Handles full profile export/import for mobile sync.
 * Exports persona, configs, and memories (excluding out/ and audio files).
 */

import fs from 'fs';
import path from 'path';
import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { getProfilePaths } from '../../path-builder.js';

/**
 * File entry in the profile bundle
 */
interface ProfileFile {
  /** Relative path from profile root */
  path: string;
  /** File content (text) or base64 (binary) */
  content: string;
  /** Whether content is base64 encoded */
  isBase64?: boolean;
}

/**
 * Profile export bundle
 */
interface ProfileBundle {
  version: string;
  exportedAt: string;
  username: string;
  files: ProfileFile[];
  stats: {
    totalFiles: number;
    totalSize: number;
    excludedFiles: number;
  };
}

/**
 * Patterns to exclude from full export
 */
const EXCLUDE_PATTERNS = [
  /^out\//,                    // Generated outputs (adapters, etc.)
  /\.mp3$/i,                   // Audio files
  /\.wav$/i,
  /\.ogg$/i,
  /\.m4a$/i,
  /\.flac$/i,
  /\.aac$/i,
  /^memory\/inbox\//,          // Raw inbox files (potentially large)
  /^memory\/index\//,          // Vector index (regeneratable)
  /^state\/.*\.lock$/,         // Lock files
  /\.tmp$/,                    // Temp files
];

/**
 * Priority files for initial mobile sync (essential profile data only)
 */
const PRIORITY_PATTERNS = [
  /^persona\//,                // All persona files (core, relationships, etc.)
  /^etc\//,                    // All configuration files
  /^state\/conversation-buffer.*\.json$/,  // Recent conversation state
];

/**
 * Patterns to exclude from initial priority sync (defer to later chunks)
 */
const INITIAL_EXCLUDE_PATTERNS = [
  ...EXCLUDE_PATTERNS,
  /^memory\/episodic\//,       // Defer episodic memories to chunked sync
  /^memory\/tasks\//,          // Defer task history to chunked sync
  /^training-data\//,          // Defer training data (very large)
  /^logs\//,                   // Defer historical logs
];

/**
 * Max file size to include (10MB)
 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Check if a file should be excluded from full export
 */
function shouldExclude(relativePath: string): boolean {
  return EXCLUDE_PATTERNS.some(pattern => pattern.test(relativePath));
}

/**
 * Check if a file should be included in priority sync (essential files only)
 */
function shouldIncludeInPrioritySync(relativePath: string): boolean {
  // Must match priority patterns AND not be excluded
  const matchesPriority = PRIORITY_PATTERNS.some(pattern => pattern.test(relativePath));
  const isExcluded = INITIAL_EXCLUDE_PATTERNS.some(pattern => pattern.test(relativePath));
  return matchesPriority && !isExcluded;
}

/**
 * Recursively collect files from a directory
 */
function collectFiles(
  dir: string,
  baseDir: string,
  files: ProfileFile[],
  stats: { totalSize: number; excludedFiles: number }
): void {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      // Skip excluded directories
      if (shouldExclude(relativePath + '/')) {
        continue;
      }
      collectFiles(fullPath, baseDir, files, stats);
    } else if (entry.isFile()) {
      // Check exclusions
      if (shouldExclude(relativePath)) {
        stats.excludedFiles++;
        continue;
      }

      // Check file size
      const stat = fs.statSync(fullPath);
      if (stat.size > MAX_FILE_SIZE) {
        console.log(`[profile-sync] Skipping large file: ${relativePath} (${stat.size} bytes)`);
        stats.excludedFiles++;
        continue;
      }

      try {
        // Read file content
        const content = fs.readFileSync(fullPath);

        // Check if it's a text file (JSON, etc.)
        const isText = /\.(json|txt|md|yaml|yml|toml|csv)$/i.test(entry.name);

        if (isText) {
          files.push({
            path: relativePath,
            content: content.toString('utf-8'),
          });
        } else {
          // Binary file - base64 encode
          files.push({
            path: relativePath,
            content: content.toString('base64'),
            isBase64: true,
          });
        }

        stats.totalSize += stat.size;
      } catch (err) {
        console.error(`[profile-sync] Error reading file ${relativePath}:`, err);
      }
    }
  }
}

/**
 * Collect priority files only (persona, config, conversation buffer)
 */
function collectPriorityFiles(
  dir: string,
  baseDir: string,
  files: ProfileFile[],
  stats: { totalSize: number; excludedFiles: number }
): void {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      // Skip directories that don't contain priority files
      const hasPriorityFiles = PRIORITY_PATTERNS.some(pattern =>
        pattern.source.startsWith('^' + relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      );

      if (hasPriorityFiles) {
        collectPriorityFiles(fullPath, baseDir, files, stats);
      }
    } else if (entry.isFile()) {
      // Only include files that match priority patterns
      if (!shouldIncludeInPrioritySync(relativePath)) {
        stats.excludedFiles++;
        continue;
      }

      // Check file size
      const stat = fs.statSync(fullPath);
      if (stat.size > MAX_FILE_SIZE) {
        console.log(`[profile-sync] Skipping large priority file: ${relativePath} (${stat.size} bytes)`);
        stats.excludedFiles++;
        continue;
      }

      try {
        // Read file content
        const content = fs.readFileSync(fullPath);
        const isText = /\.(json|txt|md|yaml|yml|toml|csv)$/i.test(entry.name);

        files.push({
          path: relativePath,
          content: isText ? content.toString('utf-8') : content.toString('base64'),
          isBase64: !isText,
        });

        stats.totalSize += stat.size;
      } catch (err) {
        console.error(`[profile-sync] Error reading priority file ${relativePath}:`, err);
      }
    }
  }
}

/**
 * GET /api/profile-sync/export-priority - Export essential profile files for initial sync
 * 
 * Returns a minimal bundle with only persona, config, and conversation buffer.
 * This avoids OOM crashes on mobile by excluding large memory/training data.
 */
export async function handleExportPriorityProfile(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required',
    };
  }

  // DEBUG: Force load users.ts to ensure profile storage config is registered
  try {
    require('../../../users.js');
  } catch {
    console.log('[profile-sync] Users module not found in require, trying import...');
  }

  const profilePaths = getProfilePaths(user.username);
  const profileRoot = profilePaths.root;

  // DEBUG: Log what path we resolved
  console.log(`[profile-sync] Profile path for ${user.username}: ${profileRoot}`);

  if (!fs.existsSync(profileRoot)) {
    return {
      status: 404,
      error: 'Profile not found',
    };
  }

  console.log(`[profile-sync] Exporting priority profile for ${user.username}`);

  const files: ProfileFile[] = [];
  const stats = { totalSize: 0, excludedFiles: 0 };

  // Collect only priority files
  collectPriorityFiles(profileRoot, profileRoot, files, stats);

  const bundle: ProfileBundle = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    username: user.username,
    files,
    stats: {
      totalFiles: files.length,
      totalSize: stats.totalSize,
      excludedFiles: stats.excludedFiles,
    },
  };

  console.log(`[profile-sync] Priority export complete: ${files.length} files, ${stats.totalSize} bytes`);

  return successResponse(bundle);
}

/**
 * GET /api/profile-sync/export - Export full profile for sync
 *
 * Returns a JSON bundle containing all profile files.
 * Excludes: out/, audio files, inbox, vector index.
 */
export async function handleExportProfile(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required',
    };
  }

  const profilePaths = getProfilePaths(user.username);
  const profileRoot = profilePaths.root;

  if (!fs.existsSync(profileRoot)) {
    return {
      status: 404,
      error: 'Profile not found',
    };
  }

  console.log(`[profile-sync] Exporting profile for ${user.username}`);

  const files: ProfileFile[] = [];
  const stats = { totalSize: 0, excludedFiles: 0 };

  // Collect all files from profile directory
  collectFiles(profileRoot, profileRoot, files, stats);

  const bundle: ProfileBundle = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    username: user.username,
    files,
    stats: {
      totalFiles: files.length,
      totalSize: stats.totalSize,
      excludedFiles: stats.excludedFiles,
    },
  };

  console.log(`[profile-sync] Exported ${files.length} files (${Math.round(stats.totalSize / 1024)}KB), excluded ${stats.excludedFiles}`);

  return successResponse(bundle);
}

/**
 * POST /api/profile-sync/import - Import profile bundle
 *
 * Writes files from the bundle to the local profile directory.
 * Used by mobile to receive synced profile data.
 */
export async function handleImportProfile(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, body } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required',
    };
  }

  const bundle = body as ProfileBundle;

  if (!bundle || !bundle.files || !Array.isArray(bundle.files)) {
    return {
      status: 400,
      error: 'Invalid profile bundle',
    };
  }

  const profilePaths = getProfilePaths(user.username);
  const profileRoot = profilePaths.root;

  // Ensure profile directory exists
  if (!fs.existsSync(profileRoot)) {
    fs.mkdirSync(profileRoot, { recursive: true });
  }

  console.log(`[profile-sync] Importing ${bundle.files.length} files for ${user.username}`);

  let imported = 0;
  let errors = 0;

  for (const file of bundle.files) {
    try {
      const fullPath = path.join(profileRoot, file.path);
      const dir = path.dirname(fullPath);

      // Ensure directory exists
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write file
      if (file.isBase64) {
        fs.writeFileSync(fullPath, Buffer.from(file.content, 'base64'));
      } else {
        fs.writeFileSync(fullPath, file.content, 'utf-8');
      }

      imported++;
    } catch (err) {
      console.error(`[profile-sync] Error writing file ${file.path}:`, err);
      errors++;
    }
  }

  console.log(`[profile-sync] Imported ${imported} files, ${errors} errors`);

  return successResponse({
    success: true,
    imported,
    errors,
    username: user.username,
  });
}

/**
 * GET /api/profile-sync/metadata - Get profile metadata for sync
 */
export async function handleGetProfileMetadata(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required',
    };
  }

  const profilePaths = getProfilePaths(user.username);
  
  if (!fs.existsSync(profilePaths.root)) {
    return {
      status: 404,
      error: 'Profile not found',
    };
  }

  // Count persona files
  const personaKeys = ['core', 'relationships', 'routines', 'decision-rules'];
  const availablePersonaKeys = personaKeys.filter(key => {
    const filePath = path.join(profilePaths.persona, `${key}.json`);
    return fs.existsSync(filePath);
  });

  // Count memory files
  let memoryCount = 0;
  const episodicDir = path.join(profilePaths.episodic);
  if (fs.existsSync(episodicDir)) {
    const years = fs.readdirSync(episodicDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    for (const year of years) {
      const yearDir = path.join(episodicDir, year);
      if (fs.existsSync(yearDir)) {
        const files = fs.readdirSync(yearDir)
          .filter(file => file.endsWith('.json'));
        memoryCount += files.length;
      }
    }
  }

  return successResponse({
    username: user.username,
    personaKeys: availablePersonaKeys,
    memoryCount,
    lastModified: new Date().toISOString(),
  });
}

/**
 * GET /api/profile-sync/memories - Get paginated memories for sync
 *
 * Query params:
 *   - offset: Starting index (default 0)
 *   - limit: Max memories per page (default 100)
 *   - days: Only include memories from the last N days (default: all)
 *   - since: Only include memories after this ISO date (alternative to days)
 */
export async function handleGetProfileMemories(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, query } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required',
    };
  }

  const offset = parseInt(query?.offset || '0', 10);
  const limit = parseInt(query?.limit || '100', 10);

  // Date filtering options
  const daysParam = query?.days ? parseInt(query.days, 10) : null;
  const sinceParam = query?.since ? new Date(query.since) : null;

  // Calculate cutoff date
  let cutoffDate: Date | null = null;
  if (daysParam && daysParam > 0) {
    cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysParam);
  } else if (sinceParam && !isNaN(sinceParam.getTime())) {
    cutoffDate = sinceParam;
  }

  const profilePaths = getProfilePaths(user.username);
  const episodicDir = path.join(profilePaths.episodic);

  const memories: any[] = [];

  if (!fs.existsSync(episodicDir)) {
    return successResponse({
      memories: [],
      hasMore: false,
      total: 0,
      filtered: cutoffDate ? true : false,
    });
  }

  // Collect all memory files
  const allFiles: { path: string; mtime: Date }[] = [];

  const years = fs.readdirSync(episodicDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  for (const year of years) {
    const yearDir = path.join(episodicDir, year);
    if (fs.existsSync(yearDir)) {
      const files = fs.readdirSync(yearDir)
        .filter(file => file.endsWith('.json'))
        .map(file => {
          const filePath = path.join(yearDir, file);
          const stat = fs.statSync(filePath);
          return { path: filePath, mtime: stat.mtime };
        });
      allFiles.push(...files);
    }
  }

  // Filter by date if specified
  const filteredFiles = cutoffDate
    ? allFiles.filter(f => f.mtime >= cutoffDate!)
    : allFiles;

  // Sort by modification time (newest first)
  filteredFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  // Apply pagination
  const pageFiles = filteredFiles.slice(offset, offset + limit);

  for (const fileInfo of pageFiles) {
    try {
      const content = fs.readFileSync(fileInfo.path, 'utf-8');
      const memory = JSON.parse(content);
      memories.push(memory);
    } catch (err) {
      console.warn(`[profile-sync] Failed to read memory file ${fileInfo.path}:`, err);
    }
  }

  const hasMore = offset + limit < filteredFiles.length;

  console.log(`[profile-sync] Memories: ${filteredFiles.length} total${cutoffDate ? ` (filtered to last ${daysParam || 'since ' + cutoffDate.toISOString()})` : ''}, returning ${memories.length} at offset ${offset}`);

  return successResponse({
    memories,
    hasMore,
    total: filteredFiles.length,
    totalUnfiltered: allFiles.length,
    offset,
    limit,
    filtered: cutoffDate ? true : false,
    cutoffDate: cutoffDate?.toISOString(),
  });
}

/**
 * GET /api/profile-sync/tasks - Get tasks for sync
 */
export async function handleGetProfileTasks(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required',
    };
  }

  const profilePaths = getProfilePaths(user.username);
  const tasksDir = path.join(profilePaths.tasks, 'active');

  const tasks: any[] = [];

  if (!fs.existsSync(tasksDir)) {
    return successResponse({
      tasks: [],
    });
  }

  const taskFiles = fs.readdirSync(tasksDir)
    .filter(file => file.endsWith('.json'));

  for (const file of taskFiles) {
    try {
      const filePath = path.join(tasksDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const task = JSON.parse(content);
      tasks.push(task);
    } catch (err) {
      console.warn(`[profile-sync] Failed to read task file ${file}:`, err);
    }
  }

  return successResponse({
    tasks,
  });
}

/**
 * GET /api/profile-sync/changes - Get incremental changes since timestamp
 */
export async function handleGetProfileChanges(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { user, query } = req;

  if (!user.isAuthenticated) {
    return {
      status: 401,
      error: 'Authentication required',
    };
  }

  const since = query?.since ? new Date(query.since) : new Date(0);
  const profilePaths = getProfilePaths(user.username);

  const changes: any = {
    memories: [],
    persona: {},
    tasks: [],
  };

  // Check for memory changes
  const episodicDir = path.join(profilePaths.episodic);
  if (fs.existsSync(episodicDir)) {
    const years = fs.readdirSync(episodicDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const year of years) {
      const yearDir = path.join(episodicDir, year);
      if (fs.existsSync(yearDir)) {
        const files = fs.readdirSync(yearDir)
          .filter(file => file.endsWith('.json'));

        for (const file of files) {
          const filePath = path.join(yearDir, file);
          const stat = fs.statSync(filePath);
          
          if (stat.mtime > since) {
            try {
              const content = fs.readFileSync(filePath, 'utf-8');
              const memory = JSON.parse(content);
              changes.memories.push(memory);
            } catch (err) {
              console.warn(`[profile-sync] Failed to read changed memory ${file}:`, err);
            }
          }
        }
      }
    }
  }

  // Check for persona changes
  const personaKeys = ['core', 'relationships', 'routines', 'decision-rules'];
  for (const key of personaKeys) {
    const filePath = path.join(profilePaths.persona, `${key}.json`);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.mtime > since) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          changes.persona[key] = JSON.parse(content);
        } catch (err) {
          console.warn(`[profile-sync] Failed to read changed persona ${key}:`, err);
        }
      }
    }
  }

  // Check for task changes
  const tasksDir = path.join(profilePaths.tasks, 'active');
  if (fs.existsSync(tasksDir)) {
    const taskFiles = fs.readdirSync(tasksDir)
      .filter(file => file.endsWith('.json'));

    for (const file of taskFiles) {
      const filePath = path.join(tasksDir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.mtime > since) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const task = JSON.parse(content);
          changes.tasks.push(task);
        } catch (err) {
          console.warn(`[profile-sync] Failed to read changed task ${file}:`, err);
        }
      }
    }
  }

  return successResponse({
    changes,
    since: since.toISOString(),
    timestamp: new Date().toISOString(),
  });
}
