/**
 * fs_list Skill
 * List files/directories using glob patterns under allowed roots with role-based access control
 */

import path from 'node:path'
import { paths } from '../../packages/core/src/paths'
import { SkillManifest, SkillResult, isPathAllowed } from '../../packages/core/src/skills'
import { listGlob } from '../../packages/core/src/fs-glob'
import { getSecurityPolicy } from '../../packages/core/src/security-policy'

export const manifest: SkillManifest = {
  id: 'fs_list',
  name: 'List Files',
  description: 'List files and directories matching a glob pattern. IMPORTANT: Patterns are case-sensitive, so use lowercase for paths (e.g., "docs/" not "Docs/"). Use wildcards for fuzzy matches: "**/*user*guide*" finds files containing "user" and "guide"',
  category: 'fs',

  inputs: {
    pattern: { type: 'string', required: true, description: 'Glob pattern (project-relative). Examples: "docs/**/*" (all files in docs), "**/user*guide*" (fuzzy match), "packages/*/src/*.ts" (specific file type)' },
    cwd: { type: 'string', required: false, description: 'Base directory (project-relative); default: "."' },
    onlyFiles: { type: 'boolean', required: false, description: 'Return files only (default true). Set to false to include directories' },
    maxResults: { type: 'number', required: false, description: 'Max items to return (default 200)' },
  },

  outputs: {
    items: { type: 'array', description: 'List of relative paths' },
  },

  risk: 'low',
  cost: 'free',
  minTrustLevel: 'observe',
  requiresApproval: false,
  allowedDirectories: ['.', 'memory/', 'persona/', 'logs/', 'out/', 'etc/', 'docs/', 'brain/', 'packages/', 'apps/'],
}

export async function execute(inputs: {
  pattern: string
  cwd?: string
  onlyFiles?: boolean
  maxResults?: number
}): Promise<SkillResult> {
  const base = inputs.cwd ? path.resolve(paths.root, inputs.cwd) : paths.root
  // Validate base path
  if (!isPathAllowed(base, manifest.allowedDirectories!)) {
    return { success: false, error: `Base path not allowed: ${base}` }
  }

  // Check role-based permissions for the base directory
  try {
    const policy = getSecurityPolicy()
    const normalizedBase = base.replace(/\\/g, '/')

    // Check if listing a profile directory
    const profileMatch = normalizedBase.match(/profiles\/([^/]+)/)
    if (profileMatch) {
      const targetUsername = profileMatch[1]
      policy.requireProfileRead(targetUsername)
    }
    // Docs and other allowed directories are readable by everyone
  } catch (securityError: any) {
    return {
      success: false,
      error: `Security check failed: ${securityError.message}`,
    }
  }

  const onlyFiles = inputs.onlyFiles ?? true
  const maxResults = Math.max(1, Math.min(inputs.maxResults ?? 200, 2000))
  const pattern = inputs.pattern || '**/*'
  const entries = await listGlob(base, pattern, {
    dot: false,
    onlyFiles,
    unique: true,
    followSymbolicLinks: false,
    suppressErrors: true,
  })
  const rels = entries.slice(0, maxResults)
  return { success: true, outputs: { items: rels } }
}
