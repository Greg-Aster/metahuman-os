/**
 * Update Check Agent — Core Logic
 *
 * For desktop/server: Checks git remote for new commits
 * For mobile: Checks remote server for new APK version
 */

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { audit, auditAction, systemPaths } from '@metahuman/core';

const execAsync = promisify(exec);

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface UpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string | null;
  commitsBehind: number;
  changesSummary: string[];
  canUpdate: boolean;
  reason?: string;
  checkedAt: string;
}

export interface MobileUpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  currentVersionCode: number;
  latestVersion: string | null;
  latestVersionCode: number | null;
  releaseNotes: string | null;
  downloadUrl: string | null;
  checkedAt: string;
}

export interface UpdateCheckOptions {
  mobile?: boolean;
  serverUrl?: string;
  versionCode?: number;
}

// ─────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────

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

function getPackageVersion(): string {
  try {
    const packagePath = path.join(systemPaths.root, 'package.json');
    if (fs.existsSync(packagePath)) {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      return pkg.version || '0.0.0';
    }
  } catch {
    // Ignore errors
  }
  return '0.0.0';
}

// ─────────────────────────────────────────────────────────────
// Core Update Check Logic
// ─────────────────────────────────────────────────────────────

/**
 * Check for server/desktop updates via git
 */
export async function checkGitUpdates(): Promise<UpdateInfo> {
  const checkedAt = new Date().toISOString();

  const gitDir = path.join(systemPaths.root, '.git');
  if (!fs.existsSync(gitDir)) {
    return {
      updateAvailable: false,
      currentVersion: getPackageVersion(),
      latestVersion: null,
      commitsBehind: 0,
      changesSummary: [],
      canUpdate: false,
      reason: 'Not a git repository - updates must be done manually',
      checkedAt,
    };
  }

  try {
    const currentCommit = await runGitCommand('rev-parse HEAD');
    const currentBranch = await runGitCommand('rev-parse --abbrev-ref HEAD');
    const status = await runGitCommand('status --porcelain');
    const hasChanges = status.length > 0;

    let remoteCommit: string | null = null;
    let behind = 0;

    try {
      await runGitCommand('fetch --quiet');
      const remoteBranch = `origin/${currentBranch}`;
      remoteCommit = await runGitCommand(`rev-parse ${remoteBranch}`);

      const aheadBehind = await runGitCommand(`rev-list --left-right --count HEAD...${remoteBranch}`);
      const [, behindStr] = aheadBehind.split(/\s+/);
      behind = parseInt(behindStr, 10) || 0;
    } catch {
      // No remote tracking or fetch failed
    }

    const changesSummary: string[] = [];
    if (behind > 0) {
      try {
        const logs = await runGitCommand(
          `log --oneline HEAD..origin/${currentBranch} -10`
        );
        changesSummary.push(...logs.split('\n').filter(Boolean));
      } catch {
        // Ignore errors getting commit summaries
      }
    }

    return {
      updateAvailable: behind > 0,
      currentVersion: `${getPackageVersion()} (${currentCommit.substring(0, 7)})`,
      latestVersion: remoteCommit ? `${remoteCommit.substring(0, 7)}` : null,
      commitsBehind: behind,
      changesSummary,
      canUpdate: !hasChanges && behind > 0,
      reason: hasChanges
        ? 'Local changes detected - commit or stash before updating'
        : behind === 0
          ? 'Already up to date'
          : undefined,
      checkedAt,
    };
  } catch (error) {
    return {
      updateAvailable: false,
      currentVersion: getPackageVersion(),
      latestVersion: null,
      commitsBehind: 0,
      changesSummary: [],
      canUpdate: false,
      reason: `Error checking updates: ${(error as Error).message}`,
      checkedAt,
    };
  }
}

/**
 * Check for mobile app updates from a remote server
 */
export async function checkMobileUpdates(serverUrl: string, currentVersionCode: number): Promise<MobileUpdateInfo> {
  const checkedAt = new Date().toISOString();
  const baseUrl = serverUrl.replace(/\/$/, '');

  try {
    const response = await fetch(`${baseUrl}/api/app-version`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const latest = await response.json();
    const updateAvailable = latest.versionCode > currentVersionCode;

    let downloadUrl = latest.downloadUrl || '/downloads/metahuman-os.apk';
    if (downloadUrl.startsWith('/')) {
      downloadUrl = `${baseUrl}${downloadUrl}`;
    }

    return {
      updateAvailable,
      currentVersion: '1.0.0',
      currentVersionCode,
      latestVersion: latest.version,
      latestVersionCode: latest.versionCode,
      releaseNotes: latest.releaseNotes || null,
      downloadUrl,
      checkedAt,
    };
  } catch {
    return {
      updateAvailable: false,
      currentVersion: '1.0.0',
      currentVersionCode,
      latestVersion: null,
      latestVersionCode: null,
      releaseNotes: null,
      downloadUrl: null,
      checkedAt,
    };
  }
}

/**
 * Save update state to file for UI to read
 */
export function saveUpdateState(state: UpdateInfo | MobileUpdateInfo): void {
  const statePath = path.join(systemPaths.root, 'logs', 'run', 'update-state.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Run update check
 */
export async function runUpdateCheck(options: UpdateCheckOptions = {}): Promise<UpdateInfo | MobileUpdateInfo> {
  let result: UpdateInfo | MobileUpdateInfo;

  if (options.mobile && options.serverUrl) {
    result = await checkMobileUpdates(options.serverUrl, options.versionCode || 1);
    console.log(`[update-check] Mobile update check: ${result.updateAvailable ? 'UPDATE AVAILABLE' : 'up to date'}`);
  } else {
    result = await checkGitUpdates();
    console.log(`[update-check] Git update check: ${(result as UpdateInfo).commitsBehind} commits behind`);
  }

  saveUpdateState(result);
  return result;
}

// ─────────────────────────────────────────────────────────────
// Agent Runtime Entry Point
// ─────────────────────────────────────────────────────────────

/**
 * Agent runtime entry point for mobile/runtime execution
 */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  const options: UpdateCheckOptions = {
    mobile: args.includes('--mobile') || opts.mobile === true,
    serverUrl: args.find(a => a.startsWith('--server='))?.split('=')[1] || opts.serverUrl as string,
    versionCode: parseInt(args.find(a => a.startsWith('--version-code='))?.split('=')[1] || '1', 10),
  };

  audit({
    level: 'info',
    category: 'action',
    event: 'agent_cycle_started',
    details: { agent: 'update-check', mode: options.mobile ? 'mobile' : 'git' },
    actor: 'agent',
  });

  try {
    const result = await runUpdateCheck(options);

    if (result.updateAvailable) {
      console.log(`[update-check] Update available: ${result.currentVersion} -> ${result.latestVersion}`);
    } else {
      console.log(`[update-check] Current version ${result.currentVersion} is up to date`);
    }

    audit({
      level: 'info',
      category: 'action',
      event: 'agent_cycle_completed',
      details: {
        agent: 'update-check',
        updateAvailable: result.updateAvailable,
        currentVersion: result.currentVersion,
        latestVersion: result.latestVersion,
      },
      actor: 'agent',
    });

    auditAction({
      skill: 'update-check',
      inputs: { mode: options.mobile ? 'mobile' : 'git' },
      success: true,
      output: {
        updateAvailable: result.updateAvailable,
        currentVersion: result.currentVersion,
        latestVersion: result.latestVersion,
      },
    });

    return {
      success: true,
      data: result,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    audit({
      level: 'error',
      category: 'action',
      event: 'agent_cycle_failed',
      details: { agent: 'update-check', error: (error as Error).message },
      actor: 'agent',
    });

    return {
      success: false,
      error: (error as Error).message,
      durationMs: Date.now() - startTime,
    };
  }
}
