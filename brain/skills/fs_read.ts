/**
 * fs_read Skill
 * Safely read files from allowed directories with role-based access control
 */

import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../../packages/core/src/paths';
import { SkillManifest, SkillResult, isPathAllowed } from '../../packages/core/src/skills';
import { getSecurityPolicy } from '../../packages/core/src/security-policy';

export const manifest: SkillManifest = {
  id: 'fs_read',
  name: 'Read File',
  description: 'Read the contents of a file from the file system',
  category: 'fs',

  inputs: {
    path: {
      type: 'string',
      required: true,
      description: 'Project-relative path (e.g., "docs/file.md") or absolute system path. Project-relative paths should NOT start with /',
      validation: (value) => {
        // Allow reading from entire project (uses '.' for project root)
        return isPathAllowed(value, ['.']);
      },
    },
  },

  outputs: {
    content: { type: 'string', description: 'File contents' },
    size: { type: 'number', description: 'File size in bytes' },
    modified: { type: 'string', description: 'Last modified timestamp' },
  },

  risk: 'low',
  cost: 'cheap',
  minTrustLevel: 'observe',
  requiresApproval: false,
  allowedDirectories: ['.'], // Entire project
};

export async function execute(inputs: { path: string }): Promise<SkillResult> {
  try {
    const filepath = path.isAbsolute(inputs.path)
      ? path.resolve(inputs.path)
      : path.resolve(paths.root, inputs.path);

    // Double-check path is allowed (validation should have caught this)
    if (!isPathAllowed(filepath, ['.'])) {
      return {
        success: false,
        error: `Path not allowed: ${filepath}`,
      };
    }

    // Check role-based read permissions
    // For reads, we allow docs and own profile, enforced by security policy
    try {
      const policy = getSecurityPolicy();
      const normalizedPath = filepath.replace(/\\/g, '/');

      // Extract profile username if this is a profile path
      const profileMatch = normalizedPath.match(/profiles\/([^/]+)\//);
      if (profileMatch) {
        const targetUsername = profileMatch[1];
        policy.requireProfileRead(targetUsername);
      }
      // Docs are readable by everyone (policy.canReadDocs is always true)
      // Other paths proceed with default isPathAllowed check above
    } catch (securityError: any) {
      return {
        success: false,
        error: `Security check failed: ${securityError.message}`,
      };
    }

    // Check if file exists
    if (!fs.existsSync(filepath)) {
      return {
        success: false,
        error: `File not found: ${filepath}`,
      };
    }

    // Check if it's a file (not a directory)
    const stats = fs.statSync(filepath);
    if (!stats.isFile()) {
      return {
        success: false,
        error: `Path is not a file: ${filepath}`,
      };
    }

    // Read the file
    const content = fs.readFileSync(filepath, 'utf-8');

    return {
      success: true,
      outputs: {
        content,
        size: stats.size,
        modified: stats.mtime.toISOString(),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to read file: ${(error as Error).message}`,
    };
  }
}
