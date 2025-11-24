/**
 * fs_write Skill
 * Safely write files to allowed directories with role-based access control
 */

import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../../packages/core/src/paths';
import { SkillManifest, SkillResult, isWriteAllowed } from '../../packages/core/src/skills';
import { getSecurityPolicy } from '../../packages/core/src/security-policy';
import { loadDecisionRules } from '../../packages/core/src/identity';

export const manifest: SkillManifest = {
  id: 'fs_write',
  name: 'Write File',
  description: `Write content to a file. Allowed directories depend on your user role and trust level. Common directories: out/, logs/. Profile-specific paths may be available based on your permissions.`,
  category: 'fs',

  inputs: {
    path: {
      type: 'string',
      required: true,
      description: `Project-relative path. Allowed directories depend on your current permissions. Try paths like "out/file.txt" or "logs/file.txt". If denied, the error message will show your allowed directories.`,
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
  allowedDirectories: ['out/', 'logs/'], // Base directories, expanded dynamically per user
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

    // Get security context
    const policy = getSecurityPolicy();
    const trustLevel = loadDecisionRules().trustLevel;

    // Build context-aware allowed directories list
    const allowedDirs: string[] = ['out/', 'logs/'];

    // Add profile-specific directories if user has profile write access
    if (policy.username && policy.canWriteProfile(policy.username)) {
      allowedDirs.push(`profiles/${policy.username}/`);
    }

    // Add memory/ for users with memory write permission
    if (policy.canWriteMemory) {
      allowedDirs.push('memory/');
    }

    // Check role-based permissions first (more specific error messages)
    try {
      policy.requireFileAccess(filepath);
    } catch (securityError: any) {
      const attemptedPath = inputs.path;
      return {
        success: false,
        error: `PATH_NOT_ALLOWED: Cannot write to "${attemptedPath}".

Your current permissions:
  - User: ${policy.username || 'anonymous'}
  - Role: ${policy.role}
  - Trust Level: ${trustLevel}
  - Cognitive Mode: ${policy.mode}

Allowed directories for your role:
  ${allowedDirs.map(d => `• ${d}`).join('\n  ')}

Reason: ${securityError.message}

Suggestion: Try using a path like "out/your-file.txt" or ask the user to grant higher permissions.`,
      };
    }

    // Double-check write permission (directory-based - legacy check)
    if (!isWriteAllowed(filepath)) {
      const attemptedPath = inputs.path;
      return {
        success: false,
        error: `PATH_NOT_ALLOWED: Cannot write to "${attemptedPath}".

Your allowed directories:
  ${allowedDirs.map(d => `• ${d}`).join('\n  ')}

Try using a path like "out/your-file.txt" instead.`,
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
