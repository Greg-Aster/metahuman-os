#!/usr/bin/env tsx
/**
 * Desire Planner Agent
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
  validateCognitiveGraph,
  type CognitiveGraph,
} from '@metahuman/core';

import type { Desire } from '@metahuman/core';
import { loadConfig, isAgencyEnabled } from '@metahuman/core';
import { listDesiresByStatus } from '@metahuman/core';
import * as ollama from '@metahuman/core/ollama';

const LOCK_NAME = 'desire-planner';
const LOG_PREFIX = '[AGENCY:planner]';
const CONFIG_PATH = path.join(ROOT, 'etc', 'desire-planner.json');
const GRAPHS_DIR = path.join(ROOT, 'etc', 'cognitive-graphs');

// ============================================================================
// Config Loading
// ============================================================================

interface PlannerConfig {
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

async function loadPlannerConfig(): Promise<PlannerConfig> {
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

async function loadGraph(filename: string): Promise<CognitiveGraph> {
  const graphPath = path.join(GRAPHS_DIR, filename);
  const raw = await fs.readFile(graphPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return validateCognitiveGraph(parsed);
}

// ============================================================================
// Desire Processing
// ============================================================================

/**
 * Process a single desire through planning and review graphs
 */
async function processDesire(
  desire: Desire,
  plannerGraph: CognitiveGraph,
  reviewerGraph: CognitiveGraph,
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

    // Extract plan from graph output
    const planGeneratorNode = planResult.nodes.get(5); // Node 5 is plan generator
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

    // Extract verdict from graph output
    const verdictNode = reviewResult.nodes.get(7); // Node 7 is verdict synthesizer
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
async function processPlanningDesires(
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
        source: 'desire-planner',
        metadata: {
          tags: ['agency', 'planning', 'review', 'inner'],
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
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  initGlobalLogger();
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
    // Check Ollama
    const running = await ollama.isRunning();
    if (!running) {
      console.warn(`${LOG_PREFIX} Ollama not running; skipping. Start with: ollama serve`);
      return;
    }

    // Process only logged-in users
    const users = getLoggedInUsers();
    console.log(`${LOG_PREFIX} Processing ${users.length} logged-in user(s)`);

    let totalPlanned = 0;
    let totalApproved = 0;
    let totalNeedsApproval = 0;
    let totalRejected = 0;
    let totalFailed = 0;

    for (const user of users) {
      const { userId, username, role } = user;
      console.log(`${LOG_PREFIX} --- Processing user: ${username} ---`);

      await withUserContext({ userId, username, role }, async () => {
        const result = await processPlanningDesires(username, config);
        totalPlanned += result.planned;
        totalApproved += result.approved;
        totalNeedsApproval += result.needsApproval;
        totalRejected += result.rejected;
        totalFailed += result.failed;
      });
    }

    console.log(`${LOG_PREFIX} Planning complete:`);
    console.log(`${LOG_PREFIX}   Planned: ${totalPlanned}`);
    console.log(`${LOG_PREFIX}   Auto-approved: ${totalApproved}`);
    console.log(`${LOG_PREFIX}   Needs approval: ${totalNeedsApproval}`);
    console.log(`${LOG_PREFIX}   Rejected: ${totalRejected}`);
    console.log(`${LOG_PREFIX}   Failed: ${totalFailed}`);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_planner_completed',
      actor: 'desire-planner',
      details: {
        totalPlanned,
        totalApproved,
        totalNeedsApproval,
        totalRejected,
        totalFailed,
        usersProcessed: users.length,
      },
    });

  } finally {
    if (lock) {
      lock.release();
    }
  }
}

// Run if executed directly
main().catch((error) => {
  console.error(`${LOG_PREFIX} Fatal error:`, error);
  process.exit(1);
});
