/**
 * LoRA Adapter Utilities
 *
 * Utilities for discovering, loading, and managing LoRA adapters
 * Used by PersonalityCoreLayer for authentic voice generation
 *
 * @module cognitive-layers/utils/lora-utils
 */

import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { ROOT } from '../../paths.js';

// ============================================================================
// Types
// ============================================================================

/**
 * LoRA adapter metadata
 */
export interface LoRAMetadata {
  /** Path to adapter file */
  path: string;

  /** Adapter name (directory or file name) */
  name: string;

  /** Training date (from directory name or file metadata) */
  date?: string;

  /** File size in bytes */
  size: number;

  /** Last modified timestamp */
  modified: Date;

  /** Whether this is a dual adapter (has history + recent) */
  isDual: boolean;

  /** Paths to dual adapter components (if isDual) */
  dualPaths?: {
    history: string;
    recent: string;
  };
}

/**
 * LoRA discovery result
 */
export interface LoRADiscoveryResult {
  /** All found adapters, sorted by date (newest first) */
  adapters: LoRAMetadata[];

  /** Latest single adapter (if any) */
  latest?: LoRAMetadata;

  /** Latest dual adapter (if any) */
  latestDual?: LoRAMetadata;

  /** Total number of adapters found */
  count: number;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Paths to search for LoRA adapters
 */
function getLoRAPaths(): string[] {
  return [
    join(ROOT, 'out/adapters'),           // Primary location
    join(ROOT, 'out/loras'),              // Alternative location
    join(ROOT, 'persona/adapters'),       // Per-user adapters (future)
  ];
}

/**
 * Valid LoRA adapter file extensions
 */
const LORA_EXTENSIONS = ['.gguf', '.safetensors', '.bin', '.pt'];

// ============================================================================
// Discovery
// ============================================================================

/**
 * Discover all available LoRA adapters
 *
 * Searches common adapter locations and returns metadata for all found adapters.
 * Results are sorted by date (newest first).
 *
 * @returns Discovery result with all found adapters
 */
export function discoverLoRAAdapters(): LoRADiscoveryResult {
  const adapters: LoRAMetadata[] = [];

  for (const basePath of getLoRAPaths()) {
    if (!existsSync(basePath)) continue;

    try {
      const entries = readdirSync(basePath);

      for (const entry of entries) {
        const entryPath = join(basePath, entry);
        const stats = statSync(entryPath);

        if (stats.isDirectory()) {
          // Check for adapter files in directory
          const dirAdapters = discoverAdaptersInDirectory(entryPath, entry);
          adapters.push(...dirAdapters);
        } else if (stats.isFile() && hasLoRAExtension(entry)) {
          // Single adapter file
          const metadata = createAdapterMetadata(entryPath, entry);
          if (metadata) adapters.push(metadata);
        }
      }
    } catch (error) {
      console.error(`[lora-utils] Error discovering adapters in ${basePath}:`, error);
    }
  }

  // Sort by date (newest first)
  adapters.sort((a, b) => {
    if (a.date && b.date) {
      return b.date.localeCompare(a.date);
    }
    return b.modified.getTime() - a.modified.getTime();
  });

  // Find latest single and dual adapters
  const latest = adapters.find(a => !a.isDual);
  const latestDual = adapters.find(a => a.isDual);

  return {
    adapters,
    latest,
    latestDual,
    count: adapters.length
  };
}

/**
 * Discover adapters within a directory
 */
function discoverAdaptersInDirectory(dirPath: string, dirName: string): LoRAMetadata[] {
  const adapters: LoRAMetadata[] = [];

  try {
    const entries = readdirSync(dirPath);

    // Check for dual adapter structure (history-merged.gguf + adapter.gguf)
    const hasHistory = entries.includes('history-merged.gguf');
    const hasRecent = entries.includes('adapter.gguf') || entries.some(e => e.startsWith('adapter-'));

    if (hasHistory && hasRecent) {
      // This is a dual adapter
      const recentFile = entries.find(e => e === 'adapter.gguf') || entries.find(e => e.startsWith('adapter-'));
      if (recentFile) {
        const metadata: LoRAMetadata = {
          path: dirPath,
          name: dirName,
          date: extractDateFromName(dirName),
          size: getDirectorySize(dirPath),
          modified: statSync(dirPath).mtime,
          isDual: true,
          dualPaths: {
            history: join(dirPath, 'history-merged.gguf'),
            recent: join(dirPath, recentFile)
          }
        };
        adapters.push(metadata);
        return adapters;
      }
    }

    // Look for individual adapter files
    for (const entry of entries) {
      const entryPath = join(dirPath, entry);
      const stats = statSync(entryPath);

      if (stats.isFile() && hasLoRAExtension(entry)) {
        const metadata = createAdapterMetadata(entryPath, `${dirName}/${entry}`, dirName);
        if (metadata) adapters.push(metadata);
      }
    }
  } catch (error) {
    console.error(`[lora-utils] Error reading directory ${dirPath}:`, error);
  }

  return adapters;
}

/**
 * Create adapter metadata from file path
 */
function createAdapterMetadata(
  filePath: string,
  name: string,
  dateHint?: string
): LoRAMetadata | null {
  try {
    const stats = statSync(filePath);

    return {
      path: filePath,
      name,
      date: dateHint ? extractDateFromName(dateHint) : undefined,
      size: stats.size,
      modified: stats.mtime,
      isDual: false
    };
  } catch (error) {
    console.error(`[lora-utils] Error reading adapter file ${filePath}:`, error);
    return null;
  }
}

/**
 * Check if file has valid LoRA extension
 */
function hasLoRAExtension(filename: string): boolean {
  return LORA_EXTENSIONS.some(ext => filename.endsWith(ext));
}

/**
 * Extract date from adapter name
 * Looks for patterns like: 2025-11-05, 20251105, etc.
 */
function extractDateFromName(name: string): string | undefined {
  // Match YYYY-MM-DD format
  const dashMatch = name.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (dashMatch) {
    return `${dashMatch[1]}-${dashMatch[2]}-${dashMatch[3]}`;
  }

  // Match YYYYMMDD format
  const compactMatch = name.match(/(\d{4})(\d{2})(\d{2})/);
  if (compactMatch) {
    return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
  }

  return undefined;
}

/**
 * Get total size of directory (for dual adapters)
 */
function getDirectorySize(dirPath: string): number {
  let total = 0;
  try {
    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      const entryPath = join(dirPath, entry);
      const stats = statSync(entryPath);
      if (stats.isFile()) {
        total += stats.size;
      }
    }
  } catch {}
  return total;
}

// ============================================================================
// Finder Functions
// ============================================================================

/**
 * Find the latest LoRA adapter
 *
 * @param preferDual - Prefer dual adapter over single (default: false)
 * @returns Latest adapter metadata or undefined if none found
 */
export function findLatestLoRA(preferDual = false): LoRAMetadata | undefined {
  const discovery = discoverLoRAAdapters();

  if (preferDual && discovery.latestDual) {
    return discovery.latestDual;
  }

  return discovery.latest || discovery.latestDual;
}

/**
 * Find LoRA adapter by date
 *
 * @param date - Date string (YYYY-MM-DD)
 * @returns Adapter for that date or undefined
 */
export function findLoRAByDate(date: string): LoRAMetadata | undefined {
  const discovery = discoverLoRAAdapters();
  return discovery.adapters.find(a => a.date === date);
}

/**
 * Find LoRA adapter by name
 *
 * @param name - Adapter name or partial name
 * @returns Adapter with matching name or undefined
 */
export function findLoRAByName(name: string): LoRAMetadata | undefined {
  const discovery = discoverLoRAAdapters();
  return discovery.adapters.find(a => a.name.includes(name));
}

/**
 * Load LoRA snapshot for emulation mode
 *
 * Looks for a specific snapshot adapter by date or name.
 * Falls back to latest if not found.
 *
 * @param snapshotId - Date (YYYY-MM-DD) or name
 * @returns Adapter metadata or undefined
 */
export function loadLoRASnapshot(snapshotId: string): LoRAMetadata | undefined {
  // Try by date first
  let adapter = findLoRAByDate(snapshotId);

  // Try by name
  if (!adapter) {
    adapter = findLoRAByName(snapshotId);
  }

  // Fallback to latest
  if (!adapter) {
    console.warn(`[lora-utils] Snapshot '${snapshotId}' not found, using latest`);
    adapter = findLatestLoRA();
  }

  return adapter;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate LoRA adapter
 *
 * Checks:
 * - File/directory exists
 * - For dual adapters: both components exist
 * - File size reasonable (>1MB, <10GB)
 *
 * @param adapter - Adapter metadata
 * @returns Validation result
 */
export function validateLoRAAdapter(adapter: LoRAMetadata): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check existence
  if (!existsSync(adapter.path)) {
    errors.push(`Adapter path does not exist: ${adapter.path}`);
    return { valid: false, errors };
  }

  // Validate dual adapter
  if (adapter.isDual && adapter.dualPaths) {
    if (!existsSync(adapter.dualPaths.history)) {
      errors.push(`History adapter not found: ${adapter.dualPaths.history}`);
    }
    if (!existsSync(adapter.dualPaths.recent)) {
      errors.push(`Recent adapter not found: ${adapter.dualPaths.recent}`);
    }
  }

  // Check size (reasonable range: 1MB - 10GB)
  const minSize = 1 * 1024 * 1024;        // 1MB
  const maxSize = 10 * 1024 * 1024 * 1024; // 10GB

  if (adapter.size < minSize) {
    errors.push(`Adapter file too small: ${formatSize(adapter.size)} (minimum: ${formatSize(minSize)})`);
  }

  if (adapter.size > maxSize) {
    errors.push(`Adapter file too large: ${formatSize(adapter.size)} (maximum: ${formatSize(maxSize)})`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Format byte size for display
 */
function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get LoRA adapter summary (for debugging)
 */
export function getLoRASummary(): {
  totalAdapters: number;
  singleAdapters: number;
  dualAdapters: number;
  latest?: string;
  latestDual?: string;
  searchPaths: string[];
} {
  const discovery = discoverLoRAAdapters();
  const searchPaths = getLoRAPaths();

  return {
    totalAdapters: discovery.count,
    singleAdapters: discovery.adapters.filter(a => !a.isDual).length,
    dualAdapters: discovery.adapters.filter(a => a.isDual).length,
    latest: discovery.latest?.name,
    latestDual: discovery.latestDual?.name,
    searchPaths: searchPaths.filter(p => existsSync(p))
  };
}
