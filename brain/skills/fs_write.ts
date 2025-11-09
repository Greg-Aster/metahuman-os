/**
 * fs_write Skill
 * Safely write files to allowed directories with role-based access control
 */

import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../../packages/core/src/paths';
import { SkillManifest, SkillResult, isWriteAllowed } from '../../packages/core/src/skills';
import { getSecurityPolicy } from '../../packages/core/src/security-policy';

export const manifest: SkillManifest = {
  id: 'fs_write',
  name: 'Write File',
  description: 'Write content to a file in allowed directories',
  category: 'fs',

  inputs: {
    path: {
      type: 'string',
      required: true,
      description: 'Project-relative path (e.g., "out/file.txt") or absolute system path. Project-relative paths should NOT start with /',
      validation: (value) => isWriteAllowed(value),
    },
    content: {
      type: 'string',
      required: true,
      description: 'Content to write to the file',
    },
    overwrite: {
      type: 'boolean',
      required: false,
      description: 'Whether to overwrite existing file (default: false)',
    },
  },

  outputs: {
    path: { type: 'string', description: 'Path where file was written' },
    size: { type: 'number', description: 'Bytes written' },
  },

  risk: 'high',
  cost: 'cheap',
  minTrustLevel: 'supervised_auto',
  requiresApproval: true,
  allowedDirectories: ['memory/', 'out/', 'logs/'],
};

export async function execute(inputs: {
  path: string;
  content: string;
  overwrite?: boolean;
}): Promise<SkillResult> {
  try {
    const filepath = path.isAbsolute(inputs.path)
      ? path.resolve(inputs.path)
      : path.resolve(paths.root, inputs.path);
    const overwrite = inputs.overwrite ?? false;

    // Double-check write permission (directory-based)
    if (!isWriteAllowed(filepath)) {
      return {
        success: false,
        error: `Write not allowed to path: ${filepath}`,
      };
    }

    // Check role-based permissions
    try {
      const policy = getSecurityPolicy();
      policy.requireFileAccess(filepath);
    } catch (securityError: any) {
      return {
        success: false,
        error: `Security check failed: ${securityError.message}`,
      };
    }

    // Check if file exists
    const fileExists = fs.existsSync(filepath);

    if (fileExists && !overwrite) {
      return {
        success: false,
        error: `File already exists and overwrite=false: ${filepath}`,
      };
    }

    // Ensure parent directory exists
    const dirPath = path.dirname(filepath);
    fs.mkdirSync(dirPath, { recursive: true });

    // Write the file
    fs.writeFileSync(filepath, inputs.content, 'utf-8');

    // Get file size
    const stats = fs.statSync(filepath);

    return {
      success: true,
      outputs: {
        path: filepath,
        size: stats.size,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to write file: ${(error as Error).message}`,
    };
  }
}
