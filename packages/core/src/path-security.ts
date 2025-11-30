/**
 * Path Security Module
 *
 * Validates profile paths to prevent security vulnerabilities:
 * - Path traversal attacks (..)
 * - Symlink attacks
 * - Access to forbidden system directories
 * - Access to MetaHuman internal directories
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './path-builder.js';

/**
 * Result of path validation
 */
export interface PathValidationResult {
  /** Whether the path is valid and safe to use */
  valid: boolean;
  /** Security errors that must be fixed */
  errors: string[];
  /** Non-blocking warnings (e.g., permissions) */
  warnings: string[];
  /** Canonical resolved path after symlink resolution */
  resolvedPath: string;
}

/**
 * Options for path validation
 */
export interface PathValidationOptions {
  /** Check if path exists (default: true) */
  checkExists?: boolean;
  /** Check if path is writable (default: true) */
  checkWritable?: boolean;
  /** Allow symlinks (default: false for security) */
  allowSymlinks?: boolean;
}

/**
 * Forbidden system directories that cannot be used for profiles
 */
const FORBIDDEN_SYSTEM_PATHS = [
  '/etc',
  '/var',
  '/usr',
  '/bin',
  '/sbin',
  '/root',
  '/proc',
  '/sys',
  '/dev',
  '/boot',
  '/lib',
  '/lib64',
  '/opt',
  '/srv',
  '/tmp',
  '/run',
];

/**
 * MetaHuman internal directories that cannot be used for profiles
 */
const METAHUMAN_INTERNAL_PATHS = [
  'brain',
  'packages',
  'apps',
  'bin',
  'node_modules',
  '.git',
  'docs',
  'scripts',
  'external',
];

/**
 * Validate a profile path for security
 *
 * Performs comprehensive security checks:
 * 1. Path must be absolute
 * 2. No path traversal (..)
 * 3. Symlink resolution and validation
 * 4. Block forbidden system directories
 * 5. Block MetaHuman internal directories
 * 6. Check writability
 * 7. Permission warnings
 *
 * @param inputPath - Path to validate
 * @param options - Validation options
 * @returns Validation result with errors and warnings
 */
export function validateProfilePath(
  inputPath: string,
  options: PathValidationOptions = {}
): PathValidationResult {
  const {
    checkExists = true,
    checkWritable = true,
    allowSymlinks = false,
  } = options;

  const errors: string[] = [];
  const warnings: string[] = [];
  let resolvedPath = inputPath;

  // 1. Must be absolute path
  if (!path.isAbsolute(inputPath)) {
    errors.push('Path must be absolute (start with /)');
    return { valid: false, errors, warnings, resolvedPath };
  }

  // 2. No path traversal sequences
  if (inputPath.includes('..')) {
    errors.push('Path cannot contain parent directory references (..)');
  }

  // Normalize the path to catch sneaky traversals
  const normalizedPath = path.normalize(inputPath);
  if (normalizedPath !== inputPath && normalizedPath.includes('..')) {
    errors.push('Path contains suspicious sequences');
  }

  // 3. Check if path exists and resolve symlinks
  if (checkExists) {
    try {
      // Get the real path (resolves symlinks)
      resolvedPath = fs.realpathSync(inputPath);

      // If symlinks aren't allowed, check if the path was a symlink
      if (!allowSymlinks && resolvedPath !== path.resolve(inputPath)) {
        // The path involved symlinks
        const stats = fs.lstatSync(inputPath);
        if (stats.isSymbolicLink()) {
          errors.push(
            'Symlinks are not allowed for profile paths (security risk)'
          );
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        errors.push('Path does not exist');
      } else if ((e as NodeJS.ErrnoException).code === 'EACCES') {
        errors.push('Permission denied accessing path');
      } else {
        errors.push(`Cannot access path: ${(e as Error).message}`);
      }
      return { valid: false, errors, warnings, resolvedPath };
    }
  } else {
    // Even without existence check, normalize the path
    resolvedPath = path.resolve(inputPath);
  }

  // 4. Block forbidden system directories
  for (const forbidden of FORBIDDEN_SYSTEM_PATHS) {
    if (
      resolvedPath === forbidden ||
      resolvedPath.startsWith(forbidden + '/')
    ) {
      errors.push(`Cannot use system directory: ${forbidden}`);
    }
  }

  // 5. Block MetaHuman internal directories
  for (const internal of METAHUMAN_INTERNAL_PATHS) {
    const internalPath = path.join(ROOT, internal);
    if (
      resolvedPath === internalPath ||
      resolvedPath.startsWith(internalPath + '/')
    ) {
      errors.push(`Cannot use MetaHuman internal directory: ${internal}/`);
    }
  }

  // Also block if trying to use root as profile directly
  if (resolvedPath === ROOT) {
    errors.push('Cannot use MetaHuman root directory as profile location');
  }

  // 6. Check if it's a directory
  if (checkExists) {
    try {
      const stats = fs.statSync(resolvedPath);
      if (!stats.isDirectory()) {
        errors.push('Path must be a directory, not a file');
      }
    } catch {
      // Already handled above
    }
  }

  // 7. Check writability
  if (checkWritable && errors.length === 0) {
    if (checkExists) {
      // Check the path itself is writable
      try {
        fs.accessSync(resolvedPath, fs.constants.W_OK);
      } catch {
        errors.push('Directory is not writable');
      }
    } else {
      // Path doesn't exist yet - walk up the tree to find first existing ancestor
      let checkDir = path.dirname(resolvedPath);
      let foundExisting = false;

      // Walk up until we find an existing directory or hit root
      while (checkDir && checkDir !== '/') {
        if (fs.existsSync(checkDir)) {
          foundExisting = true;
          try {
            fs.accessSync(checkDir, fs.constants.W_OK);
          } catch {
            errors.push(`Cannot create directories - ${checkDir} is not writable`);
          }
          break;
        }
        checkDir = path.dirname(checkDir);
      }

      if (!foundExisting) {
        errors.push('No writable parent directory found in path');
      }
    }
  }

  // 8. Check permissions (warning only)
  if (checkExists && errors.length === 0) {
    try {
      const stats = fs.statSync(resolvedPath);
      const mode = stats.mode & 0o777;

      // Warn if world-readable (0o004) or world-writable (0o002)
      if (mode & 0o007) {
        warnings.push(
          `Directory has permissive permissions (${mode.toString(8)}). ` +
            'Consider using chmod 700 for better security.'
        );
      }

      // Warn if not owned by current user
      if (stats.uid !== process.getuid?.()) {
        warnings.push(
          'Directory is owned by a different user. ' +
            'This may cause permission issues.'
        );
      }
    } catch {
      // Non-critical, skip permission check
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    resolvedPath,
  };
}

/**
 * Check if a path is valid for profile storage (quick check)
 *
 * @param inputPath - Path to check
 * @returns true if path is valid
 */
export function isValidProfilePath(inputPath: string): boolean {
  return validateProfilePath(inputPath).valid;
}

/**
 * Validate a path before it's created (doesn't require existence)
 *
 * Used when user selects a new location that may not have a profile yet.
 *
 * @param inputPath - Path to validate
 * @returns Validation result
 */
export function validateNewProfilePath(inputPath: string): PathValidationResult {
  return validateProfilePath(inputPath, {
    checkExists: false,
    checkWritable: false,
  });
}

/**
 * Check if a path is on external storage
 *
 * Detects paths under common mount points:
 * - /media/ (user mounts)
 * - /mnt/ (manual mounts)
 * - /run/media/ (automounted devices)
 *
 * @param inputPath - Path to check
 * @returns true if path appears to be on external storage
 */
export function isExternalStoragePath(inputPath: string): boolean {
  const normalized = path.resolve(inputPath);

  const externalPrefixes = [
    '/media/',
    '/mnt/',
    '/run/media/',
  ];

  return externalPrefixes.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Get the default profile path for a user
 *
 * @param username - Username
 * @returns Default profile path
 */
export function getDefaultProfilePath(username: string): string {
  return path.join(ROOT, 'profiles', username);
}
