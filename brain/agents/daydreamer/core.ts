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

import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT,
  audit,
  getTargetUser,
  withUserContext,
  runGraph,
  validateSvelteFlowGraph,
  getActiveBackend,
  getFirstFailedNode,
  type GraphExecutionState,
  type SvelteFlowGraph,
} from '@metahuman/core';

// ============================================================================
// Types
// ============================================================================

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

export interface DaydreamerExecutionOptions {
  signal?: AbortSignal;
  executionId?: string;
  executionTimestamp?: string;
}

export interface DaydreamerGraphEvaluation extends UserDaydreamerStats {
  avgAgeDays: number;
  skippedReason?: 'insufficient_memories';
}

// ============================================================================
// Constants
// ============================================================================

const LOG_PREFIX = '[daydreamer]';
const MAX_EXECUTION_ID_CHARS = 400;

// ============================================================================
// Helper Functions
// ============================================================================

function getNodeOutputs(
  graph: SvelteFlowGraph,
  graphResult: GraphExecutionState,
  nodeType: string,
): Record<string, any> {
  const matches = graph.nodes.filter(node => node.data.nodeType === nodeType);
  if (matches.length !== 1) {
    throw new Error(`Daydreamer graph requires exactly one ${nodeType} node (found ${matches.length})`);
  }
  return graphResult.nodes.get(matches[0].id)?.outputs || {};
}

export function normalizeTriggerProfile(value: string | undefined): string | null {
  const profile = value?.trim();
  return profile && profile.toLowerCase() !== 'system' ? profile : null;
}

function resolveExecutionIdentity(options: DaydreamerExecutionOptions): {
  executionId: string;
  executionTimestamp: string;
} {
  const executionId = (options.executionId || randomUUID()).trim();
  if (!executionId) throw new Error('Daydreamer executionId must not be empty');
  if (executionId.length > MAX_EXECUTION_ID_CHARS) {
    throw new Error(`Daydreamer executionId must not exceed ${MAX_EXECUTION_ID_CHARS} characters`);
  }
  const timestampInput = options.executionTimestamp || new Date().toISOString();
  if (Number.isNaN(Date.parse(timestampInput))) {
    throw new Error('Daydreamer executionTimestamp must be a valid date');
  }
  return { executionId, executionTimestamp: new Date(timestampInput).toISOString() };
}

export function evaluateDaydreamerGraph(
  graph: SvelteFlowGraph,
  graphResult: GraphExecutionState,
): DaydreamerGraphEvaluation {
  if (graphResult.status !== 'completed') {
    const failure = getFirstFailedNode(graphResult);
    throw new Error(
      failure
        ? `Daydreamer graph failed at node ${failure.nodeId}: ${failure.error}`
        : 'Daydreamer graph did not complete',
    );
  }

  const curator = getNodeOutputs(graph, graphResult, 'dreamer_memory_curator');
  if (curator.error) throw new Error(`Memory curation failed: ${curator.error}`);
  const memoriesCurated = Number(curator.count) || 0;
  const avgAgeDays = Number(curator.avgAgeDays) || 0;
  if (memoriesCurated < 3) {
    return {
      daydreamsGenerated: 0,
      memoriesCurated,
      avgAgeDays,
      skippedReason: 'insufficient_memories',
    };
  }

  const generator = getNodeOutputs(graph, graphResult, 'daydreamer_generator');
  if (generator.error) throw new Error(`Daydream generation failed: ${generator.error}`);
  if (typeof generator.daydream !== 'string' || !generator.daydream.trim()) {
    throw new Error('Daydream generator completed without daydream content');
  }

  const saver = getNodeOutputs(graph, graphResult, 'dreamer_dream_saver');
  if (!saver.saved) {
    throw new Error(`Episodic daydream persistence failed: ${saver.error || 'unknown error'}`);
  }

  const innerDialogue = getNodeOutputs(graph, graphResult, 'inner_dialogue_buffer');
  if (!innerDialogue.saved) {
    throw new Error(`Inner-dialogue persistence failed: ${innerDialogue.error || innerDialogue.reason || 'unknown error'}`);
  }

  return {
    daydreamsGenerated: 1,
    memoriesCurated,
    avgAgeDays,
  };
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
  options: DaydreamerExecutionOptions = {},
): Promise<UserDaydreamerStats> {
  console.log(`${LOG_PREFIX} Processing user: ${username}`);

  try {
    const identity = resolveExecutionIdentity(options);
    // Log which backend is active (model router handles actual availability)
    try {
      const backend = getActiveBackend();
      console.log(`${LOG_PREFIX} Using LLM backend: ${backend}`);
    } catch {
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
      idempotencyKey: `daydreamer:${username}:${identity.executionId}`,
      memoryTimestamp: identity.executionTimestamp,
      abortSignal: options.signal,
    };

    console.log(`${LOG_PREFIX} Executing daydreamer workflow for user: ${username}`);
    const graphResult = await runGraph({ graph, context: graphContext, signal: options.signal });
    const evaluation = evaluateDaydreamerGraph(graph, graphResult);

    if (evaluation.skippedReason === 'insufficient_memories') {
      console.log(`${LOG_PREFIX}   Not enough memories for ${username} (found ${evaluation.memoriesCurated})`);
      audit({
        level: 'info',
        category: 'action',
        event: 'daydream_skipped',
        details: {
          reason: evaluation.skippedReason,
          memoriesFound: evaluation.memoriesCurated,
          username,
        },
        actor: 'daydreamer',
      });
      return evaluation;
    }

    console.log(
      `${LOG_PREFIX}   Curated ${evaluation.memoriesCurated} memories `
      + `(avg age: ${evaluation.avgAgeDays} days)`,
    );
    console.log(`${LOG_PREFIX}   Daydream persisted to episodic memory and inner dialogue`);

    return {
      daydreamsGenerated: evaluation.daydreamsGenerated,
      memoriesCurated: evaluation.memoriesCurated,
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
    throw error;
  }
}

// ============================================================================
// Main Cycle
// ============================================================================

/**
 * Run a daydreamer cycle (single active user)
 */
export async function runCycle(): Promise<DaydreamerResult> {
  console.log(`${LOG_PREFIX} Starting cycle...`);

  const result: DaydreamerResult = {
    success: false,
    daydreamsGenerated: 0,
    memoriesCurated: 0,
    userCount: 0,
    errors: [],
  };

  try {
    const triggerProfile = normalizeTriggerProfile(
      process.env.MH_TRIGGER_PROFILE || process.env.MH_TRIGGER_USERNAME,
    );

    console.log(`${LOG_PREFIX} Mind wandering...`);

    // Audit cycle start
    audit({
      level: 'info',
      category: 'action',
      event: 'daydream_started',
      details: {
        agent: 'daydreamer',
        mode: triggerProfile ? 'targeted-single-user' : 'single-active-user',
      },
      actor: 'daydreamer',
    });

    // Get target user
    const activeUser = getTargetUser();

    // Handle manual trigger override
    if (triggerProfile) {
      if (
        !activeUser ||
        (activeUser.username !== triggerProfile &&
          activeUser.userId !== triggerProfile)
      ) {
        console.warn(
          `${LOG_PREFIX} Trigger requested for ${triggerProfile} but user is not the active user.`
        );
        result.errors.push(`User ${triggerProfile} is not the currently active user`);
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
        async () => generateUserDaydream(activeUser.username, {
          executionId: process.env.MH_TASK_ID,
          executionTimestamp: process.env.MH_TASK_CREATED_AT,
        }),
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

    result.success = result.errors.length === 0;

    // Audit the actual coordinator outcome without duplicating private content.
    audit({
      level: result.success ? 'info' : 'error',
      category: 'action',
      event: result.success ? 'daydream_cycle_completed' : 'daydream_cycle_failed',
      details: {
        agent: 'daydreamer',
        totalDaydreams: result.daydreamsGenerated,
        totalMemories: result.memoriesCurated,
        errorCount: result.errors.length,
        username: activeUser.username,
      },
      actor: 'daydreamer',
    });

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
