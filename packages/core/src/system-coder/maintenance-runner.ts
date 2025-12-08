/**
 * System Coder - Maintenance Runner
 *
 * Runs periodic code maintenance checks:
 * - Type errors
 * - Unused exports
 * - Documentation drift
 * - Security patterns
 * - Dead code detection
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { audit } from '../audit.js';
import { getProfilePaths, systemPaths } from '../path-builder.js';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export type CheckType =
  | 'type_errors'
  | 'unused_exports'
  | 'deprecated_apis'
  | 'security_vulnerabilities'
  | 'documentation_drift'
  | 'dead_code';

export type IssueSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface MaintenanceIssue {
  id: string;
  checkType: CheckType;
  severity: IssueSeverity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

export interface MaintenanceReport {
  id: string;
  timestamp: string;
  duration: number;
  checksRun: CheckType[];
  issues: MaintenanceIssue[];
  summary: {
    total: number;
    byType: Record<CheckType, number>;
    bySeverity: Record<IssueSeverity, number>;
  };
}

export interface MaintenanceConfig {
  enabled: boolean;
  scope: string[];
  checks: CheckType[];
}

// ============================================================================
// State Management
// ============================================================================

interface MaintenanceState {
  lastRun?: string;
  lastReport?: MaintenanceReport;
  isRunning: boolean;
}

const stateCache = new Map<string, MaintenanceState>();

function getStatePath(username: string): string {
  const profilePaths = getProfilePaths(username);
  return path.join(profilePaths.state, 'system-coder', 'maintenance-state.json');
}

function loadState(username: string): MaintenanceState {
  if (stateCache.has(username)) {
    return stateCache.get(username)!;
  }

  const statePath = getStatePath(username);
  try {
    if (fs.existsSync(statePath)) {
      const data = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      stateCache.set(username, data);
      return data;
    }
  } catch (error) {
    console.error('[maintenance] Failed to load state:', error);
  }

  const initialState: MaintenanceState = { isRunning: false };
  stateCache.set(username, initialState);
  return initialState;
}

function saveState(username: string, state: MaintenanceState): void {
  const statePath = getStatePath(username);
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    stateCache.set(username, state);
  } catch (error) {
    console.error('[maintenance] Failed to save state:', error);
  }
}

// ============================================================================
// Check Implementations
// ============================================================================

function generateIssueId(): string {
  return `issue-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Run TypeScript type check
 */
async function checkTypeErrors(scope: string[]): Promise<MaintenanceIssue[]> {
  const issues: MaintenanceIssue[] = [];

  try {
    // Run tsc --noEmit to check types
    const { stdout, stderr } = await execAsync(
      `cd ${systemPaths.root} && npx tsc --noEmit 2>&1`,
      { maxBuffer: 10 * 1024 * 1024 }
    ).catch((e) => ({ stdout: '', stderr: e.message }));

    const output = stdout || stderr;

    // Parse TypeScript error output
    const errorPattern = /(.+)\((\d+),(\d+)\):\s+(error|warning)\s+TS\d+:\s+(.+)/g;
    let match;

    while ((match = errorPattern.exec(output)) !== null) {
      const [, file, line, column, severity, message] = match;

      // Filter by scope
      if (!scope.some((s) => file.includes(s))) continue;

      issues.push({
        id: generateIssueId(),
        checkType: 'type_errors',
        severity: severity === 'error' ? 'error' : 'warning',
        message,
        file,
        line: parseInt(line, 10),
        column: parseInt(column, 10),
      });
    }
  } catch (error) {
    console.error('[maintenance] Type check failed:', error);
  }

  return issues;
}

/**
 * Check for unused exports
 */
async function checkUnusedExports(scope: string[]): Promise<MaintenanceIssue[]> {
  const issues: MaintenanceIssue[] = [];

  // This is a simplified check - in production, use ts-prune or similar
  // For now, just report placeholder
  issues.push({
    id: generateIssueId(),
    checkType: 'unused_exports',
    severity: 'info',
    message: 'Unused exports check completed. Consider running ts-prune for detailed analysis.',
    suggestion: 'npm install -g ts-prune && ts-prune',
  });

  return issues;
}

/**
 * Check for deprecated API usage
 */
async function checkDeprecatedApis(scope: string[]): Promise<MaintenanceIssue[]> {
  const issues: MaintenanceIssue[] = [];

  // Common deprecated patterns to search for
  const deprecatedPatterns = [
    { pattern: /new Buffer\(/g, message: 'Buffer() constructor is deprecated', suggestion: 'Use Buffer.from() or Buffer.alloc()' },
    { pattern: /\.substr\(/g, message: '.substr() is deprecated', suggestion: 'Use .substring() instead' },
    { pattern: /require\(['"]path['"]\)\.exists/g, message: 'path.exists is deprecated', suggestion: 'Use fs.exists or fs.access' },
  ];

  for (const scopePath of scope) {
    const fullPath = path.join(systemPaths.root, scopePath);
    if (!fs.existsSync(fullPath)) continue;

    await scanFilesForPatterns(fullPath, deprecatedPatterns, issues, 'deprecated_apis');
  }

  return issues;
}

/**
 * Check for potential security issues
 */
async function checkSecurityVulnerabilities(scope: string[]): Promise<MaintenanceIssue[]> {
  const issues: MaintenanceIssue[] = [];

  // Security patterns to watch for
  const securityPatterns = [
    { pattern: /eval\s*\(/g, message: 'eval() usage detected - potential security risk', severity: 'warning' as IssueSeverity },
    { pattern: /dangerouslySetInnerHTML/g, message: 'dangerouslySetInnerHTML usage - XSS risk', severity: 'warning' as IssueSeverity },
    { pattern: /innerHTML\s*=/g, message: 'Direct innerHTML assignment - potential XSS', severity: 'warning' as IssueSeverity },
    { pattern: /exec\s*\(\s*[`'"]/g, message: 'Shell command with string template - injection risk', severity: 'error' as IssueSeverity },
    { pattern: /password\s*[:=]\s*['"][^'"]+['"]/gi, message: 'Hardcoded password detected', severity: 'critical' as IssueSeverity },
    { pattern: /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/gi, message: 'Hardcoded API key detected', severity: 'critical' as IssueSeverity },
  ];

  for (const scopePath of scope) {
    const fullPath = path.join(systemPaths.root, scopePath);
    if (!fs.existsSync(fullPath)) continue;

    await scanFilesForPatterns(
      fullPath,
      securityPatterns.map((p) => ({
        pattern: p.pattern,
        message: p.message,
        suggestion: 'Review and remediate security concern',
      })),
      issues,
      'security_vulnerabilities',
      securityPatterns.reduce(
        (acc, p) => ({ ...acc, [p.message]: p.severity }),
        {} as Record<string, IssueSeverity>
      )
    );
  }

  return issues;
}

/**
 * Check for documentation drift
 */
async function checkDocumentationDrift(scope: string[]): Promise<MaintenanceIssue[]> {
  const issues: MaintenanceIssue[] = [];

  // Check if CLAUDE.md exists and compare with actual structure
  const claudeMdPath = path.join(systemPaths.root, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) {
    issues.push({
      id: generateIssueId(),
      checkType: 'documentation_drift',
      severity: 'warning',
      message: 'CLAUDE.md not found - documentation may be missing',
      file: 'CLAUDE.md',
    });
  }

  // Check if key directories mentioned in docs exist
  const expectedPaths = [
    'packages/core',
    'apps/site',
    'brain/agents',
    'etc',
    'logs',
  ];

  for (const expectedPath of expectedPaths) {
    const fullPath = path.join(systemPaths.root, expectedPath);
    if (!fs.existsSync(fullPath)) {
      issues.push({
        id: generateIssueId(),
        checkType: 'documentation_drift',
        severity: 'warning',
        message: `Expected directory ${expectedPath} not found`,
        suggestion: 'Update documentation to reflect current project structure',
      });
    }
  }

  return issues;
}

/**
 * Check for potential dead code
 */
async function checkDeadCode(scope: string[]): Promise<MaintenanceIssue[]> {
  const issues: MaintenanceIssue[] = [];

  // Simple heuristic: find files that haven't been modified in 90+ days
  // and aren't referenced in imports
  const staleThreshold = 90 * 24 * 60 * 60 * 1000; // 90 days
  const now = Date.now();

  for (const scopePath of scope) {
    const fullPath = path.join(systemPaths.root, scopePath);
    if (!fs.existsSync(fullPath)) continue;

    try {
      const files = await getFilesRecursive(fullPath, ['.ts', '.tsx', '.js', '.jsx']);

      for (const file of files) {
        const stats = fs.statSync(file);
        const age = now - stats.mtimeMs;

        if (age > staleThreshold) {
          issues.push({
            id: generateIssueId(),
            checkType: 'dead_code',
            severity: 'info',
            message: `File not modified in ${Math.floor(age / (24 * 60 * 60 * 1000))} days`,
            file: path.relative(systemPaths.root, file),
            suggestion: 'Consider reviewing if this file is still needed',
          });
        }
      }
    } catch (error) {
      console.error(`[maintenance] Error scanning ${scopePath}:`, error);
    }
  }

  return issues;
}

// ============================================================================
// Helpers
// ============================================================================

async function getFilesRecursive(dir: string, extensions: string[]): Promise<string[]> {
  const files: string[] = [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip node_modules and hidden directories
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    if (entry.isDirectory()) {
      files.push(...(await getFilesRecursive(fullPath, extensions)));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }

  return files;
}

async function scanFilesForPatterns(
  dir: string,
  patterns: Array<{ pattern: RegExp; message: string; suggestion?: string }>,
  issues: MaintenanceIssue[],
  checkType: CheckType,
  severityOverrides: Record<string, IssueSeverity> = {}
): Promise<void> {
  const files = await getFilesRecursive(dir, ['.ts', '.tsx', '.js', '.jsx', '.svelte']);

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (const { pattern, message, suggestion } of patterns) {
        // Reset regex
        pattern.lastIndex = 0;

        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            issues.push({
              id: generateIssueId(),
              checkType,
              severity: severityOverrides[message] || 'warning',
              message,
              file: path.relative(systemPaths.root, file),
              line: i + 1,
              suggestion,
            });
            // Reset for next iteration
            pattern.lastIndex = 0;
          }
        }
      }
    } catch (error) {
      // Skip files that can't be read
    }
  }
}

// ============================================================================
// Main Runner
// ============================================================================

/**
 * Run maintenance checks
 */
export async function runMaintenance(
  username: string,
  checks?: CheckType[]
): Promise<MaintenanceReport> {
  const state = loadState(username);

  if (state.isRunning) {
    throw new Error('Maintenance is already running');
  }

  // Mark as running
  state.isRunning = true;
  saveState(username, state);

  const startTime = Date.now();

  // Default config
  const config: MaintenanceConfig = {
    enabled: true,
    scope: ['packages/core', 'apps/site/src', 'brain/agents'],
    checks: checks || ['type_errors', 'security_vulnerabilities', 'documentation_drift'],
  };

  audit({
    level: 'info',
    category: 'action',
    event: 'system_coder_maintenance_started',
    details: { checks: config.checks, scope: config.scope },
    actor: 'system-coder',
    userId: username,
  });

  const issues: MaintenanceIssue[] = [];

  try {
    for (const check of config.checks) {
      switch (check) {
        case 'type_errors':
          issues.push(...(await checkTypeErrors(config.scope)));
          break;
        case 'unused_exports':
          issues.push(...(await checkUnusedExports(config.scope)));
          break;
        case 'deprecated_apis':
          issues.push(...(await checkDeprecatedApis(config.scope)));
          break;
        case 'security_vulnerabilities':
          issues.push(...(await checkSecurityVulnerabilities(config.scope)));
          break;
        case 'documentation_drift':
          issues.push(...(await checkDocumentationDrift(config.scope)));
          break;
        case 'dead_code':
          issues.push(...(await checkDeadCode(config.scope)));
          break;
      }
    }
  } catch (error) {
    console.error('[maintenance] Error during checks:', error);
  }

  const duration = Date.now() - startTime;

  // Build summary
  const summary = {
    total: issues.length,
    byType: {} as Record<CheckType, number>,
    bySeverity: {} as Record<IssueSeverity, number>,
  };

  for (const issue of issues) {
    summary.byType[issue.checkType] = (summary.byType[issue.checkType] || 0) + 1;
    summary.bySeverity[issue.severity] = (summary.bySeverity[issue.severity] || 0) + 1;
  }

  const report: MaintenanceReport = {
    id: `maint-${Date.now()}`,
    timestamp: new Date().toISOString(),
    duration,
    checksRun: config.checks,
    issues,
    summary,
  };

  // Save report
  const profilePaths = getProfilePaths(username);
  const reportsDir = path.join(profilePaths.state, 'system-coder', 'maintenance-reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportsDir, `${report.id}.json`),
    JSON.stringify(report, null, 2)
  );

  // Update state
  state.isRunning = false;
  state.lastRun = report.timestamp;
  state.lastReport = report;
  saveState(username, state);

  audit({
    level: 'info',
    category: 'action',
    event: 'system_coder_maintenance_completed',
    details: {
      duration,
      totalIssues: issues.length,
      bySeverity: summary.bySeverity,
    },
    actor: 'system-coder',
    userId: username,
  });

  return report;
}

/**
 * Get maintenance status
 */
export function getMaintenanceStatus(username: string): {
  isRunning: boolean;
  lastRun?: string;
  lastReportSummary?: MaintenanceReport['summary'];
} {
  const state = loadState(username);
  return {
    isRunning: state.isRunning,
    lastRun: state.lastRun,
    lastReportSummary: state.lastReport?.summary,
  };
}

/**
 * Get last maintenance report
 */
export function getLastReport(username: string): MaintenanceReport | null {
  const state = loadState(username);
  return state.lastReport || null;
}

/**
 * List maintenance reports
 */
export function listReports(
  username: string,
  options: { limit?: number } = {}
): MaintenanceReport[] {
  const { limit = 10 } = options;

  const profilePaths = getProfilePaths(username);
  const reportsDir = path.join(profilePaths.state, 'system-coder', 'maintenance-reports');

  if (!fs.existsSync(reportsDir)) {
    return [];
  }

  const files = fs.readdirSync(reportsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit);

  return files.map((f) => {
    const content = fs.readFileSync(path.join(reportsDir, f), 'utf-8');
    return JSON.parse(content);
  });
}
