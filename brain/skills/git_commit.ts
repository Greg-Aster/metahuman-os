/**
 * git_commit Skill
 * Commit staged changes (or paths) with a message. Requires explicit confirm.
 */

import { spawnSync } from 'node:child_process'
import { paths } from '../../packages/core/src/paths'
import { SkillManifest, SkillResult } from '../../packages/core/src/skills'

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { cwd: paths.root })
  return { status: r.status ?? 0, stdout: (r.stdout?.toString() || '').trim(), stderr: (r.stderr?.toString() || '').trim() }
}

export const manifest: SkillManifest = {
  id: 'git_commit',
  name: 'Git Commit',
  description: 'Commit changes with a message (approval required)',
  category: 'agent',

  inputs: {
    message: { type: 'string', required: true, description: 'Commit message' },
    paths: { type: 'array', required: false, description: 'Paths to add before committing' },
    confirm: { type: 'boolean', required: false, description: 'Must be true to actually commit' },
    dryRun: { type: 'boolean', required: false, description: 'Show what would be committed (default true)' },
  },

  outputs: {
    result: { type: 'string', description: 'Git output' },
    committed: { type: 'boolean', description: 'True if a commit was made' },
  },

  risk: 'high',
  cost: 'cheap',
  minTrustLevel: 'supervised_auto',
  requiresApproval: true,
}

export async function execute(inputs: { message: string, paths?: string[], confirm?: boolean, dryRun?: boolean }): Promise<SkillResult> {
  const dryRun = inputs.dryRun ?? true
  if (!inputs.message || !inputs.message.trim()) return { success: false, error: 'Commit message required' }
  if (inputs.paths && inputs.paths.length) {
    const add = run('git', ['add', ...inputs.paths])
    if (add.status !== 0) return { success: false, error: add.stderr || 'git add failed' }
  }
  if (dryRun || !inputs.confirm) {
    const diff = run('git', ['diff', '--staged', '--name-status'])
    return { success: true, outputs: { result: diff.stdout || '(no staged changes)', committed: false } }
  }
  const commit = run('git', ['commit', '-m', inputs.message])
  if (commit.status !== 0) return { success: false, error: commit.stderr || 'git commit failed' }
  return { success: true, outputs: { result: commit.stdout, committed: true } }
}

