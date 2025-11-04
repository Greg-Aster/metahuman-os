/**
 * git_status Skill
 * Show repository status (branch, porcelain, last commit)
 */

import { spawnSync } from 'node:child_process'
import { paths } from '../../packages/core/src/paths'
import { SkillManifest, SkillResult } from '../../packages/core/src/skills'

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { cwd: paths.root })
  return { status: r.status ?? 0, stdout: (r.stdout?.toString() || '').trim(), stderr: (r.stderr?.toString() || '').trim() }
}

export const manifest: SkillManifest = {
  id: 'git_status',
  name: 'Git Status',
  description: 'Show repo status safely (read-only)',
  category: 'memory',

  inputs: {},

  outputs: {
    branch: { type: 'string', description: 'Current branch' },
    porcelain: { type: 'string', description: 'Porcelain status' },
    lastCommit: { type: 'string', description: 'Last commit oneline' },
  },

  risk: 'low',
  cost: 'free',
  minTrustLevel: 'observe',
  requiresApproval: false,
}

export async function execute(): Promise<SkillResult> {
  const b = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
  const s = run('git', ['status', '--porcelain'])
  const l = run('git', ['log', '-1', '--oneline'])
  if (b.status !== 0) return { success: false, error: b.stderr || 'git branch failed' }
  return { success: true, outputs: { branch: b.stdout, porcelain: s.stdout, lastCommit: l.stdout } }
}

