/**
 * json_update Skill
 * Update JSON files by setting a key path or merging an object
 */

import fs from 'node:fs'
import path from 'node:path'
import { paths } from '../../packages/core/src/paths'
import { SkillManifest, SkillResult, isPathAllowed, isWriteAllowed } from '../../packages/core/src/skills'

function setPath(obj: any, keyPath: string, value: any) {
  const parts = keyPath.split('.').map(p => p.trim()).filter(Boolean)
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {}
    cur = cur[k]
  }
  cur[parts[parts.length - 1]] = value
}

export const manifest: SkillManifest = {
  id: 'json_update',
  name: 'Update JSON',
  description: 'Set a key path or merge an object into a JSON file',
  category: 'fs',

  inputs: {
    path: { type: 'string', required: true, description: 'JSON file path (project-relative or absolute)' },
    set: { type: 'object', required: false, description: 'Key-value map to set via dot-paths' },
    merge: { type: 'object', required: false, description: 'Object to deep-merge at root' },
    create: { type: 'boolean', required: false, description: 'Create file if missing (default true)' },
  },

  outputs: {
    path: { type: 'string', description: 'Written file path' },
    size: { type: 'number', description: 'Final byte size' },
  },

  risk: 'medium',
  cost: 'cheap',
  minTrustLevel: 'supervised_auto',
  requiresApproval: true,
  allowedDirectories: ['memory/', 'out/', 'logs/', 'etc/'],
}

export async function execute(inputs: {
  path: string
  set?: Record<string, any>
  merge?: Record<string, any>
  create?: boolean
}): Promise<SkillResult> {
  const abs = path.isAbsolute(inputs.path) ? path.resolve(inputs.path) : path.resolve(paths.root, inputs.path)
  if (!isPathAllowed(abs, manifest.allowedDirectories!)) return { success: false, error: `Path not allowed: ${abs}` }
  if (!isWriteAllowed(abs)) return { success: false, error: `Write not allowed: ${abs}` }

  const shouldCreate = inputs.create ?? true
  let data: any = {}
  if (fs.existsSync(abs)) {
    try { data = JSON.parse(fs.readFileSync(abs, 'utf-8')) } catch { data = {} }
  } else if (!shouldCreate) {
    return { success: false, error: `File not found: ${abs}` }
  }

  if (inputs.merge && typeof inputs.merge === 'object') {
    data = { ...data, ...inputs.merge }
  }
  if (inputs.set && typeof inputs.set === 'object') {
    for (const [k, v] of Object.entries(inputs.set)) setPath(data, k, v)
  }

  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, JSON.stringify(data, null, 2))
  const size = fs.statSync(abs).size
  return { success: true, outputs: { path: abs, size } }
}

