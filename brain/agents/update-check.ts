#!/usr/bin/env node
/**
 * Update Check Agent — Background check for software updates
 *
 * For desktop/server deployments:
 * - Checks git remote for new commits
 * - Reports available updates
 *
 * For mobile:
 * - Checks remote server for new APK version
 * - Notifies user of available updates
 *
 * Triggered by:
 * - Manual trigger via UI
 * - Scheduled interval (e.g., daily)
 * - Login event
 */

import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  audit,
  auditAction,
  acquireLock,
  isLocked,
  initGlobalLogger,
  systemPaths,
} from '@metahuman/core';

const execAsync = promisify(exec);

interface UpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string | null;
  commitsBehind: number;
  changesSummary: string[];
  canUpdate: boolean;
  reason?: string;
  checkedAt: string;
}

interface MobileUpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  currentVersionCode: number;
  latestVersion: string | null;
  latestVersionCode: number | null;
  releaseNotes: string | null;
  downloadUrl: string | null;
  checkedAt: string;
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
 * Get package version from package.json
 */
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

/**
 * Check for server/desktop updates via git
 */
async function checkGitUpdates(): Promise<UpdateInfo> {
  const checkedAt = new Date().toISOString();

  // Check if this is a git repository
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
    // Get current state
    const currentCommit = await runGitCommand('rev-parse HEAD');
    const currentBranch = await runGitCommand('rev-parse --abbrev-ref HEAD');

    // Check for local changes
    const status = await runGitCommand('status --porcelain');
    const hasChanges = status.length > 0;

    // Fetch from remote
    let remoteCommit: string | null = null;
    let behind = 0;
    let ahead = 0;

    try {
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

    // Get commit summaries for pending updates
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
      latestVersion: remoteCommit
        ? `${remoteCommit.substring(0, 7)}`
        : null,
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
async function checkMobileUpdates(serverUrl: string, currentVersionCode: number): Promise<MobileUpdateInfo> {
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

    // Build absolute download URL
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
  } catch (error) {
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
function saveUpdateState(state: UpdateInfo | MobileUpdateInfo): void {
  const statePath = path.join(systemPaths.root, 'logs', 'run', 'update-state.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Main agent entry point
 */
async function main() {
  initGlobalLogger('update-check');

  // Parse command line args
  const args = process.argv.slice(2);
  const isMobile = args.includes('--mobile');
  const serverUrl = args.find(a => a.startsWith('--server='))?.split('=')[1];
  const versionCode = parseInt(args.find(a => a.startsWith('--version-code='))?.split('=')[1] || '1', 10);

  // Single-instance guard
  let lock;
  try {
    if (isLocked('agent-update-check')) {
      console.log('[update-check] Another instance is already running. Exiting.');
      return;
    }
    lock = acquireLock('agent-update-check');
  } catch {
    console.log('[update-check] Failed to acquire lock. Exiting.');
    return;
  }

  try {
    console.log('[update-check] Checking for updates...');

    // Audit cycle start
    audit({
      level: 'info',
      category: 'action',
      event: 'agent_cycle_started',
      details: { agent: 'update-check', mode: isMobile ? 'mobile' : 'git' },
      actor: 'agent',
    });

    let result: UpdateInfo | MobileUpdateInfo;

    if (isMobile && serverUrl) {
      // Mobile: check remote server for APK updates
      result = await checkMobileUpdates(serverUrl, versionCode);
      console.log(`[update-check] Mobile update check: ${result.updateAvailable ? 'UPDATE AVAILABLE' : 'up to date'}`);
    } else {
      // Desktop/server: check git for updates
      result = await checkGitUpdates();
      console.log(`[update-check] Git update check: ${(result as UpdateInfo).commitsBehind} commits behind`);
    }

    // Save state for UI
    saveUpdateState(result);

    // Log result
    if (result.updateAvailable) {
      console.log(`[update-check] Update available: ${result.currentVersion} -> ${result.latestVersion}`);
    } else {
      console.log(`[update-check] Current version ${result.currentVersion} is up to date`);
    }

    // Audit completion
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
      inputs: { mode: isMobile ? 'mobile' : 'git' },
      success: true,
      output: {
        updateAvailable: result.updateAvailable,
        currentVersion: result.currentVersion,
        latestVersion: result.latestVersion,
      },
    });

  } catch (error) {
    console.error('[update-check] Error during check:', (error as Error).message);
    audit({
      level: 'error',
      category: 'action',
      event: 'agent_cycle_failed',
      details: { agent: 'update-check', error: (error as Error).message },
      actor: 'agent',
    });
  } finally {
    lock.release();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
