/**
 * code_apply_patch Skill
 * Stage code changes for approval and application
 */

import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../../packages/core/src/paths';
import { SkillManifest, SkillResult, isCoderWriteAllowed, queueForApproval } from '../../packages/core/src/skills';

export const manifest: SkillManifest = {
  id: 'code_apply_patch',
  name: 'Apply Code Patch',
  description: 'Stage code changes for approval and apply them to files',
  category: 'fs',

  inputs: {
    filePath: {
      type: 'string',
      required: true,
      description: 'Path to the file to modify or create (project-relative)',
    },
    patch: {
      type: 'string',
      required: false,
      description: 'Unified diff to apply (for existing files)',
    },
    newContent: {
      type: 'string',
      required: false,
      description: 'Complete new file content (for new files)',
    },
    explanation: {
      type: 'string',
      required: true,
      description: 'Explanation of the changes being made',
    },
    testCommands: {
      type: 'array',
      required: false,
      description: 'Test commands to run after applying changes',
    },
  },

  outputs: {
    stagingPath: { type: 'string', description: 'Path where changes are staged' },
    approvalId: { type: 'string', description: 'Approval queue item ID' },
  },

  risk: 'high',
  cost: 'free',
  minTrustLevel: 'supervised_auto',
  requiresApproval: true, // ALWAYS require approval for code changes
  allowedDirectories: ['apps/', 'packages/', 'brain/', 'docs/', 'etc/', 'out/', 'tests/'],
};

export async function execute(inputs: {
  filePath: string;
  patch?: string;
  newContent?: string;
  explanation: string;
  testCommands?: string[];
}): Promise<SkillResult> {
  try {
    const filepath = path.isAbsolute(inputs.filePath)
      ? path.resolve(inputs.filePath)
      : path.resolve(paths.root, inputs.filePath);

    // Security: Verify coder is allowed to write to this path
    if (!isCoderWriteAllowed(filepath)) {
      return {
        success: false,
        error: `Coder is not allowed to write to ${inputs.filePath}. Protected directories: memory/, persona/, logs/`,
      };
    }

    // Must have either patch or newContent
    if (!inputs.patch && !inputs.newContent) {
      return {
        success: false,
        error: 'Must provide either patch or newContent',
      };
    }

    // Create staging directory
    const stagingDir = path.join(paths.out, 'code-drafts');
    if (!fs.existsSync(stagingDir)) {
      fs.mkdirSync(stagingDir, { recursive: true });
    }

    // Generate staging file name
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = path.basename(inputs.filePath);
    const stagingFileName = `${timestamp}-${baseName}`;
    const stagingPath = path.join(stagingDir, stagingFileName);

    // Write staged changes
    const stagedData = {
      filePath: inputs.filePath,
      absolutePath: filepath,
      patch: inputs.patch || null,
      newContent: inputs.newContent || null,
      explanation: inputs.explanation,
      testCommands: inputs.testCommands || [],
      timestamp: new Date().toISOString(),
      status: 'pending',
    };

    fs.writeFileSync(stagingPath, JSON.stringify(stagedData, null, 2), 'utf-8');

    // If newContent provided, also save preview
    if (inputs.newContent) {
      const previewPath = stagingPath.replace('.json', '-preview.txt');
      fs.writeFileSync(previewPath, inputs.newContent, 'utf-8');
    }

    console.log(`[code_apply_patch] Staged changes at: ${stagingPath}`);
    console.log(`[code_apply_patch] Target file: ${inputs.filePath}`);
    console.log(`[code_apply_patch] Explanation: ${inputs.explanation}`);

    // Queue for approval
    // Note: The actual application will happen via the approval API endpoint
    // For now, return success with staging info
    return {
      success: true,
      outputs: {
        stagingPath,
        approvalId: `staged-${timestamp}`, // Will be replaced by actual approval system
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to stage code changes: ${(error as Error).message}`,
    };
  }
}

/**
 * Apply staged code changes (called after approval)
 */
export async function applyStaged(stagingPath: string): Promise<SkillResult> {
  try {
    // Read staged data
    const stagedData = JSON.parse(fs.readFileSync(stagingPath, 'utf-8'));
    const targetPath = stagedData.absolutePath;

    // Apply changes based on type
    if (stagedData.newContent) {
      // New file or complete replacement
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.writeFileSync(targetPath, stagedData.newContent, 'utf-8');
    } else if (stagedData.patch) {
      // Apply unified diff (simplified - real implementation would use patch library)
      // For now, just log that we would apply the patch
      console.log('[code_apply_patch] Would apply patch:', stagedData.patch);
      return {
        success: false,
        error: 'Patch application not yet implemented - use newContent for now',
      };
    }

    // Update staged data status
    stagedData.status = 'applied';
    stagedData.appliedAt = new Date().toISOString();
    fs.writeFileSync(stagingPath, JSON.stringify(stagedData, null, 2), 'utf-8');

    return {
      success: true,
      outputs: {
        filePath: stagedData.filePath,
        applied: true,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to apply staged changes: ${(error as Error).message}`,
    };
  }
}
