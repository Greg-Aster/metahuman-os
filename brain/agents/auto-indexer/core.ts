/**
 * Auto-Indexer Agent — Core Logic
 *
 * Automatically rebuilds vector indexes for semantic search:
 * - Runs nightly via Trigger Manager (or on-demand)
 * - Rebuilds the full vector index for each user
 * - Uses Qwen embeddings via llama.cpp (local-models provider)
 * - Does NOT require LLM (embeddings run on CPU, parallel to GPU models)
 *
 * This module can be used both:
 * - CLI: via cli.ts wrapper
 * - Mobile: imported directly and run in-process
 */

import {
  audit,
  getTargetUser,
  withUserContext,
  buildMemoryIndex,
  getIndexStatus,
  isEmbeddingServiceAvailable,
} from '@metahuman/core';
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';

const LOG_PREFIX = '[auto-indexer]';

// ============================================================================
// Types
// ============================================================================

export interface AutoIndexerOptions {
  /** Force rebuild even if index is recent */
  force?: boolean;
  /** Only process a single user */
  singleUser?: boolean;
  /** Skip rebuild if index is newer than this many hours */
  maxAgeHours?: number;
}

export interface AutoIndexerResult {
  success: boolean;
  totalIndexed: number;
  userCount: number;
  errors: string[];
  skipped: number;
}

export interface IndexRebuildResult {
  success: boolean;
  itemCount: number;
  error?: string;
  skipped?: boolean;
}

// ============================================================================
// Index Rebuild Logic
// ============================================================================

/**
 * Check if an index is recent enough to skip rebuild
 */
function isIndexRecent(maxAgeHours: number): boolean {
  try {
    const status = getIndexStatus();
    if (!status.exists || !status.createdAt) return false;

    const createdAt = new Date(status.createdAt);
    const ageMs = Date.now() - createdAt.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    return ageHours < maxAgeHours;
  } catch (error) {
    console.error(`${LOG_PREFIX} Error checking index age:`, (error as Error).message);
    return false;
  }
}

/**
 * Rebuild the vector index for the current user context
 */
export async function rebuildIndex(options: AutoIndexerOptions = {}): Promise<IndexRebuildResult> {
  console.log(`${LOG_PREFIX} ========== rebuildIndex HIT ==========`);
  const maxAgeHours = options.maxAgeHours ?? 24;

  // Check if we should skip (unless forced)
  if (!options.force && isIndexRecent(maxAgeHours)) {
    const status = getIndexStatus();
    console.log(`${LOG_PREFIX} Index is recent (created ${status.createdAt}), skipping rebuild`);
    return { success: true, itemCount: status.items || 0, skipped: true };
  }

  try {
    console.log(`${LOG_PREFIX} Starting index rebuild...`);

    // Build the index using the model router (will use embedder role -> local-models provider)
    // The model router will automatically select the configured embedding model (qwen3-embedding-0.6b)
    const indexPath = await buildMemoryIndex({
      include: {
        episodic: true,
        tasks: true,
        curated: true,
        functions: true,
      },
    });

    // Get the resulting status
    const status = getIndexStatus();
    console.log(`${LOG_PREFIX} Index rebuilt: ${status.items} items at ${indexPath}`);

    return { success: true, itemCount: status.items || 0 };
  } catch (error) {
    console.error(`${LOG_PREFIX} Index rebuild failed:`, (error as Error).message);
    return { success: false, itemCount: 0, error: (error as Error).message };
  }
}

/**
 * Process index rebuild for a single user
 */
export async function processUserIndex(
  username: string,
  options: AutoIndexerOptions = {}
): Promise<IndexRebuildResult> {
  // Security: Validate username to prevent log injection attacks
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(username)) {
    console.error(`${LOG_PREFIX} Invalid username: ${username}`);
    return { success: false, itemCount: 0, error: 'Invalid username format' };
  }
  
  console.log(`${LOG_PREFIX} Processing user: ${username}`);

  try {
    const result = await rebuildIndex(options);

    if (result.skipped) {
      console.log(`${LOG_PREFIX}   Skipped ${username}: index is recent`);
    } else if (result.success) {
      console.log(`${LOG_PREFIX}   Completed ${username}: ${result.itemCount} items indexed`);
    } else {
      console.log(`${LOG_PREFIX}   Failed ${username}: ${result.error}`);
    }

    return result;
  } catch (error) {
    console.error(`${LOG_PREFIX}   Error processing ${username}:`, (error as Error).message);
    return { success: false, itemCount: 0, error: (error as Error).message };
  }
}

// ============================================================================
// Main Cycle
// ============================================================================

/**
 * Run a full auto-indexer cycle (multi-user)
 */
export async function runCycle(options: AutoIndexerOptions = {}): Promise<AutoIndexerResult> {
  console.log(`${LOG_PREFIX} ========== runCycle HIT ==========`);
  console.log(`${LOG_PREFIX} Starting cycle...`);

  audit({
    level: 'info',
    category: 'action',
    event: 'agent_cycle_started',
    details: { agent: 'auto-indexer', force: options.force || false },
    actor: 'agent',
  });

  const result: AutoIndexerResult = {
    success: false,
    totalIndexed: 0,
    userCount: 0,
    errors: [],
    skipped: 0,
  };

  try {
    // SECURITY: Get target user - prioritizes explicit username, then API trigger, then most recently active
    const activeUser = getTargetUser();

    if (!activeUser) {
      console.log(`${LOG_PREFIX} No active users found. Skipping cycle.`);
      audit({
        level: 'info',
        category: 'action',
        event: 'agent_cycle_skipped',
        details: { agent: 'auto-indexer', reason: 'no_active_users' },
        actor: 'agent',
      });
      result.success = true;
      return result;
    }

    console.log(`${LOG_PREFIX} Processing user: ${activeUser.username}`);
    result.userCount = 1;

    // Check embedding service availability using active user's context
    const embeddingAvailable = await withUserContext(
      { userId: activeUser.userId, username: activeUser.username, role: activeUser.role },
      async () => isEmbeddingServiceAvailable(activeUser.username)
    );

    if (!embeddingAvailable) {
      const errorMsg = 'Embedding service not available. Start local-model-service first.';
      console.error(`${LOG_PREFIX} ${errorMsg}`);
      audit({
        level: 'error',
        category: 'action',
        event: 'agent_cycle_failed',
        details: { agent: 'auto-indexer', error: errorMsg },
        actor: 'agent',
      });
      result.errors.push(errorMsg);
      return result;
    }

    try {
      const indexResult = await withUserContext(
        { userId: activeUser.userId, username: activeUser.username, role: activeUser.role },
        async () => processUserIndex(activeUser.username, options)
      );

      if (indexResult.skipped) {
        result.skipped++;
      } else if (indexResult.success) {
        result.totalIndexed += indexResult.itemCount;
      } else if (indexResult.error) {
        result.errors.push(`User ${activeUser.username}: ${indexResult.error}`);
      }
    } catch (error) {
      const errorMsg = `User ${activeUser.username}: ${(error as Error).message}`;
      console.error(`${LOG_PREFIX} Failed: ${errorMsg}`);
      result.errors.push(errorMsg);
    }

    console.log(`${LOG_PREFIX} Cycle finished. Indexed ${result.totalIndexed} items for user ${activeUser.username}.`);

    audit({
      level: 'info',
      category: 'action',
      event: 'agent_cycle_completed',
      details: {
        agent: 'auto-indexer',
        totalIndexed: result.totalIndexed,
        userCount: result.userCount,
        skipped: result.skipped,
      },
      actor: 'agent',
    });

    result.success = result.errors.length === 0;
    return result;
  } catch (error) {
    const errorMsg = (error as Error).message;
    console.error(`${LOG_PREFIX} Cycle error:`, errorMsg);

    audit({
      level: 'error',
      category: 'action',
      event: 'agent_cycle_failed',
      details: { agent: 'auto-indexer', error: errorMsg },
      actor: 'agent',
    });

    result.errors.push(errorMsg);
    return result;
  }
}

// ============================================================================
// Agent Runtime Interface
// ============================================================================

/**
 * Run function for agent-runtime
 */
export async function run(ctx: AgentContext, input: AgentInput): Promise<AgentResult> {
  console.log(`${LOG_PREFIX} ========== run HIT ==========`);
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  const options: AutoIndexerOptions = {
    force: args.includes('--force') || opts.force === true,
    singleUser: args.includes('--single-user') || opts.singleUser === true,
    maxAgeHours: (opts.maxAgeHours as number) || 24,
  };

  // Parse maxAgeHours from args
  const ageArg = args.find(a => a.startsWith('--max-age='));
  if (ageArg && !opts.maxAgeHours) {
    options.maxAgeHours = parseInt(ageArg.split('=')[1], 10);
  }

  try {
    // If running for a specific user context, process just that user
    if (ctx.username && options.singleUser) {
      const indexResult = await withUserContext(
        { userId: ctx.username, username: ctx.username, role: 'owner' },
        async () => processUserIndex(ctx.username, options)
      );

      return {
        success: indexResult.success,
        data: {
          totalIndexed: indexResult.itemCount,
          userCount: 1,
          errors: indexResult.error ? [indexResult.error] : [],
          skipped: indexResult.skipped ? 1 : 0,
        },
        duration: Date.now() - startTime,
        itemsProcessed: indexResult.itemCount,
      };
    }

    // Otherwise run full cycle
    const result = await runCycle(options);

    return {
      success: result.success,
      data: result,
      error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
      duration: Date.now() - startTime,
      itemsProcessed: result.totalIndexed,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      duration: Date.now() - startTime,
    };
  }
}
