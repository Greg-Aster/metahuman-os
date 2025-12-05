/**
 * Storage Utilities for Server Deployments
 *
 * Network volume storage utilities for server deployments.
 * Provides health checks, storage info, and user management.
 *
 * IMPORTANT: This module does NOT reimplement path resolution.
 * All path resolution uses @metahuman/core:
 * - getProfilePaths(username) for user-specific paths
 * - storageClient for category-based file I/O
 * - ROOT for the storage root (respects METAHUMAN_ROOT)
 *
 * The core package respects METAHUMAN_ROOT for server deployments,
 * so setting that env var automatically routes to network volume.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getProfilePaths, ROOT } from '@metahuman/core';

// ============================================================================
// Types
// ============================================================================

export interface StorageConfig {
  /** Enable storage health checks */
  healthCheckEnabled?: boolean;
  /** Health check interval in ms (default: 60000) */
  healthCheckIntervalMs?: number;
}

export interface StorageHealth {
  available: boolean;
  readAccess: boolean;
  writeAccess: boolean;
  freeSpaceBytes?: number;
  totalSpaceBytes?: number;
  lastCheckTime: number;
  error?: string;
  /** The resolved root path (from METAHUMAN_ROOT or auto-detected) */
  rootPath: string;
}

export interface UserStorageInfo {
  username: string;
  storagePath: string;
  exists: boolean;
  sizeBytes?: number;
  fileCount?: number;
}

// ============================================================================
// Network Volume Storage
// ============================================================================

/**
 * Manages network volume storage for server deployments
 *
 * Uses @metahuman/core's path resolution which respects METAHUMAN_ROOT.
 * Set METAHUMAN_ROOT=/runpod-volume/metahuman for server deployments.
 */
export class NetworkVolumeStorage {
  private config: Required<StorageConfig>;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private lastHealth: StorageHealth | null = null;

  constructor(config: StorageConfig = {}) {
    this.config = {
      healthCheckEnabled: config.healthCheckEnabled ?? true,
      healthCheckIntervalMs: config.healthCheckIntervalMs ?? 60000,
    };

    // Start health checks if enabled
    if (this.config.healthCheckEnabled) {
      this.startHealthChecks();
    }
  }

  /**
   * Get the storage root path (from core, respects METAHUMAN_ROOT)
   */
  getBasePath(): string {
    return ROOT;
  }

  /**
   * Get the storage path for a specific user
   * Uses core's getProfilePaths which respects METAHUMAN_ROOT
   */
  getUserPath(username: string): string {
    return getProfilePaths(username).root;
  }

  /**
   * Get all paths for a user
   * Delegates to core's getProfilePaths - the single source of truth
   */
  getUserPaths(username: string) {
    return getProfilePaths(username);
  }

  /**
   * Initialize storage for a new user
   * Creates the standard profile directory structure
   */
  async initializeUserStorage(username: string): Promise<void> {
    const paths = getProfilePaths(username);

    // Create essential directories from the profile paths
    const dirsToCreate = [
      paths.root,
      paths.persona,
      paths.memory,
      paths.etc,
      paths.logs,
      paths.out,
      paths.episodic,
      paths.semantic,
      paths.tasks,
      paths.vectorIndex,
    ];

    for (const dir of dirsToCreate) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[storage] Created directory: ${dir}`);
      }
    }
  }

  /**
   * Check if user storage exists
   */
  userStorageExists(username: string): boolean {
    const userPath = this.getUserPath(username);
    return fs.existsSync(userPath);
  }

  /**
   * Get storage info for a user
   */
  async getUserStorageInfo(username: string): Promise<UserStorageInfo> {
    const storagePath = this.getUserPath(username);
    const exists = fs.existsSync(storagePath);

    if (!exists) {
      return {
        username,
        storagePath,
        exists: false,
      };
    }

    // Calculate size and file count (async to not block)
    const { sizeBytes, fileCount } = await this.calculateDirectoryStats(storagePath);

    return {
      username,
      storagePath,
      exists: true,
      sizeBytes,
      fileCount,
    };
  }

  /**
   * List all users with storage
   */
  async listUsers(): Promise<string[]> {
    const profilesPath = path.join(ROOT, 'profiles');

    if (!fs.existsSync(profilesPath)) {
      return [];
    }

    const entries = fs.readdirSync(profilesPath, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => e.name);
  }

  /**
   * Check storage health
   */
  async checkHealth(): Promise<StorageHealth> {
    const basePath = ROOT;
    const health: StorageHealth = {
      available: false,
      readAccess: false,
      writeAccess: false,
      lastCheckTime: Date.now(),
      rootPath: basePath,
    };

    try {
      // Check if base path exists
      if (!fs.existsSync(basePath)) {
        health.error = `Base path does not exist: ${basePath}`;
        this.lastHealth = health;
        return health;
      }

      health.available = true;

      // Check read access
      try {
        fs.readdirSync(basePath);
        health.readAccess = true;
      } catch (error) {
        health.error = `Read access denied: ${(error as Error).message}`;
        this.lastHealth = health;
        return health;
      }

      // Check write access with temp file
      const testFile = path.join(basePath, `.health-check-${Date.now()}`);
      try {
        fs.writeFileSync(testFile, 'health check');
        fs.unlinkSync(testFile);
        health.writeAccess = true;
      } catch (error) {
        health.error = `Write access denied: ${(error as Error).message}`;
      }

      // Try to get disk space (may not work on all systems)
      try {
        const stats = fs.statfsSync(basePath);
        health.freeSpaceBytes = stats.bfree * stats.bsize;
        health.totalSpaceBytes = stats.blocks * stats.bsize;
      } catch {
        // statfsSync not available or failed, skip
      }

    } catch (error) {
      health.error = `Health check failed: ${(error as Error).message}`;
    }

    this.lastHealth = health;
    return health;
  }

  /**
   * Get last known health status
   */
  getLastHealth(): StorageHealth | null {
    return this.lastHealth;
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Initial check
    this.checkHealth().catch(console.error);

    // Periodic checks
    this.healthCheckInterval = setInterval(() => {
      this.checkHealth().catch(console.error);
    }, this.config.healthCheckIntervalMs);

    console.log(`[storage] Health checks started (interval: ${this.config.healthCheckIntervalMs}ms)`);
  }

  /**
   * Stop health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      console.log('[storage] Health checks stopped');
    }
  }

  /**
   * Calculate directory size and file count
   */
  private async calculateDirectoryStats(
    dirPath: string
  ): Promise<{ sizeBytes: number; fileCount: number }> {
    let sizeBytes = 0;
    let fileCount = 0;

    const processDir = (currentPath: string): void => {
      try {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);

          if (entry.isDirectory()) {
            processDir(fullPath);
          } else if (entry.isFile()) {
            try {
              const stats = fs.statSync(fullPath);
              sizeBytes += stats.size;
              fileCount++;
            } catch {
              // Skip files we can't stat
            }
          }
        }
      } catch {
        // Skip directories we can't read
      }
    };

    processDir(dirPath);

    return { sizeBytes, fileCount };
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createNetworkVolumeStorage(config?: StorageConfig): NetworkVolumeStorage {
  return new NetworkVolumeStorage(config);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Check if a path is on a network volume (heuristic)
 */
export function isNetworkVolume(checkPath: string): boolean {
  // Common network volume patterns
  const networkPatterns = [
    /^\/runpod-volume/,
    /^\/mnt\/nfs/,
    /^\/nfs/,
    /^\/data/,
    /^\/shared/,
    /^\/volumes/,
  ];

  return networkPatterns.some(pattern => pattern.test(checkPath));
}
