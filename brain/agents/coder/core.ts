/**
 * System Coder Agent — Core Logic
 *
 * Autonomous agent that monitors, maintains, and fixes the MetaHuman OS codebase.
 * - Processes captured errors and generates fix proposals
 * - Performs periodic maintenance checks
 * - Integrates with Big Brother for code fixes via Claude CLI
 *
 * All code changes require user approval before being applied.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import {
  ROOT,
  audit,
  getTargetUser,
  withUserContext,
  getProfilePaths,
  listErrors,
  getError,
  updateErrorStatus,
  type CapturedError,
} from '@metahuman/core';
import { escalateToBigBrother, shouldEscalateToBigBrother } from '@metahuman/core/big-brother';
import type { OperatorConfig } from '@metahuman/core/config';

const AGENT_NAME = 'coder';

interface SystemCoderConfig {
  enabled: boolean;
  mode: 'supervised' | 'auto';
  errorCapture: {
    enabled: boolean;
    autoCapture: boolean;
    patterns: string[];
  };
  maintenance: {
    enabled: boolean;
    intervalHours: number;
    scope: string[];
    checks: string[];
  };
  fixes: {
    autoStage: boolean;
    requireApproval: boolean;
    testBeforeApprove: boolean;
    maxPendingFixes: number;
    autoApproveRisk: string[];
    requireApprovalRisk: string[];
  };
  documentation: {
    autoUpdate: boolean;
    targets: string[];
  };
  bigBrother: {
    useForFixes: boolean;
    maxRetries: number;
    timeout: number;
  };
}

interface ProposedFix {
  id: string;
  errorId: string;
  timestamp: string;
  status: 'pending' | 'approved' | 'rejected' | 'applied' | 'failed';
  risk: 'none' | 'low' | 'medium' | 'high' | 'critical';
  files: Array<{
    path: string;
    originalContent: string;
    proposedContent: string;
    diff: string;
  }>;
  explanation: string;
  testCommands: string[];
  testResults?: {
    passed: boolean;
    output: string;
    timestamp: string;
  };
  appliedAt?: string;
  appliedBy?: string;
}

export interface CoderOptions {
  singleUser?: boolean;
  username?: string;
  maintenanceOnly?: boolean;
}

export interface CoderResult {
  success: boolean;
  usersProcessed: number;
  errorsProcessed: number;
  fixesGenerated: number;
  maintenanceRun: boolean;
  errors: string[];
}

async function loadConfig(): Promise<SystemCoderConfig> {
  const configPath = path.join(ROOT, 'etc', 'system-coder.json');
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    return {
      enabled: true,
      mode: 'supervised',
      errorCapture: {
        enabled: true,
        autoCapture: true,
        patterns: ['Error:', 'ERR!', 'TypeError', 'ReferenceError']
      },
      maintenance: {
        enabled: true,
        intervalHours: 24,
        scope: ['packages/core', 'apps/site/src', 'brain/agents'],
        checks: ['type_errors', 'unused_exports']
      },
      fixes: {
        autoStage: true,
        requireApproval: true,
        testBeforeApprove: true,
        maxPendingFixes: 20,
        autoApproveRisk: ['none', 'low'],
        requireApprovalRisk: ['medium', 'high', 'critical']
      },
      documentation: {
        autoUpdate: true,
        targets: ['CLAUDE.md', 'docs/user-guide/']
      },
      bigBrother: {
        useForFixes: true,
        maxRetries: 2,
        timeout: 120000
      }
    };
  }
}

// Use centralized loadOperatorConfig from @metahuman/core
// Import removed - will import dynamically in processError function

async function findRelatedFiles(error: CapturedError): Promise<string[]> {
  const relatedFiles: string[] = [];

  if (error.context.file) {
    relatedFiles.push(error.context.file);
  }

  if (error.stack) {
    const fileMatches = error.stack.match(/at\s+.+\s+\((.+):\d+:\d+\)/g);
    if (fileMatches) {
      for (const match of fileMatches) {
        const pathMatch = match.match(/\((.+):\d+:\d+\)/);
        if (pathMatch && pathMatch[1] && !pathMatch[1].includes('node_modules')) {
          relatedFiles.push(pathMatch[1]);
        }
      }
    }
  }

  return [...new Set(relatedFiles)].slice(0, 5);
}

function assessRisk(error: CapturedError, response: any): 'none' | 'low' | 'medium' | 'high' | 'critical' {
  if (error.context.file?.includes('packages/core')) return 'high';
  if (error.context.file?.includes('pages/api')) return 'medium';
  if (error.context.file?.includes('components')) return 'low';
  return 'medium';
}

function extractTestCommands(suggestions: string[]): string[] {
  const testCommands: string[] = [];

  for (const suggestion of suggestions) {
    if (suggestion.includes('pnpm test') || suggestion.includes('npm test')) {
      testCommands.push(suggestion.match(/(pnpm|npm)\s+test[^\s]*/)?.[0] || 'pnpm test');
    }
    if (suggestion.includes('pnpm build') || suggestion.includes('npm build')) {
      testCommands.push(suggestion.match(/(pnpm|npm)\s+(run\s+)?build/)?.[0] || 'pnpm build');
    }
    if (suggestion.includes('tsc')) {
      testCommands.push('pnpm exec tsc --noEmit');
    }
  }

  if (testCommands.length === 0) {
    testCommands.push('pnpm exec tsc --noEmit');
    testCommands.push('pnpm build');
  }

  return [...new Set(testCommands)];
}

async function processError(username: string, errorId: string, config: SystemCoderConfig): Promise<ProposedFix | null> {
  const profilePaths = getProfilePaths(username);

  const error = await getError(username, errorId);
  if (!error) {
    console.error(`[coder] Error not found: ${errorId}`);
    return null;
  }

  if (error.status !== 'new') {
    console.log(`[coder] Skipping error ${errorId} - status: ${error.status}`);
    return null;
  }

  await updateErrorStatus(username, errorId, 'reviewing');

  audit({
    level: 'info',
    category: 'action',
    event: 'coder_processing_error',
    details: { errorId, message: error.message.substring(0, 100), source: error.source },
    actor: AGENT_NAME
  });

  const { loadOperatorConfig } = await import('@metahuman/core/config');
  const operatorConfig = loadOperatorConfig(username);

  if (!config.bigBrother.useForFixes || !operatorConfig.bigBrotherMode?.enabled) {
    console.log('[coder] Big Brother not enabled, cannot generate fix');
    return null;
  }

  const relatedFiles = await findRelatedFiles(error);

  try {
    const response = await escalateToBigBrother({
      goal: `Fix the following error in the MetaHuman OS codebase:\n\n${error.message}`,
      stuckReason: `Error occurred: ${error.message}`,
      errorType: 'repeated_failures',
      scratchpad: [{
        type: 'observation',
        content: `Error captured from ${error.source}:\n${error.message}\n\nStack trace:\n${error.stack || 'No stack trace available'}`,
        timestamp: error.timestamp,
        success: false
      }],
      context: {
        errorId: error.id,
        source: error.source,
        severity: error.severity,
        file: error.context.file,
        line: error.context.line,
        relatedFiles
      },
      suggestions: [
        'Analyze the error and determine the root cause',
        'Propose a fix that resolves the error',
        'Include any necessary test commands to verify the fix'
      ]
    }, operatorConfig);

    if (!response.success) {
      console.error('[coder] Big Brother failed to generate fix:', response.error);
      return null;
    }

    const fixId = `fix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const proposedFix: ProposedFix = {
      id: fixId,
      errorId: error.id,
      timestamp: new Date().toISOString(),
      status: 'pending',
      risk: assessRisk(error, response),
      files: [],
      explanation: response.reasoning,
      testCommands: extractTestCommands(response.suggestions)
    };

    const fixesDir = path.join(profilePaths.state, 'coder', 'fixes');
    await fs.mkdir(fixesDir, { recursive: true });
    await fs.writeFile(
      path.join(fixesDir, `${fixId}.json`),
      JSON.stringify(proposedFix, null, 2)
    );

    error.fixId = fixId;
    const errorsDir = path.join(profilePaths.state, 'coder', 'errors');
    await fs.mkdir(errorsDir, { recursive: true });
    await fs.writeFile(
      path.join(errorsDir, `${error.id}.json`),
      JSON.stringify(error, null, 2)
    );

    audit({
      level: 'info',
      category: 'action',
      event: 'coder_fix_generated',
      details: { errorId: error.id, fixId, risk: proposedFix.risk },
      actor: AGENT_NAME
    });

    return proposedFix;
  } catch (err) {
    console.error('[coder] Error generating fix:', err);
    audit({
      level: 'error',
      category: 'action',
      event: 'coder_fix_failed',
      details: { errorId: error.id, error: (err as Error).message },
      actor: AGENT_NAME
    });
    return null;
  }
}

async function processNewErrors(username: string, config: SystemCoderConfig): Promise<number> {
  const errors = await listErrors(username, { status: 'new' });
  let processed = 0;

  for (const error of errors) {
    try {
      const fix = await processError(username, error.id, config);
      if (fix) processed++;
    } catch (err) {
      console.error(`[coder] Error processing error ${error.id}:`, err);
    }
  }

  return processed;
}

async function runMaintenance(username: string, config: SystemCoderConfig): Promise<void> {
  if (!config.maintenance.enabled) {
    console.log('[coder] Maintenance disabled');
    return;
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'coder_maintenance_start',
    details: { scope: config.maintenance.scope, checks: config.maintenance.checks },
    actor: AGENT_NAME
  });

  const profilePaths = getProfilePaths(username);
  const maintenanceDir = path.join(profilePaths.state, 'coder', 'maintenance');
  await fs.mkdir(maintenanceDir, { recursive: true });

  const report = {
    timestamp: new Date().toISOString(),
    checks: {} as Record<string, any>,
    summary: { issuesFound: 0, suggestions: [] as string[] }
  };

  if (config.maintenance.checks.includes('type_errors')) {
    report.checks.type_errors = { status: 'skipped', reason: 'Requires shell execution' };
  }

  const reportDate = new Date().toISOString().split('T')[0];
  await fs.writeFile(
    path.join(maintenanceDir, `${reportDate}.json`),
    JSON.stringify(report, null, 2)
  );

  audit({
    level: 'info',
    category: 'action',
    event: 'coder_maintenance_complete',
    details: { issuesFound: report.summary.issuesFound, date: reportDate },
    actor: AGENT_NAME
  });
}

export async function runCycle(options: CoderOptions = {}): Promise<CoderResult> {
  const result: CoderResult = {
    success: true,
    usersProcessed: 0,
    errorsProcessed: 0,
    fixesGenerated: 0,
    maintenanceRun: false,
    errors: [],
  };

  const config = await loadConfig();

  if (!config.enabled) {
    console.log('[coder] Agent is disabled');
    return result;
  }

  audit({
    level: 'info',
    category: 'system',
    event: 'coder_start',
    details: { mode: config.mode },
    actor: AGENT_NAME
  });

  // SECURITY: Get target user - prioritizes explicit username, then API trigger, then most recently active
  let user = getTargetUser(options);
  if (!user && options.singleUser) {
    user = { userId: 'default', username: 'default', role: 'owner' };
  }

  if (!user || !user.username) {
    console.log('[coder] No active user found');
    return result;
  }

  console.log(`[coder] Processing user: ${user.username}`);

  try {
    await withUserContext(user.username, async () => {
      if (!options.maintenanceOnly) {
        const processed = await processNewErrors(user!.username, config);
        result.errorsProcessed += processed;
        result.fixesGenerated += processed;
        console.log(`[coder] Processed ${processed} errors for ${user!.username}`);
      }

      const profilePaths = getProfilePaths(user!.username);
      const maintenanceDir = path.join(profilePaths.state, 'coder', 'maintenance');
      const reportDate = new Date().toISOString().split('T')[0];
      const reportPath = path.join(maintenanceDir, `${reportDate}.json`);

      try {
        await fs.access(reportPath);
        console.log(`[coder] Maintenance already run today for ${user!.username}`);
      } catch {
        await runMaintenance(user!.username, config);
        result.maintenanceRun = true;
      }
    });
    result.usersProcessed++;
  } catch (error) {
    result.errors.push(`Error processing ${user.username}: ${(error as Error).message}`);
  }

  audit({
    level: 'info',
    category: 'system',
    event: 'coder_complete',
    details: { usersProcessed: result.usersProcessed, errorsProcessed: result.errorsProcessed },
    actor: AGENT_NAME
  });

  return result;
}

export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  let username = opts.username as string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) { username = args[i + 1]; break; }
  }

  const options: CoderOptions = {
    singleUser: args.includes('--single-user') || opts.singleUser === true,
    username: username || ctx.userId,
    maintenanceOnly: args.includes('--maintenance-only') || opts.maintenanceOnly === true,
  };

  const result = await runCycle(options);

  return {
    success: result.success,
    data: {
      usersProcessed: result.usersProcessed,
      errorsProcessed: result.errorsProcessed,
      fixesGenerated: result.fixesGenerated,
      maintenanceRun: result.maintenanceRun,
    },
    errors: result.errors.length > 0 ? result.errors : undefined,
    durationMs: Date.now() - startTime,
  };
}
