/**
 * Desire Planner Agent — Core Logic
 *
 * Generates execution plans for desires using cognitive graph workflow:
 * - Loads desires in 'planning' status
 * - Executes planning graph (LLM-based plan generation)
 * - Executes review graph (alignment + safety review)
 * - Updates desires based on review outcome
 *
 * Uses: etc/cognitive-graphs/desire-planner.json
 *       etc/cognitive-graphs/desire-reviewer.json
 *
 * MULTI-USER: Processes only logged-in users (active sessions) with isolated contexts.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';
import {
  ROOT,
  audit,
  acquireLock,
  isLocked,
  initGlobalLogger,
  getLoggedInUsers,
  withUserContext,
  captureEvent,
  executeGraph,
  validateSvelteFlowGraph,
  getActiveBackend,
  type SvelteFlowGraph,
  type Desire,
  listDesiresByStatus,
  isAgencyEnabled,
} from '@metahuman/core';

const LOCK_NAME = 'desire-planner';
const LOG_PREFIX = '[AGENCY:planner]';
const CONFIG_PATH = path.join(ROOT, 'etc', 'desire-planner.json');
const GRAPHS_DIR = path.join(ROOT, 'etc', 'cognitive-graphs');

// ============================================================================
// Types
// ============================================================================

export interface PlannerConfig {
  enabled: boolean;
  graph: {
    planner: string;
    reviewer: string;
  };
  planning: {
    temperature: number;
    maxSteps: number;
    includeToolCatalog: boolean;
    includeDecisionRules: boolean;
    includeMemoryContext: boolean;
    memorySearchLimit: number;
  };
  review: {
    alignmentThreshold: number;
    safetyThreshold: number;
    autoApproveThreshold: number;
    temperature: number;
  };
  processing: {
    batchSize: number;
    retryOnFailure: boolean;
    maxRetries: number;
  };
  logging: {
    verbose: boolean;
    logToInnerDialogue: boolean;
  };
}

export interface DesirePlannerOptions {
  singleUser?: boolean;
  username?: string;
}

export interface DesirePlannerResult {
  success: boolean;
  usersProcessed: number;
  errors: string[];
  stats: {
    planned: number;
    approved: number;
    needsApproval: number;
    rejected: number;
    failed: number;
  };
}

// ============================================================================
// Config Loading
// ============================================================================

export async function loadPlannerConfig(): Promise<PlannerConfig> {
  try {
    const content = await fs.readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    console.warn(`${LOG_PREFIX} Config not found, using defaults`);
    return {
      enabled: true,
      graph: {
        planner: 'desire-planner.json',
        reviewer: 'desire-reviewer.json',
      },
      planning: {
        temperature: 0.3,
        maxSteps: 10,
        includeToolCatalog: true,
        includeDecisionRules: true,
        includeMemoryContext: true,
        memorySearchLimit: 5,
      },
      review: {
        alignmentThreshold: 0.7,
        safetyThreshold: 0.8,
        autoApproveThreshold: 0.9,
        temperature: 0.2,
      },
      processing: {
        batchSize: 5,
        retryOnFailure: true,
        maxRetries: 2,
      },
      logging: {
        verbose: true,
        logToInnerDialogue: true,
      },
    };
  }
}

// ============================================================================
// Graph Loading
// ============================================================================

export async function loadGraph(filename: string): Promise<SvelteFlowGraph> {
  const graphPath = path.join(GRAPHS_DIR, filename);
  const raw = await fs.readFile(graphPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return validateSvelteFlowGraph(parsed);
}

// ============================================================================
// Desire Processing
// ============================================================================

/**
 * Process a single desire through planning and review graphs
 */
async function processDesire(
  desire: Desire,
  plannerGraph: SvelteFlowGraph,
  reviewerGraph: SvelteFlowGraph,
  plannerConfig: PlannerConfig,
  username: string
): Promise<{
  success: boolean;
  outcome: 'planned' | 'approved' | 'needs_approval' | 'rejected' | 'failed';
  error?: string;
}> {
  console.log(`${LOG_PREFIX}   Planning: ${desire.title}`);

  try {
    // =========================================================================
    // PHASE 1: Generate Plan
    // =========================================================================
    const planContext = {
      userId: username,
      username,
      desire,
      desireId: desire.id,
      allowMemoryWrites: true,
      cognitiveMode: 'agent' as const,
      config: plannerConfig.planning,
    };

    console.log(`${LOG_PREFIX}     Executing planner graph...`);
    const planResult = await executeGraph(plannerGraph, planContext);

    if (planResult.status !== 'completed') {
      console.error(`${LOG_PREFIX}     Planner graph failed: ${planResult.status}`);
      return {
        success: false,
        outcome: 'failed',
        error: `Planner graph ended with status: ${planResult.status}`,
      };
    }

    // Extract plan from graph output (node IDs are strings in Svelte Flow format)
    const planGeneratorNode = planResult.nodes.get('5'); // Node 5 is plan generator
    const plan = planGeneratorNode?.outputs?.plan;

    if (!plan) {
      console.error(`${LOG_PREFIX}     No plan generated`);
      return {
        success: false,
        outcome: 'failed',
        error: 'Plan generator produced no output',
      };
    }

    console.log(`${LOG_PREFIX}     Plan generated: ${plan.steps?.length || 0} step(s)`);

    // =========================================================================
    // PHASE 2: Review Plan
    // =========================================================================
    const reviewContext = {
      userId: username,
      username,
      desire: { ...desire, plan },
      desireId: desire.id,
      allowMemoryWrites: true,
      cognitiveMode: 'agent' as const,
      config: plannerConfig.review,
    };

    console.log(`${LOG_PREFIX}     Executing reviewer graph...`);
    const reviewResult = await executeGraph(reviewerGraph, reviewContext);

    if (reviewResult.status !== 'completed') {
      console.warn(`${LOG_PREFIX}     Reviewer graph ended with status: ${reviewResult.status}`);
      // Still consider the plan valid, just move to reviewing for manual check
      return { success: true, outcome: 'planned' };
    }

    // Extract verdict from graph output (node IDs are strings in Svelte Flow format)
    const verdictNode = reviewResult.nodes.get('7'); // Node 7 is verdict synthesizer
    const verdict = verdictNode?.outputs?.verdict;
    const autoApprove = verdictNode?.outputs?.autoApprove;

    if (verdict === 'reject') {
      console.log(`${LOG_PREFIX}     Plan rejected by review`);
      return { success: true, outcome: 'rejected' };
    }

    if (autoApprove) {
      console.log(`${LOG_PREFIX}     Plan auto-approved (high alignment + safety)`);
      return { success: true, outcome: 'approved' };
    }

    console.log(`${LOG_PREFIX}     Plan queued for manual approval`);
    return { success: true, outcome: 'needs_approval' };

  } catch (error) {
    console.error(`${LOG_PREFIX}     Error:`, error);
    return {
      success: false,
      outcome: 'failed',
      error: (error as Error).message,
    };
  }
}

/**
 * Process all desires in 'planning' status for a user
 */
export async function processPlanningDesires(
  username: string,
  plannerConfig: PlannerConfig
): Promise<{
  planned: number;
  approved: number;
  needsApproval: number;
  rejected: number;
  failed: number;
}> {
  if (!await isAgencyEnabled(username)) {
    console.log(`${LOG_PREFIX} Agency disabled for user ${username}`);
    return { planned: 0, approved: 0, needsApproval: 0, rejected: 0, failed: 0 };
  }

  const planningDesires = await listDesiresByStatus('planning', username);
  console.log(`${LOG_PREFIX} Found ${planningDesires.length} desires in planning status`);

  if (planningDesires.length === 0) {
    return { planned: 0, approved: 0, needsApproval: 0, rejected: 0, failed: 0 };
  }

  // Load graphs
  const plannerGraph = await loadGraph(plannerConfig.graph.planner);
  const reviewerGraph = await loadGraph(plannerConfig.graph.reviewer);

  let planned = 0;
  let approved = 0;
  let needsApproval = 0;
  let rejected = 0;
  let failed = 0;

  // Process up to batchSize desires
  const batch = planningDesires.slice(0, plannerConfig.processing.batchSize);

  for (const desire of batch) {
    const result = await processDesire(
      desire,
      plannerGraph,
      reviewerGraph,
      plannerConfig,
      username
    );

    switch (result.outcome) {
      case 'planned':
        planned++;
        break;
      case 'approved':
        approved++;
        break;
      case 'needs_approval':
        needsApproval++;
        break;
      case 'rejected':
        rejected++;
        break;
      case 'failed':
        failed++;
        if (result.error) {
          audit({
            category: 'agent',
            level: 'error',
            event: 'desire_planning_failed',
            actor: 'desire-planner',
            details: {
              desireId: desire.id,
              title: desire.title,
              error: result.error,
              username,
            },
          });
        }
        break;
    }
  }

  // Log summary to inner dialogue if enabled
  if (plannerConfig.logging.logToInnerDialogue && (planned + approved + needsApproval + rejected > 0)) {
    const parts: string[] = [];

    if (approved > 0) parts.push(`${approved} auto-approved`);
    if (needsApproval > 0) parts.push(`${needsApproval} queued for your approval`);
    if (rejected > 0) parts.push(`${rejected} rejected by self-review`);
    if (failed > 0) parts.push(`${failed} failed to plan`);

    await captureEvent(
      `I reviewed ${batch.length} desire plan(s): ${parts.join(', ')}.`,
      {
        type: 'inner_dialogue',
        tags: ['agency', 'planning', 'review', 'inner'],
        metadata: {
          source: 'desire-planner',
          planned,
          approved,
          needsApproval,
          rejected,
          failed,
        },
      }
    );
  }

  return { planned, approved, needsApproval, rejected, failed };
}

// ============================================================================
// Agent Runtime Entry Points
// ============================================================================

/**
 * Run a single planning cycle - entry point for CLI and scheduler
 */
export async function runCycle(options: DesirePlannerOptions = {}): Promise<DesirePlannerResult> {
  const result: DesirePlannerResult = {
    success: true,
    usersProcessed: 0,
    errors: [],
    stats: { planned: 0, approved: 0, needsApproval: 0, rejected: 0, failed: 0 },
  };

  try {
    const config = await loadPlannerConfig();
    if (!config.enabled) {
      console.log(`${LOG_PREFIX} Disabled in config`);
      return result;
    }

    try {
      console.log(`${LOG_PREFIX} Using LLM backend: ${getActiveBackend()}`);
    } catch {
      console.log(`${LOG_PREFIX} Using model router (backend auto-selected)`);
    }

    let users: Array<{ userId: string; username: string; role: string }>;
    if (options.username) {
      users = [{ userId: options.username, username: options.username, role: 'owner' }];
    } else if (options.singleUser) {
      users = [{ userId: 'default', username: 'default', role: 'owner' }];
    } else {
      users = getLoggedInUsers();
    }

    console.log(`${LOG_PREFIX} Processing ${users.length} user(s)`);

    for (const user of users) {
      try {
        console.log(`${LOG_PREFIX} --- Processing user: ${user.username} ---`);
        await withUserContext(user, async () => {
          const r = await processPlanningDesires(user.username, config);
          result.stats.planned += r.planned;
          result.stats.approved += r.approved;
          result.stats.needsApproval += r.needsApproval;
          result.stats.rejected += r.rejected;
          result.stats.failed += r.failed;
        });
        result.usersProcessed++;
      } catch (error) {
        result.errors.push(`Error processing ${user.username}: ${(error as Error).message}`);
      }
    }

    console.log(`${LOG_PREFIX} Planning complete:`);
    console.log(`${LOG_PREFIX}   Planned: ${result.stats.planned}`);
    console.log(`${LOG_PREFIX}   Auto-approved: ${result.stats.approved}`);
    console.log(`${LOG_PREFIX}   Needs approval: ${result.stats.needsApproval}`);
    console.log(`${LOG_PREFIX}   Rejected: ${result.stats.rejected}`);
    console.log(`${LOG_PREFIX}   Failed: ${result.stats.failed}`);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_planner_completed',
      actor: 'desire-planner',
      details: { ...result.stats, usersProcessed: result.usersProcessed },
    });

    return result;
  } catch (error) {
    result.success = false;
    result.errors.push((error as Error).message);
    return result;
  }
}

/**
 * Agent runtime entry point - used by mobile and scheduler
 */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  let username = opts.username as string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--username' && i + 1 < args.length) {
      username = args[i + 1];
      break;
    }
  }

  const options: DesirePlannerOptions = {
    singleUser: args.includes('--single-user') || opts.singleUser === true,
    username: username || ctx.userId,
  };

  const result = await runCycle(options);

  return {
    success: result.success,
    data: result.stats,
    errors: result.errors.length > 0 ? result.errors : undefined,
    durationMs: Date.now() - startTime,
  };
}

// ============================================================================
// CLI Entry Point (for direct execution)
// ============================================================================

async function main(): Promise<void> {
  initGlobalLogger('desire-planner');
  console.log(`${LOG_PREFIX} Starting desire planner agent...`);

  // Load config
  const config = await loadPlannerConfig();

  if (!config.enabled) {
    console.log(`${LOG_PREFIX} Planner disabled in config. Exiting.`);
    return;
  }

  // Check for existing lock
  if (isLocked(LOCK_NAME)) {
    console.log(`${LOG_PREFIX} Another instance is already running. Exiting.`);
    process.exit(0);
  }

  // Acquire lock
  let lock: { release: () => void } | null = null;
  try {
    lock = acquireLock(LOCK_NAME);
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to acquire lock:`, error);
    process.exit(1);
  }

  try {
    const result = await runCycle();

    if (!result.success) {
      console.error(`${LOG_PREFIX} Errors:`, result.errors);
      process.exit(1);
    }
  } finally {
    if (lock) {
      lock.release();
    }
  }
}

// Only run if executed directly (not imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((error) => {
    console.error(`${LOG_PREFIX} Fatal error:`, error);
    process.exit(1);
  });
}
