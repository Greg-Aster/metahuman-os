/**
 * fs_read Skill
 * Safely read files from allowed directories
 */

import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../../packages/core/src/paths';
import { SkillManifest, SkillResult, isPathAllowed } from '../../packages/core/src/skills';

export const manifest: SkillManifest = {
  id: 'fs_read',
  name: 'Read File',
  description: 'Read the contents of a file from the file system',
  category: 'fs',

  inputs: {
    path: {
      type: 'string',
      required: true,
      description: 'Absolute path to the file to read',
      validation: (value) => {
        const allowedDirs = ['memory/', 'persona/', 'logs/', 'out/', 'etc/', 'docs/'];
        return isPathAllowed(value, allowedDirs);
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
  allowedDirectories: ['.', 'memory/', 'persona/', 'logs/', 'out/', 'etc/', 'docs/', 'brain/', 'packages/', 'apps/'],
};

export async function execute(inputs: { path: string }): Promise<SkillResult> {
  try {
    const filepath = path.isAbsolute(inputs.path)
      ? path.resolve(inputs.path)
      : path.resolve(paths.root, inputs.path);

    // Double-check path is allowed (validation should have caught this)
    if (!isPathAllowed(filepath, manifest.allowedDirectories!)) {
      return {
        success: false,
        error: `Path not allowed: ${filepath}`,
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
