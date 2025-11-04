/**
 * fs_delete Skill
 * Safely delete files with dry-run preview and explicit confirm
 */

import fs from 'node:fs'
import path from 'node:path'
import { paths } from '../../packages/core/src/paths'
import { SkillManifest, SkillResult, isPathAllowed, isWriteAllowed } from '../../packages/core/src/skills'
import { listGlob } from '../../packages/core/src/fs-glob'

export const manifest: SkillManifest = {
  id: 'fs_delete',
  name: 'Delete Files',
  description: 'Delete files by pattern or path with dry-run preview',
  category: 'fs',

  inputs: {
    target: { type: 'string', required: true, description: 'File path or glob pattern (project-relative)' },
    cwd: { type: 'string', required: false, description: 'Base directory (project-relative); default: "."' },
    dryRun: { type: 'boolean', required: false, description: 'Preview only (default true)' },
    confirm: { type: 'boolean', required: false, description: 'Must be true to actually delete (safety)' },
    maxItems: { type: 'number', required: false, description: 'Max deletions (default 100)' },
  },

  outputs: {
    deleted: { type: 'array', description: 'Deleted file paths (relative)' },
    preview: { type: 'array', description: 'Preview of files to delete (relative)' },
  },

  risk: 'high',
  cost: 'free',
  minTrustLevel: 'supervised_auto',
  requiresApproval: true,
  allowedDirectories: ['memory/', 'out/', 'logs/'],
}

export async function execute(inputs: { target: string, cwd?: string, dryRun?: boolean, confirm?: boolean, maxItems?: number }): Promise<SkillResult> {
  const base = inputs.cwd ? path.resolve(paths.root, inputs.cwd) : paths.root
  if (!isPathAllowed(base, manifest.allowedDirectories!)) return { success: false, error: `Base path not allowed: ${base}` }
  const maxItems = Math.max(1, Math.min(inputs.maxItems ?? 100, 500))
  const dryRun = inputs.dryRun ?? true
  const candidates = await listGlob(base, inputs.target, { onlyFiles: true, dot: false })
  const rels = candidates.slice(0, maxItems)
  const absList = rels.map(r => path.resolve(base, r))
  // Validate each path allowed + writable
  const allowed = absList.filter(p => isPathAllowed(p, manifest.allowedDirectories!) && isWriteAllowed(p))
  if (dryRun || !inputs.confirm) {
    return { success: true, outputs: { preview: allowed.map(a => path.relative(paths.root, a)) } }
  }
  const deleted: string[] = []
  for (const p of allowed) {
    try { fs.unlinkSync(p); deleted.push(path.relative(paths.root, p)) } catch {}
  }
  return { success: true, outputs: { deleted } }
}
