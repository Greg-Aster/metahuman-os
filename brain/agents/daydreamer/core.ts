/**
 * Daydreamer Agent — Core Logic
 *
 * A lighter version of the dreamer that can run outside sleep hours using
 * a cognitive graph workflow that:
 * 1. Curates a small sample of weighted memories (5 instead of 15)
 * 2. Generates short, whimsical daydream narratives
 * 3. Saves to inner dialogue only (never surfaces to main chat)
 * 4. No continuation dreams or learnings extraction
 *
 * Triggered probabilistically during idle periods (see trigger-manager.ts).
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT,
  audit,
  recordSystemActivity,
  scheduler,
  getTargetUser,
  withUserContext,
  runGraph,
  validateSvelteFlowGraph,
  getActiveBackend,
  type SvelteFlowGraph,
} from '@metahuman/core';
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';

// ============================================================================
// Types
// ============================================================================

export interface DaydreamerOptions {
  forceRun?: boolean;
  singleUser?: boolean;
}

export interface DaydreamerResult {
  success: boolean;
  daydreamsGenerated: number;
  memoriesCurated: number;
  userCount: number;
  errors: string[];
}

export interface UserDaydreamerStats {
  daydreamsGenerated: number;
  memoriesCurated: number;
}

// ============================================================================
// Constants
// ============================================================================

const LOG_PREFIX = '[daydreamer]';

// ============================================================================
// Helper Functions
// ============================================================================

function markBackgroundActivity() {
  try {
    recordSystemActivity();
  } catch {}

  try {
    scheduler.recordActivity();
  } catch {}
}

/**
 * Load daydreamer cognitive graph
 */
export async function loadDaydreamerGraph(): Promise<SvelteFlowGraph> {
  const graphPath = path.join(ROOT, 'etc', 'cognitive-graphs', 'daydreamer-mode.json');
  const raw = await fsp.readFile(graphPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return validateSvelteFlowGraph(parsed);
}

// ============================================================================
// Daydream Generation
// ============================================================================

/**
 * Generate a daydream for a single user using node-based workflow.
 * Daydreams are shorter, lighter than full dreams - inner musings only.
 *
 * SECURITY: All memory access is user-specific via context.userId
 */
export async function generateUserDaydream(
  username: string,
  options: DaydreamerOptions = {}
): Promise<UserDaydreamerStats> {
  console.log(`${LOG_PREFIX} Processing user: ${username}`);

  const heartbeat = setInterval(() => {
    markBackgroundActivity();
  }, 15000);

  try {
    // Log which backend is active (model router handles actual availability)
    try {
      const backend = getActiveBackend();
      console.log(`${LOG_PREFIX} Using LLM backend: ${backend}`);
    } catch (e) {
      console.log(`${LOG_PREFIX} Using model router (backend auto-selected)`);
    }

    // Load daydreamer cognitive graph
    const graph = await loadDaydreamerGraph();

    // Execute graph with user context
    // SECURITY: userId is passed explicitly to ensure user-specific path resolution
    const graphContext = {
      userId: username,
      username,
      allowMemoryWrites: true,
      cognitiveMode: 'agent' as const,
    };

    console.log(`${LOG_PREFIX} Executing daydreamer workflow for user: ${username}`);
    const graphResult = await runGraph({ graph, context: graphContext });

    // Extract results from graph execution (node IDs are strings in Svelte Flow format)
    // Node 1: Memory Curator
    const memoryCuratorNode = graphResult.nodes.get('1');
    const memoriesCurated = memoryCuratorNode?.outputs?.count || 0;
    const avgAgeDays = memoryCuratorNode?.outputs?.avgAgeDays || 0;

    if (memoriesCurated < 3) {
      console.log(`${LOG_PREFIX}   Not enough memories for ${username} (found ${memoriesCurated})`);
      audit({
        level: 'info',
        category: 'action',
        event: 'daydream_skipped',
        details: { reason: 'insufficient_memories', memoriesFound: memoriesCurated, username },
        actor: 'daydreamer',
      });
      return { daydreamsGenerated: 0, memoriesCurated };
    }

    console.log(`${LOG_PREFIX}   Curated ${memoriesCurated} memories (avg age: ${avgAgeDays} days)`);

    // Node 2: Daydream Generator
    const daydreamGeneratorNode = graphResult.nodes.get('2');
    const daydream = daydreamGeneratorNode?.outputs?.daydream;
    const daydreamsGenerated = daydream ? 1 : 0;

    if (daydream) {
      console.log(`${LOG_PREFIX}   Daydream generated: "${daydream.slice(0, 50)}..."`);
    } else {
      console.log(`${LOG_PREFIX}   Failed to generate daydream`);
      return { daydreamsGenerated: 0, memoriesCurated };
    }

    // Node 4: Dream Saver (handled by graph)
    const dreamSaverNode = graphResult.nodes.get('4');
    const daydreamSaved = dreamSaverNode?.outputs?.saved || false;
    if (daydreamSaved) {
      console.log(`${LOG_PREFIX}   Daydream saved to episodic memory`);
    }

    // Node 5: Inner Dialogue Capture (handled by graph - this is KEY for UI display)
    const innerDialogueNode = graphResult.nodes.get('5');
    const innerDialogueSaved = innerDialogueNode?.outputs?.saved || false;
    if (innerDialogueSaved) {
      console.log(`${LOG_PREFIX}   Daydream saved to inner dialogue buffer`);
    }

    markBackgroundActivity();

    // Audit handled by node 6 in graph, but we also log here for debugging
    audit({
      level: 'info',
      category: 'action',
      event: 'daydream_generated',
      details: {
        username,
        memoriesUsed: memoriesCurated,
        contentLength: daydream?.length || 0,
        avgMemoryAgeDays: avgAgeDays,
      },
      actor: 'daydreamer',
    });

    return {
      daydreamsGenerated,
      memoriesCurated,
    };
  } catch (error) {
    console.error(`${LOG_PREFIX} Error generating daydream for ${username}:`, error);
    audit({
      category: 'system',
      level: 'error',
      event: 'daydreamer_error',
      details: { error: (error as Error).message, username },
      actor: 'daydreamer',
    });
    return { daydreamsGenerated: 0, memoriesCurated: 0 };
  } finally {
    clearInterval(heartbeat);
    markBackgroundActivity();
  }
}

// ============================================================================
// Main Cycle
// ============================================================================

/**
 * Run a daydreamer cycle (single active user)
 */
export async function runCycle(options: DaydreamerOptions = {}): Promise<DaydreamerResult> {
  console.log(`${LOG_PREFIX} Starting cycle...`);

  const result: DaydreamerResult = {
    success: false,
    daydreamsGenerated: 0,
    memoriesCurated: 0,
    userCount: 0,
    errors: [],
  };

  try {
    const manualTriggerProfile =
      process.env.MH_TRIGGER_PROFILE || process.env.MH_TRIGGER_USERNAME || null;

    console.log(`${LOG_PREFIX} Mind wandering...`);

    // Audit cycle start
    audit({
      level: 'info',
      category: 'action',
      event: 'daydream_started',
      details: {
        agent: 'daydreamer',
        mode: manualTriggerProfile ? 'manual-single' : 'single-active-user',
      },
      actor: 'daydreamer',
    });

    // Get target user
    const activeUser = getTargetUser();

    // Handle manual trigger override
    if (manualTriggerProfile) {
      if (
        !activeUser ||
        (activeUser.username !== manualTriggerProfile &&
          activeUser.userId !== manualTriggerProfile)
      ) {
        console.warn(
          `${LOG_PREFIX} Manual trigger requested for ${manualTriggerProfile} but user is not the active user.`
        );
        result.errors.push(`User ${manualTriggerProfile} is not the currently active user`);
        return result;
      }
    }

    if (!activeUser) {
      console.log(`${LOG_PREFIX} No active users found`);
      result.userCount = 0;
      result.success = true;
      return result;
    }

    console.log(`${LOG_PREFIX} Processing user: ${activeUser.username}`);
    result.userCount = 1;

    // Process the active user
    try {
      const stats = await withUserContext(
        { userId: activeUser.userId, username: activeUser.username, role: activeUser.role },
        async () => generateUserDaydream(activeUser.username, options)
      );

      result.daydreamsGenerated += stats.daydreamsGenerated;
      result.memoriesCurated += stats.memoriesCurated;
    } catch (error) {
      const errorMsg = `User ${activeUser.username}: ${(error as Error).message}`;
      console.error(`${LOG_PREFIX} Failed to process: ${errorMsg}`);
      result.errors.push(errorMsg);
    }

    console.log(
      `${LOG_PREFIX} Cycle finished. Generated ${result.daydreamsGenerated} daydreams for user ${activeUser.username}.`
    );

    // Audit completion
    audit({
      level: 'info',
      category: 'action',
      event: 'daydream_cycle_completed',
      details: {
        agent: 'daydreamer',
        totalDaydreams: result.daydreamsGenerated,
        totalMemories: result.memoriesCurated,
        username: activeUser.username,
      },
      actor: 'daydreamer',
    });

    result.success = result.errors.length === 0;
    return result;
  } catch (error) {
    const errorMsg = (error as Error).message;
    console.error(`${LOG_PREFIX} Error during daydream cycle:`, errorMsg);

    audit({
      level: 'error',
      category: 'action',
      event: 'daydream_failed',
      details: { error: errorMsg },
      actor: 'daydreamer',
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
  const startTime = Date.now();
  const args = input.args || [];
  const opts = input.options || {};

  const options: DaydreamerOptions = {
    forceRun: args.includes('--force') || opts.forceRun === true,
    singleUser: args.includes('--single-user') || opts.singleUser === true,
  };

  try {
    // If running for a specific user context, process just that user
    if (ctx.username && options.singleUser) {
      const stats = await withUserContext(
        { userId: ctx.username, username: ctx.username, role: 'owner' },
        async () => generateUserDaydream(ctx.username, options)
      );

      return {
        success: stats.daydreamsGenerated > 0,
        data: { ...stats, userCount: 1, errors: [] },
        duration: Date.now() - startTime,
        itemsProcessed: stats.daydreamsGenerated,
      };
    }

    // Otherwise run full cycle
    const result = await runCycle(options);

    return {
      success: result.success,
      data: result,
      error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
      duration: Date.now() - startTime,
      itemsProcessed: result.daydreamsGenerated,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      duration: Date.now() - startTime,
    };
  }
}
