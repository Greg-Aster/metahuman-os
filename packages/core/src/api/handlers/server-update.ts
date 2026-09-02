/**
 * Owner-authorized server update transport.
 *
 * GET checks the configured upstream without converting transport failures into
 * an "up to date" result. POST permits one fast-forward update at a time and
 * reports success only after dependencies and the production build complete.
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import { systemPaths } from '../../paths.js'
import type { UnifiedRequest, UnifiedResponse } from '../types.js'
import { successResponse } from '../types.js'

const execFileAsync = promisify(execFile)
const COMMAND_BUFFER_LIMIT = 10 * 1024 * 1024

let audit: typeof import('../../audit.js').audit | null = null
let updateInProgress = false

async function ensureAudit(): Promise<void> {
  if (!audit) {
    const module = await import('../../audit.js')
    audit = module.audit
  }
}

export interface ServerUpdateDependencies {
  gitDirectoryExists(): boolean
  getPackageVersion(): string
  runGit(args: string[]): Promise<string>
  runPnpm(args: string[], timeoutMs: number): Promise<string>
}

async function runCommand(command: string, args: string[], timeoutMs: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd: systemPaths.root,
      encoding: 'utf8',
      maxBuffer: COMMAND_BUFFER_LIMIT,
      timeout: timeoutMs,
    })
    return String(stdout).trim()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`)
  }
}

function readPackageVersion(): string {
  const packagePath = path.join(systemPaths.root, 'package.json')
  const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown }
  if (typeof parsed.version !== 'string' || parsed.version.trim().length === 0) {
    throw new Error('Root package.json must contain a non-empty version')
  }
  return parsed.version.trim()
}

const DEFAULT_DEPENDENCIES: ServerUpdateDependencies = {
  gitDirectoryExists: () => existsSync(path.join(systemPaths.root, '.git')),
  getPackageVersion: readPackageVersion,
  runGit: args => runCommand('git', args, 30_000),
  runPnpm: (args, timeoutMs) => runCommand('pnpm', args, timeoutMs),
}

interface GitStatus {
  currentCommit: string
  currentBranch: string
  upstream: string
  remoteCommit: string
  ahead: number
  behind: number
  hasChanges: boolean
}

interface UpdateInfo {
  updateAvailable: boolean
  currentVersion: string
  latestVersion: string
  commitsAhead: number
  commitsBehind: number
  changesSummary: string[]
  canUpdate: boolean
  reason?: string
}

function parseAheadBehind(raw: string): { ahead: number; behind: number } {
  const parts = raw.trim().split(/\s+/)
  if (parts.length !== 2 || parts.some(part => !/^\d+$/.test(part))) {
    throw new Error(`Git returned an invalid ahead/behind count: ${raw}`)
  }
  return { ahead: Number(parts[0]), behind: Number(parts[1]) }
}

async function getGitStatus(dependencies: ServerUpdateDependencies): Promise<GitStatus> {
  const currentCommit = await dependencies.runGit(['rev-parse', 'HEAD'])
  const currentBranch = await dependencies.runGit(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (currentBranch === 'HEAD') {
    throw new Error('Server updates require a checked-out branch, not detached HEAD')
  }

  const upstream = await dependencies.runGit([
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ])
  const hasChanges = (await dependencies.runGit(['status', '--porcelain'])).length > 0

  await dependencies.runGit(['fetch', '--quiet'])
  const remoteCommit = await dependencies.runGit(['rev-parse', upstream])
  const { ahead, behind } = parseAheadBehind(
    await dependencies.runGit(['rev-list', '--left-right', '--count', `HEAD...${upstream}`]),
  )

  return {
    currentCommit,
    currentBranch,
    upstream,
    remoteCommit,
    ahead,
    behind,
    hasChanges,
  }
}

async function getChangesSummary(
  dependencies: ServerUpdateDependencies,
  gitStatus: GitStatus,
): Promise<string[]> {
  if (gitStatus.behind === 0) return []
  const logs = await dependencies.runGit([
    'log',
    '--oneline',
    `HEAD..${gitStatus.upstream}`,
    '-10',
  ])
  return logs.split('\n').map(line => line.trim()).filter(Boolean)
}

function containsDependencyChanges(changedFiles: string[]): boolean {
  return changedFiles.some(file => file === 'pnpm-lock.yaml' || file.endsWith('/package.json') || file === 'package.json')
}

function actorFor(req: UnifiedRequest): string {
  return req.user?.username || 'system'
}

export async function handleGetServerUpdate(
  req: UnifiedRequest,
  dependencies: ServerUpdateDependencies = DEFAULT_DEPENDENCIES,
): Promise<UnifiedResponse> {
  await ensureAudit()

  try {
    if (!dependencies.gitDirectoryExists()) {
      return successResponse({
        updateAvailable: false,
        currentVersion: dependencies.getPackageVersion(),
        latestVersion: null,
        commitsAhead: 0,
        commitsBehind: 0,
        changesSummary: [],
        canUpdate: false,
        reason: 'Not a git repository - updates must be performed by the installation owner',
      })
    }

    const gitStatus = await getGitStatus(dependencies)
    const hasDiverged = gitStatus.ahead > 0 && gitStatus.behind > 0
    const response: UpdateInfo = {
      updateAvailable: gitStatus.behind > 0,
      currentVersion: `${dependencies.getPackageVersion()} (${gitStatus.currentCommit.slice(0, 7)})`,
      latestVersion: gitStatus.remoteCommit.slice(0, 7),
      commitsAhead: gitStatus.ahead,
      commitsBehind: gitStatus.behind,
      changesSummary: await getChangesSummary(dependencies, gitStatus),
      canUpdate: !gitStatus.hasChanges && gitStatus.behind > 0 && gitStatus.ahead === 0,
      reason: gitStatus.hasChanges
        ? 'Local changes detected - commit or stash before updating'
        : hasDiverged
          ? 'Local branch has diverged from its upstream - resolve the branch before updating'
        : gitStatus.behind === 0
          ? gitStatus.ahead > 0
            ? 'Local branch is ahead of its upstream'
            : 'Already up to date'
          : undefined,
    }

    audit?.({
      event: 'server_update_check',
      category: 'system',
      level: 'info',
      actor: actorFor(req),
      details: {
        updateAvailable: response.updateAvailable,
        commitsBehind: response.commitsBehind,
      },
    })

    return successResponse(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to check for updates'
    console.error('[server-update] Check failed:', error)
    audit?.({
      event: 'server_update_check_failed',
      category: 'system',
      level: 'error',
      actor: actorFor(req),
      details: { error: message },
    })
    return { status: 500, error: message }
  }
}

async function performServerUpdate(
  req: UnifiedRequest,
  dependencies: ServerUpdateDependencies,
): Promise<UnifiedResponse> {
  let repositoryUpdated = false

  try {
    if (!dependencies.gitDirectoryExists()) {
      return { status: 400, error: 'Not a git repository - updates must be performed by the installation owner' }
    }

    const gitStatus = await getGitStatus(dependencies)
    if (gitStatus.hasChanges) {
      return { status: 400, error: 'Local changes detected - commit or stash before updating' }
    }
    if (gitStatus.ahead > 0 && gitStatus.behind > 0) {
      return { status: 409, error: 'Local branch has diverged from its upstream - resolve the branch before updating' }
    }
    if (gitStatus.behind === 0) {
      return successResponse({
        success: true,
        message: 'Already up to date',
        restarting: false,
        restartRequired: false,
      })
    }

    audit?.({
      event: 'server_update_started',
      category: 'system',
      level: 'warn',
      actor: actorFor(req),
      details: {
        fromCommit: gitStatus.currentCommit.slice(0, 7),
        commitsBehind: gitStatus.behind,
      },
    })

    const pullOutput = await dependencies.runGit(['pull', '--ff-only'])
    repositoryUpdated = true

    const changedFiles = (await dependencies.runGit([
      'diff',
      '--name-only',
      `${gitStatus.currentCommit}..HEAD`,
    ])).split('\n').map(file => file.trim()).filter(Boolean)
    const needsPnpmInstall = containsDependencyChanges(changedFiles)

    if (needsPnpmInstall) {
      await dependencies.runPnpm(['install'], 120_000)
    }
    await dependencies.runPnpm(['build'], 15 * 60_000)

    const newCommit = await dependencies.runGit(['rev-parse', 'HEAD'])
    audit?.({
      event: 'server_update_completed',
      category: 'system',
      level: 'info',
      actor: actorFor(req),
      details: {
        fromCommit: gitStatus.currentCommit.slice(0, 7),
        toCommit: newCommit.slice(0, 7),
        needsPnpmInstall,
      },
    })

    return successResponse({
      success: true,
      message: 'Update built successfully',
      previousCommit: gitStatus.currentCommit.slice(0, 7),
      newCommit: newCommit.slice(0, 7),
      pullOutput,
      needsPnpmInstall,
      restarting: false,
      restartRequired: true,
      restartMessage: 'Restart the server to activate the validated build',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Update failed'
    console.error('[server-update] Update failed:', error)
    audit?.({
      event: 'server_update_failed',
      category: 'system',
      level: 'error',
      actor: actorFor(req),
      details: { error: message, repositoryUpdated },
    })
    return {
      status: 500,
      error: message,
      data: { repositoryUpdated },
    }
  }
}

export async function handlePostServerUpdate(
  req: UnifiedRequest,
  dependencies: ServerUpdateDependencies = DEFAULT_DEPENDENCIES,
): Promise<UnifiedResponse> {
  await ensureAudit()
  if (updateInProgress) {
    return { status: 409, error: 'A server update is already in progress' }
  }

  updateInProgress = true
  try {
    return await performServerUpdate(req, dependencies)
  } finally {
    updateInProgress = false
  }
}

/**
 * Restart through the canonical repository launcher after the current process
 * has exited and released its startup lock.
 */
export async function handleRestartServer(req: UnifiedRequest): Promise<UnifiedResponse> {
  await ensureAudit()

  audit?.({
    event: 'server_restart_requested',
    category: 'system',
    level: 'warn',
    actor: actorFor(req),
    details: {},
  })

  try {
    const child = spawn('bash', ['-c', 'sleep 2; exec ./start.sh'], {
      cwd: systemPaths.root,
      detached: true,
      stdio: 'ignore',
    })
    child.unref()

    const response = successResponse({
      success: true,
      message: 'Server will restart in 2 seconds',
    })

    setTimeout(() => {
      console.log('[server-update] Exiting for restart...')
      process.exit(0)
    }, 500)

    return response
  } catch (error) {
    console.error('[server-update] Restart failed:', error)
    return {
      status: 500,
      error: error instanceof Error ? error.message : 'Failed to initiate restart',
    }
  }
}
