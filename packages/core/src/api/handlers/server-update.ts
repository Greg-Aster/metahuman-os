/**
 * Server Update API Handler
 *
 * GET - Check for available updates (git fetch + compare)
 * POST - Perform update (git pull + restart)
 *
 * Works for web server (desktop) deployments using git.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { systemPaths } from '../../paths.js';

const execAsync = promisify(exec);

// Dynamic import for audit
let audit: typeof import('../../audit.js').audit | null = null;

async function ensureAudit(): Promise<void> {
  if (!audit) {
    const module = await import('../../audit.js');
    audit = module.audit;
  }
}

interface GitStatus {
  currentCommit: string;
  currentBranch: string;
  remoteCommit: string | null;
  ahead: number;
  behind: number;
  hasChanges: boolean;
  lastFetchTime: string | null;
}

interface UpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string | null;
  commitsAhead: number;
  commitsBehind: number;
  changesSummary: string[];
  canUpdate: boolean;
  reason?: string;
}

/**
 * Run a git command in the project root
 */
async function runGitCommand(command: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`git ${command}`, {
      cwd: systemPaths.root,
      timeout: 30000,
    });
    return stdout.trim();
  } catch (error: any) {
    throw new Error(`Git command failed: ${error.message}`);
  }
}

/**
 * Get current git status
 */
async function getGitStatus(): Promise<GitStatus> {
  const currentCommit = await runGitCommand('rev-parse HEAD');
  const currentBranch = await runGitCommand('rev-parse --abbrev-ref HEAD');

  // Check for local changes
  const status = await runGitCommand('status --porcelain');
  const hasChanges = status.length > 0;

  // Get remote tracking branch
  let remoteCommit: string | null = null;
  let ahead = 0;
  let behind = 0;

  try {
    // Fetch to get latest remote info (with timeout)
    await runGitCommand('fetch --quiet');

    const remoteBranch = `origin/${currentBranch}`;
    remoteCommit = await runGitCommand(`rev-parse ${remoteBranch}`);

    // Count commits ahead/behind
    const aheadBehind = await runGitCommand(`rev-list --left-right --count HEAD...${remoteBranch}`);
    const [aheadStr, behindStr] = aheadBehind.split(/\s+/);
    ahead = parseInt(aheadStr, 10) || 0;
    behind = parseInt(behindStr, 10) || 0;
  } catch {
    // No remote tracking or fetch failed
  }

  return {
    currentCommit,
    currentBranch,
    remoteCommit,
    ahead,
    behind,
    hasChanges,
    lastFetchTime: new Date().toISOString(),
  };
}

/**
 * Get version from package.json
 */
function getPackageVersion(): string {
  try {
    const packagePath = path.join(systemPaths.root, 'package.json');
    if (existsSync(packagePath)) {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
      return pkg.version || '0.0.0';
    }
  } catch {
    // Ignore errors
  }
  return '0.0.0';
}

/**
 * GET /api/server-update - Check for available updates
 */
export async function handleGetServerUpdate(req: UnifiedRequest): Promise<UnifiedResponse> {
  await ensureAudit();

  try {
    // Check if this is a git repository
    const gitDir = path.join(systemPaths.root, '.git');
    if (!existsSync(gitDir)) {
      return successResponse({
        updateAvailable: false,
        currentVersion: getPackageVersion(),
        latestVersion: null,
        commitsAhead: 0,
        commitsBehind: 0,
        changesSummary: [],
        canUpdate: false,
        reason: 'Not a git repository - updates must be done manually',
      } as UpdateInfo);
    }

    const gitStatus = await getGitStatus();

    // Get commit summaries for pending updates
    const changesSummary: string[] = [];
    if (gitStatus.behind > 0) {
      try {
        const logs = await runGitCommand(
          `log --oneline HEAD..origin/${gitStatus.currentBranch} -10`
        );
        changesSummary.push(...logs.split('\n').filter(Boolean));
      } catch {
        // Ignore errors getting commit summaries
      }
    }

    const response: UpdateInfo = {
      updateAvailable: gitStatus.behind > 0,
      currentVersion: `${getPackageVersion()} (${gitStatus.currentCommit.substring(0, 7)})`,
      latestVersion: gitStatus.remoteCommit
        ? `${gitStatus.remoteCommit.substring(0, 7)}`
        : null,
      commitsAhead: gitStatus.ahead,
      commitsBehind: gitStatus.behind,
      changesSummary,
      canUpdate: !gitStatus.hasChanges && gitStatus.behind > 0,
      reason: gitStatus.hasChanges
        ? 'Local changes detected - commit or stash before updating'
        : gitStatus.behind === 0
          ? 'Already up to date'
          : undefined,
    };

    if (audit) {
      audit({
        event: 'server_update_check',
        category: 'system',
        level: 'info',
        actor: req.user?.username || 'system',
        details: {
          updateAvailable: response.updateAvailable,
          commitsBehind: response.commitsBehind,
        },
      });
    }

    return successResponse(response);
  } catch (error) {
    console.error('[server-update] Check failed:', error);
    return {
      status: 500,
      error: (error as Error).message || 'Failed to check for updates',
    };
  }
}

/**
 * POST /api/server-update - Perform update (git pull)
 */
export async function handlePostServerUpdate(req: UnifiedRequest): Promise<UnifiedResponse> {
  await ensureAudit();

  try {
    // Check if this is a git repository
    const gitDir = path.join(systemPaths.root, '.git');
    if (!existsSync(gitDir)) {
      return {
        status: 400,
        error: 'Not a git repository - updates must be done manually',
      };
    }

    const gitStatus = await getGitStatus();

    // Don't update if there are local changes
    if (gitStatus.hasChanges) {
      return {
        status: 400,
        error: 'Local changes detected - commit or stash before updating',
      };
    }

    // Don't update if already up to date
    if (gitStatus.behind === 0) {
      return successResponse({
        success: true,
        message: 'Already up to date',
        restarting: false,
      });
    }

    if (audit) {
      audit({
        event: 'server_update_started',
        category: 'system',
        level: 'warn',
        actor: req.user?.username || 'system',
        details: {
          fromCommit: gitStatus.currentCommit.substring(0, 7),
          commitsBehind: gitStatus.behind,
        },
      });
    }

    // Perform git pull
    const pullOutput = await runGitCommand('pull --ff-only');

    // Check if dependencies need updating
    let needsPnpmInstall = false;
    try {
      const changedFiles = await runGitCommand(
        `diff --name-only ${gitStatus.currentCommit}..HEAD`
      );
      needsPnpmInstall = changedFiles.includes('package.json') ||
        changedFiles.includes('pnpm-lock.yaml');
    } catch {
      // Assume we need to install just in case
      needsPnpmInstall = true;
    }

    // Run pnpm install if needed
    if (needsPnpmInstall) {
      try {
        await execAsync('pnpm install', {
          cwd: systemPaths.root,
          timeout: 120000,
        });
      } catch (e) {
        console.warn('[server-update] pnpm install warning:', e);
      }
    }

    if (audit) {
      audit({
        event: 'server_update_completed',
        category: 'system',
        level: 'info',
        actor: req.user?.username || 'system',
        details: {
          pullOutput: pullOutput.substring(0, 500),
          needsPnpmInstall,
        },
      });
    }

    const newCommit = await runGitCommand('rev-parse HEAD');

    // Return success - restart should be handled separately
    return successResponse({
      success: true,
      message: 'Update successful',
      previousCommit: gitStatus.currentCommit.substring(0, 7),
      newCommit: newCommit.substring(0, 7),
      pullOutput,
      needsPnpmInstall,
      restarting: false,
      restartMessage: 'Please restart the server to apply changes: ./start.sh',
    });
  } catch (error) {
    console.error('[server-update] Update failed:', error);

    if (audit) {
      audit({
        event: 'server_update_failed',
        category: 'system',
        level: 'error',
        actor: req.user?.username || 'system',
        details: {
          error: (error as Error).message,
        },
      });
    }

    return {
      status: 500,
      error: (error as Error).message || 'Update failed',
    };
  }
}

/**
 * POST /api/server-update/restart - Restart the server
 *
 * This spawns a detached restart script that:
 * 1. Waits for current process to exit
 * 2. Starts new server process
 */
export async function handleRestartServer(req: UnifiedRequest): Promise<UnifiedResponse> {
  await ensureAudit();

  if (audit) {
    audit({
      event: 'server_restart_requested',
      category: 'system',
      level: 'warn',
      actor: req.user?.username || 'system',
      details: {},
    });
  }

  // Create a simple restart script
  const restartScript = `
    sleep 2
    cd "${systemPaths.root}"
    ./start.sh
  `;

  try {
    // Spawn detached process to restart
    const child = spawn('bash', ['-c', restartScript], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    // Send response before exiting
    const response = successResponse({
      success: true,
      message: 'Server will restart in 2 seconds',
    });

    // Schedule exit after response is sent
    setTimeout(() => {
      console.log('[server-update] Exiting for restart...');
      process.exit(0);
    }, 500);

    return response;
  } catch (error) {
    console.error('[server-update] Restart failed:', error);
    return {
      status: 500,
      error: (error as Error).message || 'Failed to initiate restart',
    };
  }
}
