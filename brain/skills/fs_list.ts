/**
 * fs_list Skill
 * List files/directories using glob patterns under allowed roots
 */

import path from 'node:path'
import { paths } from '../../packages/core/src/paths'
import { SkillManifest, SkillResult, isPathAllowed } from '../../packages/core/src/skills'
import { listGlob } from '../../packages/core/src/fs-glob'

export const manifest: SkillManifest = {
  id: 'fs_list',
  name: 'List Files',
  description: 'List files and directories matching a pattern',
  category: 'fs',

  inputs: {
    pattern: { type: 'string', required: true, description: 'Glob pattern (project-relative)' },
    cwd: { type: 'string', required: false, description: 'Base directory (project-relative); default: "."' },
    onlyFiles: { type: 'boolean', required: false, description: 'Return files only (default true)' },
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
