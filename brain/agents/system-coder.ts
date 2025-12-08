/**
 * System Coder Agent
 *
 * Autonomous agent that monitors, maintains, and fixes the MetaHuman OS codebase.
 * - Processes captured errors and generates fix proposals
 * - Performs periodic maintenance checks
 * - Integrates with Big Brother for code fixes via Claude CLI
 *
 * All code changes require user approval before being applied.
 */

import {
  ROOT,
  audit,
  acquireLock,
  releaseLock,
  isLocked,
  initGlobalLogger,
  listUsers,
  withUserContext,
  getProfilePaths,
  listErrors,
  getError,
  updateErrorStatus,
  getErrorStats,
  type CapturedError,
} from '../../packages/core/src/index';
import { escalateToBigBrother, shouldEscalateToBigBrother } from '../../packages/core/src/big-brother.js';
import type { OperatorConfig } from '../../packages/core/src/config.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const AGENT_NAME = 'system-coder';

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

/**
 * Load system coder configuration
 */
async function loadConfig(): Promise<SystemCoderConfig> {
  const configPath = path.join(ROOT, 'etc', 'system-coder.json');
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('[system-coder] Failed to load config, using defaults:', error);
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

/**
 * Load operator config (for Big Brother integration)
 */
async function loadOperatorConfig(): Promise<OperatorConfig> {
  const configPath = path.join(ROOT, 'etc', 'operator.json');
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    console.error('[system-coder] Failed to load operator config:', error);
    return {
      version: '2.0',
      scratchpad: { maxSteps: 10, trimToLastN: 10 },
      models: { useSingleModel: false, planningModel: 'default.coder', responseModel: 'persona' },
      logging: { enableScratchpadDump: false },
      performance: { cacheCatalog: true },
      bigBrotherMode: { enabled: false, provider: 'claude-code' }
    };
  }
}

/**
 * Process a captured error and generate a fix proposal
 */
async function processError(username: string, errorId: string, config: SystemCoderConfig): Promise<ProposedFix | null> {
  const profilePaths = getProfilePaths(username);

  // Get the error
  const error = await getError(username, errorId);
  if (!error) {
    console.error(`[system-coder] Error not found: ${errorId}`);
    return null;
  }

  // Skip if already being processed or fixed
  if (error.status !== 'new') {
    console.log(`[system-coder] Skipping error ${errorId} - status: ${error.status}`);
    return null;
  }

  // Mark as reviewing
  await updateErrorStatus(username, errorId, 'reviewing');

  audit({
    level: 'info',
    category: 'action',
    event: 'system_coder_processing_error',
    details: {
      errorId,
      message: error.message.substring(0, 100),
      source: error.source
    },
    actor: AGENT_NAME
  });

  // Check if Big Brother is available and configured
  const operatorConfig = await loadOperatorConfig();

  if (!config.bigBrother.useForFixes || !operatorConfig.bigBrotherMode?.enabled) {
    console.log('[system-coder] Big Brother not enabled, cannot generate fix');
    return null;
  }

  // Build context for the fix request
  const relatedFiles = await findRelatedFiles(error);

  // Escalate to Big Brother for fix generation
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
      console.error('[system-coder] Big Brother failed to generate fix:', response.error);
      return null;
    }

    // Create proposed fix from response
    const fixId = `fix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const proposedFix: ProposedFix = {
      id: fixId,
      errorId: error.id,
      timestamp: new Date().toISOString(),
      status: 'pending',
      risk: assessRisk(error, response),
      files: [], // Big Brother should return file changes
      explanation: response.reasoning,
      testCommands: extractTestCommands(response.suggestions)
    };

    // Save the proposed fix
    const fixesDir = path.join(profilePaths.state, 'system-coder', 'fixes');
    await fs.mkdir(fixesDir, { recursive: true });
    await fs.writeFile(
      path.join(fixesDir, `${fixId}.json`),
      JSON.stringify(proposedFix, null, 2)
    );

    // Update error with fix ID
    error.fixId = fixId;
    const errorsDir = path.join(profilePaths.state, 'system-coder', 'errors');
    await fs.writeFile(
      path.join(errorsDir, `${error.id}.json`),
      JSON.stringify(error, null, 2)
    );

    audit({
      level: 'info',
      category: 'action',
      event: 'system_coder_fix_generated',
      details: {
        errorId: error.id,
        fixId,
        risk: proposedFix.risk
      },
      actor: AGENT_NAME
    });

    return proposedFix;
  } catch (err) {
    console.error('[system-coder] Error generating fix:', err);
    audit({
      level: 'error',
      category: 'action',
      event: 'system_coder_fix_failed',
      details: {
        errorId: error.id,
        error: (err as Error).message
      },
      actor: AGENT_NAME
    });
    return null;
  }
}

/**
 * Find files related to an error
 */
async function findRelatedFiles(error: CapturedError): Promise<string[]> {
  const relatedFiles: string[] = [];

  // Add the file from the error context if available
  if (error.context.file) {
    relatedFiles.push(error.context.file);
  }

  // Extract file paths from stack trace
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

  return [...new Set(relatedFiles)].slice(0, 5); // Limit to 5 files
}

/**
 * Assess the risk level of a proposed fix
 */
function assessRisk(error: CapturedError, response: any): 'none' | 'low' | 'medium' | 'high' | 'critical' {
  // High risk if affects core files
  if (error.context.file?.includes('packages/core')) {
    return 'high';
  }

  // Medium risk if affects API endpoints
  if (error.context.file?.includes('pages/api')) {
    return 'medium';
  }

  // Low risk for UI components
  if (error.context.file?.includes('components')) {
    return 'low';
  }

  // Default to medium
  return 'medium';
}

/**
 * Extract test commands from suggestions
 */
function extractTestCommands(suggestions: string[]): string[] {
  const testCommands: string[] = [];

  for (const suggestion of suggestions) {
    // Look for common test patterns
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

  // Default test commands if none found
  if (testCommands.length === 0) {
    testCommands.push('pnpm exec tsc --noEmit');
    testCommands.push('pnpm build');
  }

  return [...new Set(testCommands)];
}

/**
 * Process all new errors for a user
 */
async function processNewErrors(username: string, config: SystemCoderConfig): Promise<number> {
  const errors = await listErrors(username, { status: 'new' });
  let processed = 0;

  for (const error of errors) {
    try {
      const fix = await processError(username, error.id, config);
      if (fix) {
        processed++;
      }
    } catch (err) {
      console.error(`[system-coder] Error processing error ${error.id}:`, err);
    }
  }

  return processed;
}

/**
 * Run maintenance checks
 */
async function runMaintenance(username: string, config: SystemCoderConfig): Promise<void> {
  if (!config.maintenance.enabled) {
    console.log('[system-coder] Maintenance disabled');
    return;
  }

  audit({
    level: 'info',
    category: 'action',
    event: 'system_coder_maintenance_start',
    details: {
      scope: config.maintenance.scope,
      checks: config.maintenance.checks
    },
    actor: AGENT_NAME
  });

  const profilePaths = getProfilePaths(username);
  const maintenanceDir = path.join(profilePaths.state, 'system-coder', 'maintenance');
  await fs.mkdir(maintenanceDir, { recursive: true });

  const report = {
    timestamp: new Date().toISOString(),
    checks: {} as Record<string, any>,
    summary: {
      issuesFound: 0,
      suggestions: [] as string[]
    }
  };

  // Type check
  if (config.maintenance.checks.includes('type_errors')) {
    try {
      // Note: In a real implementation, we'd run tsc and capture output
      report.checks.type_errors = { status: 'skipped', reason: 'Requires shell execution' };
    } catch (err) {
      report.checks.type_errors = { status: 'error', error: (err as Error).message };
    }
  }

  // Save maintenance report
  const reportDate = new Date().toISOString().split('T')[0];
  await fs.writeFile(
    path.join(maintenanceDir, `${reportDate}.json`),
    JSON.stringify(report, null, 2)
  );

  audit({
    level: 'info',
    category: 'action',
    event: 'system_coder_maintenance_complete',
    details: {
      issuesFound: report.summary.issuesFound,
      date: reportDate
    },
    actor: AGENT_NAME
  });
}

/**
 * Main entry point
 */
async function main() {
  await initGlobalLogger();

  // Check lock
  if (await isLocked(AGENT_NAME)) {
    console.log(`[${AGENT_NAME}] Another instance is already running`);
    process.exit(0);
  }

  const lockAcquired = await acquireLock(AGENT_NAME);
  if (!lockAcquired) {
    console.log(`[${AGENT_NAME}] Could not acquire lock`);
    process.exit(0);
  }

  try {
    console.log(`[${AGENT_NAME}] Starting...`);

    // Load config
    const config = await loadConfig();

    if (!config.enabled) {
      console.log(`[${AGENT_NAME}] Agent is disabled`);
      return;
    }

    audit({
      level: 'info',
      category: 'system',
      event: 'system_coder_start',
      details: { mode: config.mode },
      actor: AGENT_NAME
    });

    // Process errors for all users
    const users = await listUsers();

    for (const user of users) {
      if (!user.username) continue;

      console.log(`[${AGENT_NAME}] Processing user: ${user.username}`);

      await withUserContext(user.username, async () => {
        // Process new errors
        const processed = await processNewErrors(user.username, config);
        console.log(`[${AGENT_NAME}] Processed ${processed} errors for ${user.username}`);

        // Run maintenance if due (check last run time)
        const profilePaths = getProfilePaths(user.username);
        const maintenanceDir = path.join(profilePaths.state, 'system-coder', 'maintenance');
        const reportDate = new Date().toISOString().split('T')[0];
        const reportPath = path.join(maintenanceDir, `${reportDate}.json`);

        try {
          await fs.access(reportPath);
          console.log(`[${AGENT_NAME}] Maintenance already run today for ${user.username}`);
        } catch {
          // No report for today, run maintenance
          await runMaintenance(user.username, config);
        }
      });
    }

    audit({
      level: 'info',
      category: 'system',
      event: 'system_coder_complete',
      details: { usersProcessed: users.length },
      actor: AGENT_NAME
    });

    console.log(`[${AGENT_NAME}] Complete`);
  } catch (error) {
    console.error(`[${AGENT_NAME}] Fatal error:`, error);
    audit({
      level: 'error',
      category: 'system',
      event: 'system_coder_error',
      details: { error: (error as Error).message },
      actor: AGENT_NAME
    });
  } finally {
    await releaseLock(AGENT_NAME);
  }
}

// Run if executed directly
main().catch(console.error);
