/**
 * Mobile Filesystem Storage
 *
 * Provides file-based profile storage on mobile devices using Capacitor Filesystem.
 * This mirrors the server's profile directory structure so that:
 * - Mobile profiles are stored as actual files on device
 * - Same structure as server: profiles/<username>/persona/, memory/, etc.
 * - Files visible in device file manager (Android/data/com.metahuman.os/files/)
 *
 * LOCAL-FIRST ARCHITECTURE:
 * - Mobile device is the source of truth for its own data
 * - Files stored locally, synced to server when user chooses
 * - Server is optional sync point, not required for operation
 */

import { isCapacitorNative } from './api-config';

// Types for filesystem operations
interface FileInfo {
  path: string;
  content: string;
  exists: boolean;
}

interface DirectoryInfo {
  path: string;
  files: string[];
  directories: string[];
}

// Base path for profiles on device
const PROFILES_BASE = 'profiles';

// Lazy-loaded Filesystem module
let Filesystem: any = null;
let Directory: any = null;
let Encoding: any = null;

/**
 * Initialize the Filesystem module (lazy load to avoid SSR issues)
 */
async function initFilesystem(): Promise<boolean> {
  if (!isCapacitorNative()) {
    return false;
  }

  if (Filesystem) {
    return true;
  }

  try {
    const module = await import('@capacitor/filesystem');
    Filesystem = module.Filesystem;
    Directory = module.Directory;
    Encoding = module.Encoding;
    return true;
  } catch (e) {
    console.error('[mobile-fs] Failed to load Filesystem module:', e);
    return false;
  }
}

/**
 * Check if mobile filesystem is available
 */
export async function isMobileFilesystemAvailable(): Promise<boolean> {
  return await initFilesystem();
}

/**
 * Get the profile root path for a user
 */
export function getProfilePath(username: string): string {
  return `${PROFILES_BASE}/${username}`;
}

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDirectory(path: string): Promise<boolean> {
  if (!await initFilesystem()) {
    return false;
  }

  try {
    await Filesystem.mkdir({
      path,
      directory: Directory.Data,
      recursive: true,
    });
    return true;
  } catch (e: any) {
    // Directory might already exist
    if (e.message?.includes('Directory exists')) {
      return true;
    }
    console.error(`[mobile-fs] Failed to create directory ${path}:`, e);
    return false;
  }
}

/**
 * Initialize the profile directory structure for a user
 * Creates: persona/, memory/episodic/, memory/tasks/, etc/, state/
 */
export async function initializeProfileStructure(username: string): Promise<boolean> {
  if (!await initFilesystem()) {
    console.log('[mobile-fs] Filesystem not available, skipping profile init');
    return false;
  }

  const profileRoot = getProfilePath(username);

  const directories = [
    profileRoot,
    `${profileRoot}/persona`,
    `${profileRoot}/persona/desires`,
    `${profileRoot}/persona/desires/nascent`,
    `${profileRoot}/persona/desires/pending`,
    `${profileRoot}/persona/desires/active`,
    `${profileRoot}/persona/desires/completed`,
    `${profileRoot}/persona/desires/abandoned`,
    `${profileRoot}/memory`,
    `${profileRoot}/memory/episodic`,
    `${profileRoot}/memory/tasks`,
    `${profileRoot}/memory/tasks/active`,
    `${profileRoot}/memory/tasks/completed`,
    `${profileRoot}/memory/index`,
    `${profileRoot}/etc`,
    `${profileRoot}/state`,
    `${profileRoot}/out`,
  ];

  let success = true;
  for (const dir of directories) {
    if (!await ensureDirectory(dir)) {
      success = false;
    }
  }

  console.log(`[mobile-fs] Profile structure initialized for ${username}: ${success ? 'OK' : 'PARTIAL'}`);
  return success;
}

/**
 * Write a JSON file to the profile directory
 */
export async function writeProfileFile(
  username: string,
  relativePath: string,
  data: any
): Promise<boolean> {
  if (!await initFilesystem()) {
    return false;
  }

  const fullPath = `${getProfilePath(username)}/${relativePath}`;

  // Ensure parent directory exists
  const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
  await ensureDirectory(parentDir);

  try {
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

    await Filesystem.writeFile({
      path: fullPath,
      data: content,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });

    console.log(`[mobile-fs] Wrote file: ${fullPath}`);
    return true;
  } catch (e) {
    console.error(`[mobile-fs] Failed to write ${fullPath}:`, e);
    return false;
  }
}

/**
 * Read a JSON file from the profile directory
 */
export async function readProfileFile<T = any>(
  username: string,
  relativePath: string
): Promise<T | null> {
  if (!await initFilesystem()) {
    return null;
  }

  const fullPath = `${getProfilePath(username)}/${relativePath}`;

  try {
    const result = await Filesystem.readFile({
      path: fullPath,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });

    if (typeof result.data === 'string') {
      try {
        return JSON.parse(result.data) as T;
      } catch {
        return result.data as unknown as T;
      }
    }
    return result.data as T;
  } catch (e: any) {
    // File not found is expected for new users
    if (!e.message?.includes('not exist') && !e.message?.includes('not found')) {
      console.error(`[mobile-fs] Failed to read ${fullPath}:`, e);
    }
    return null;
  }
}

/**
 * Check if a file exists
 */
export async function fileExists(
  username: string,
  relativePath: string
): Promise<boolean> {
  if (!await initFilesystem()) {
    return false;
  }

  const fullPath = `${getProfilePath(username)}/${relativePath}`;

  try {
    await Filesystem.stat({
      path: fullPath,
      directory: Directory.Data,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a file from the profile directory
 */
export async function deleteProfileFile(
  username: string,
  relativePath: string
): Promise<boolean> {
  if (!await initFilesystem()) {
    return false;
  }

  const fullPath = `${getProfilePath(username)}/${relativePath}`;

  try {
    await Filesystem.deleteFile({
      path: fullPath,
      directory: Directory.Data,
    });
    return true;
  } catch (e) {
    console.error(`[mobile-fs] Failed to delete ${fullPath}:`, e);
    return false;
  }
}

/**
 * List files in a directory
 */
export async function listDirectory(
  username: string,
  relativePath: string = ''
): Promise<DirectoryInfo | null> {
  if (!await initFilesystem()) {
    return null;
  }

  const fullPath = relativePath
    ? `${getProfilePath(username)}/${relativePath}`
    : getProfilePath(username);

  try {
    const result = await Filesystem.readdir({
      path: fullPath,
      directory: Directory.Data,
    });

    const files: string[] = [];
    const directories: string[] = [];

    for (const item of result.files) {
      if (item.type === 'directory') {
        directories.push(item.name);
      } else {
        files.push(item.name);
      }
    }

    return { path: fullPath, files, directories };
  } catch (e) {
    console.error(`[mobile-fs] Failed to list ${fullPath}:`, e);
    return null;
  }
}

// ============ Profile-Specific Operations ============

/**
 * Save persona data (core, relationships, routines, etc.)
 */
export async function savePersonaFile(
  username: string,
  key: string,
  data: any
): Promise<boolean> {
  return writeProfileFile(username, `persona/${key}.json`, data);
}

/**
 * Load persona data
 */
export async function loadPersonaFile<T = any>(
  username: string,
  key: string
): Promise<T | null> {
  return readProfileFile<T>(username, `persona/${key}.json`);
}

/**
 * Save a memory file
 * Memories are stored by date: memory/episodic/YYYY/YYYY-MM-DD-{id}.json
 */
export async function saveMemoryFile(
  username: string,
  memory: {
    id: string;
    timestamp: string;
    type: string;
    content: string;
    metadata?: Record<string, any>;
  }
): Promise<boolean> {
  const date = new Date(memory.timestamp);
  const year = date.getFullYear().toString();
  const dateStr = date.toISOString().split('T')[0];
  const filename = `${dateStr}-${memory.id}.json`;
  const path = `memory/episodic/${year}/${filename}`;

  return writeProfileFile(username, path, memory);
}

/**
 * Load all memories from a specific date range
 */
export async function loadMemoriesForYear(
  username: string,
  year: string
): Promise<any[]> {
  const memories: any[] = [];
  const dir = await listDirectory(username, `memory/episodic/${year}`);

  if (!dir) {
    return memories;
  }

  for (const file of dir.files) {
    if (file.endsWith('.json')) {
      const memory = await readProfileFile(username, `memory/episodic/${year}/${file}`);
      if (memory) {
        memories.push(memory);
      }
    }
  }

  return memories;
}

/**
 * Load recent memories (last N days)
 */
export async function loadRecentMemories(
  username: string,
  days: number = 30
): Promise<any[]> {
  const memories: any[] = [];
  const now = new Date();

  // Check current year and previous year if near year boundary
  const currentYear = now.getFullYear().toString();
  const previousYear = (now.getFullYear() - 1).toString();

  // Load from both years
  const currentYearMemories = await loadMemoriesForYear(username, currentYear);
  memories.push(...currentYearMemories);

  // Also check previous year if we're in January
  if (now.getMonth() === 0) {
    const previousYearMemories = await loadMemoriesForYear(username, previousYear);
    memories.push(...previousYearMemories);
  }

  // Filter to recent days and sort by timestamp
  const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  return memories
    .filter(m => new Date(m.timestamp) >= cutoffDate)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/**
 * Save a task file
 */
export async function saveTaskFile(
  username: string,
  task: {
    id: string;
    status: 'pending' | 'active' | 'completed' | 'cancelled';
    [key: string]: any;
  }
): Promise<boolean> {
  const folder = task.status === 'completed' || task.status === 'cancelled'
    ? 'completed'
    : 'active';
  const path = `memory/tasks/${folder}/${task.id}.json`;

  return writeProfileFile(username, path, task);
}

/**
 * Load all active tasks
 */
export async function loadActiveTasks(username: string): Promise<any[]> {
  const tasks: any[] = [];
  const dir = await listDirectory(username, 'memory/tasks/active');

  if (!dir) {
    return tasks;
  }

  for (const file of dir.files) {
    if (file.endsWith('.json')) {
      const task = await readProfileFile(username, `memory/tasks/active/${file}`);
      if (task) {
        tasks.push(task);
      }
    }
  }

  return tasks;
}

/**
 * Save profile configuration (etc/ files)
 */
export async function saveConfigFile(
  username: string,
  filename: string,
  data: any
): Promise<boolean> {
  return writeProfileFile(username, `etc/${filename}`, data);
}

/**
 * Load profile configuration
 */
export async function loadConfigFile<T = any>(
  username: string,
  filename: string
): Promise<T | null> {
  return readProfileFile<T>(username, `etc/${filename}`);
}

/**
 * Save state file (runtime state)
 */
export async function saveStateFile(
  username: string,
  filename: string,
  data: any
): Promise<boolean> {
  return writeProfileFile(username, `state/${filename}`, data);
}

/**
 * Load state file
 */
export async function loadStateFile<T = any>(
  username: string,
  filename: string
): Promise<T | null> {
  return readProfileFile<T>(username, `state/${filename}`);
}

/**
 * Check if a profile exists on device
 */
export async function profileExists(username: string): Promise<boolean> {
  // A profile exists if persona/core.json exists
  return fileExists(username, 'persona/core.json');
}

/**
 * Delete an entire profile from device
 */
export async function deleteProfile(username: string): Promise<boolean> {
  if (!await initFilesystem()) {
    return false;
  }

  try {
    await Filesystem.rmdir({
      path: getProfilePath(username),
      directory: Directory.Data,
      recursive: true,
    });
    console.log(`[mobile-fs] Deleted profile: ${username}`);
    return true;
  } catch (e) {
    console.error(`[mobile-fs] Failed to delete profile ${username}:`, e);
    return false;
  }
}

/**
 * Get profile statistics
 */
export async function getProfileStats(username: string): Promise<{
  exists: boolean;
  personaFiles: number;
  memoryFiles: number;
  taskFiles: number;
} | null> {
  if (!await profileExists(username)) {
    return { exists: false, personaFiles: 0, memoryFiles: 0, taskFiles: 0 };
  }

  const personaDir = await listDirectory(username, 'persona');
  const tasksDir = await listDirectory(username, 'memory/tasks/active');

  // Count memories across all years
  let memoryCount = 0;
  const episodicDir = await listDirectory(username, 'memory/episodic');
  if (episodicDir) {
    for (const yearDir of episodicDir.directories) {
      const yearContents = await listDirectory(username, `memory/episodic/${yearDir}`);
      if (yearContents) {
        memoryCount += yearContents.files.filter(f => f.endsWith('.json')).length;
      }
    }
  }

  return {
    exists: true,
    personaFiles: personaDir?.files.filter(f => f.endsWith('.json')).length || 0,
    memoryFiles: memoryCount,
    taskFiles: tasksDir?.files.filter(f => f.endsWith('.json')).length || 0,
  };
}

/**
 * Export profile to JSON (for backup/transfer)
 */
export async function exportProfileToJson(username: string): Promise<any | null> {
  if (!await profileExists(username)) {
    return null;
  }

  const profile: any = {
    username,
    exportedAt: new Date().toISOString(),
    persona: {},
    memories: [],
    tasks: [],
    config: {},
  };

  // Export persona files
  const personaDir = await listDirectory(username, 'persona');
  if (personaDir) {
    for (const file of personaDir.files) {
      if (file.endsWith('.json')) {
        const key = file.replace('.json', '');
        profile.persona[key] = await loadPersonaFile(username, key);
      }
    }
  }

  // Export recent memories
  profile.memories = await loadRecentMemories(username, 365); // Last year

  // Export active tasks
  profile.tasks = await loadActiveTasks(username);

  // Export config files
  const etcDir = await listDirectory(username, 'etc');
  if (etcDir) {
    for (const file of etcDir.files) {
      if (file.endsWith('.json')) {
        const key = file.replace('.json', '');
        profile.config[key] = await loadConfigFile(username, file);
      }
    }
  }

  return profile;
}

/**
 * Import profile from JSON (restore backup)
 */
export async function importProfileFromJson(
  username: string,
  data: {
    persona?: Record<string, any>;
    memories?: any[];
    tasks?: any[];
    config?: Record<string, any>;
  }
): Promise<boolean> {
  // Initialize structure
  if (!await initializeProfileStructure(username)) {
    return false;
  }

  let success = true;

  // Import persona
  if (data.persona) {
    for (const [key, value] of Object.entries(data.persona)) {
      if (!await savePersonaFile(username, key, value)) {
        success = false;
      }
    }
  }

  // Import memories
  if (data.memories) {
    for (const memory of data.memories) {
      if (!await saveMemoryFile(username, memory)) {
        success = false;
      }
    }
  }

  // Import tasks
  if (data.tasks) {
    for (const task of data.tasks) {
      if (!await saveTaskFile(username, task)) {
        success = false;
      }
    }
  }

  // Import config
  if (data.config) {
    for (const [filename, value] of Object.entries(data.config)) {
      if (!await saveConfigFile(username, `${filename}.json`, value)) {
        success = false;
      }
    }
  }

  console.log(`[mobile-fs] Profile import for ${username}: ${success ? 'OK' : 'PARTIAL'}`);
  return success;
}
