/**
 * Dreamer Agent — Core Logic
 *
 * Enhanced version using node-based cognitive graph workflow that:
 * 1. Curates a weighted sample of diverse memories from lifetime
 * 2. Generates surreal dream narratives using LLM
 * 3. Generates continuation dreams probabilistically
 * 4. Extracts preferences and heuristics using LLM
 * 5. Writes overnight learnings to procedural memory
 *
 * This module can be used both:
 * - CLI: via cli.ts wrapper
 * - Mobile: imported directly and run in-process
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  storageClient,
  ROOT,
  systemPaths,
  audit,
  recordSystemActivity,
  scheduler,
  getLoggedInUsers,
  withUserContext,
  executeGraph,
  validateSvelteFlowGraph,
  getActiveBackend,
  type SvelteFlowGraph,
} from '@metahuman/core';
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';

// ============================================================================
// Types
// ============================================================================

export interface SleepConfig {
  enabled: boolean;
  maxDreamsPerNight: number;
  evaluate: boolean;
}

export interface DreamerOptions {
  forceRun?: boolean;
  config?: SleepConfig;
  singleUser?: boolean;
}

export interface DreamerResult {
  success: boolean;
  dreamsGenerated: number;
  memoriesCurated: number;
  preferencesExtracted: number;
  heuristicsExtracted: number;
  userCount: number;
  errors: string[];
}

export interface UserDreamerStats {
  dreamsGenerated: number;
  memoriesCurated: number;
  preferencesExtracted: number;
  heuristicsExtracted: number;
}

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

export function loadSleepConfig(): SleepConfig {
  try {
    // Try user-specific config first, fall back to system config
    const result = storageClient.resolvePath({ category: 'config', subcategory: 'etc', relativePath: 'sleep.json' });
    const configPath = result.success && result.path ? result.path : path.join(systemPaths.etc, 'sleep.json');
    const data = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.warn('[dreamer] Could not load sleep.json, using defaults');
    return {
      enabled: true,
      maxDreamsPerNight: 3,
      evaluate: true,
    };
  }
}

/**
 * Load dreamer cognitive graph
 */
export async function loadDreamerGraph(): Promise<SvelteFlowGraph> {
  const graphPath = path.join(ROOT, 'etc', 'cognitive-graphs', 'dreamer-mode.json');
  const raw = await fsp.readFile(graphPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return validateSvelteFlowGraph(parsed);
}

// ============================================================================
// Dream Generation
// ============================================================================

/**
 * Generate dreams and learnings for a single user using node-based workflow
 *
 * SECURITY: All memory access is user-specific via context.userId
 */
export async function generateUserDreams(
  username: string,
  options: DreamerOptions = {}
): Promise<UserDreamerStats> {
  console.log(`[dreamer] Processing user: ${username}`);
  const heartbeat = setInterval(() => {
    markBackgroundActivity();
  }, 15000);

  try {
    const config = options.config || loadSleepConfig();

    if (!config.enabled && !options.forceRun) {
      console.log(`[dreamer]   Sleep system disabled for ${username}`);
      return { dreamsGenerated: 0, memoriesCurated: 0, preferencesExtracted: 0, heuristicsExtracted: 0 };
    }

    // Log which backend is active (model router handles actual availability)
    try {
      const backend = getActiveBackend();
      console.log(`[dreamer] Using LLM backend: ${backend}`);
    } catch (e) {
      console.log('[dreamer] Using model router (backend auto-selected)');
    }

    // Load dreamer cognitive graph
    const graph = await loadDreamerGraph();

    // Execute graph with user context
    // SECURITY: userId is passed explicitly to ensure user-specific path resolution
    const graphContext = {
      userId: username,
      username,
      allowMemoryWrites: true,
      cognitiveMode: 'agent' as const,
    };

    console.log(`[dreamer] Executing dreamer workflow for user: ${username}`);
    const graphResult = await executeGraph(graph, graphContext);

    // Extract results from graph execution (node IDs are strings in Svelte Flow format)
    // Node 1: Memory Curator
    const memoryCuratorNode = graphResult.nodes.get('1');
    const memoriesCurated = memoryCuratorNode?.outputs?.count || 0;
    const avgAgeDays = memoryCuratorNode?.outputs?.avgAgeDays || 0;
    const oldestAgeDays = memoryCuratorNode?.outputs?.oldestAgeDays || 0;

    if (memoriesCurated < 3) {
      console.log(`[dreamer]   Not enough memories for ${username} (found ${memoriesCurated})`);
      audit({
        level: 'info',
        category: 'action',
        event: 'sleep_skipped',
        details: { reason: 'insufficient_memories', memoriesFound: memoriesCurated, username },
        actor: 'dreamer',
      });
      return { dreamsGenerated: 0, memoriesCurated, preferencesExtracted: 0, heuristicsExtracted: 0 };
    }

    console.log(`[dreamer]   Curated ${memoriesCurated} memories (avg age: ${avgAgeDays} days, oldest: ${oldestAgeDays} days)`);

    // Node 2: Dream Generator
    const dreamGeneratorNode = graphResult.nodes.get('2');
    const initialDream = dreamGeneratorNode?.outputs?.dream;
    let dreamsGenerated = initialDream ? 1 : 0;

    if (initialDream) {
      console.log(`[dreamer]   Initial dream generated for ${username}`);
    }

    // Node 3: Dream Saver (handled by graph)
    const dreamSaverNode = graphResult.nodes.get('3');
    const dreamSaved = dreamSaverNode?.outputs?.saved || false;
    if (dreamSaved) {
      console.log(`[dreamer]   Dream saved to episodic memory`);
    }

    // Node 4: Continuation Generator
    const continuationNode = graphResult.nodes.get('4');
    const continuationCount = continuationNode?.outputs?.count || 0;
    dreamsGenerated += continuationCount;

    if (continuationCount > 0) {
      console.log(`[dreamer]   Generated ${continuationCount} continuation dreams`);
    }

    // Node 5: Learnings Extractor
    const learningsExtractorNode = graphResult.nodes.get('5');
    const preferences = learningsExtractorNode?.outputs?.preferences || [];
    const heuristics = learningsExtractorNode?.outputs?.heuristics || [];
    const styleNotes = learningsExtractorNode?.outputs?.styleNotes || [];
    const avoidances = learningsExtractorNode?.outputs?.avoidances || [];

    console.log(`[dreamer]   Extracted ${preferences.length} preferences, ${heuristics.length} heuristics`);

    // Node 6: Learnings Writer
    const learningsWriterNode = graphResult.nodes.get('6');
    const learningsWritten = learningsWriterNode?.outputs?.written || false;
    const learningsFilename = learningsWriterNode?.outputs?.filename || '';

    if (learningsWritten) {
      console.log(`[dreamer]   Overnight learnings written: ${learningsFilename}`);
    }

    markBackgroundActivity();

    audit({
      level: 'info',
      category: 'action',
      event: 'sleep_completed',
      details: {
        dreamsGenerated,
        memoriesCurated,
        continuationCount,
        learningsFile: learningsFilename,
        preferencesExtracted: preferences.length,
        heuristicsExtracted: heuristics.length,
        styleNotesExtracted: styleNotes.length,
        avoidancesExtracted: avoidances.length,
        username,
        usedGraph: true,
      },
      actor: 'dreamer',
    });

    return {
      dreamsGenerated,
      memoriesCurated,
      preferencesExtracted: preferences.length,
      heuristicsExtracted: heuristics.length,
    };
  } catch (error) {
    console.error(`[dreamer] Error generating dreams for ${username}:`, error);
    audit({
      category: 'system',
      level: 'error',
      event: 'dreamer_error',
      details: { error: (error as Error).message, username },
      actor: 'dreamer',
    });
    return { dreamsGenerated: 0, memoriesCurated: 0, preferencesExtracted: 0, heuristicsExtracted: 0 };
  } finally {
    clearInterval(heartbeat);
    markBackgroundActivity();
  }
}

// ============================================================================
// Main Cycle
// ============================================================================

/**
 * Run a full dreamer cycle (multi-user)
 */
export async function runCycle(options: DreamerOptions = {}): Promise<DreamerResult> {
  console.log('[dreamer] Starting cycle...');

  const result: DreamerResult = {
    success: false,
    dreamsGenerated: 0,
    memoriesCurated: 0,
    preferencesExtracted: 0,
    heuristicsExtracted: 0,
    userCount: 0,
    errors: [],
  };

  try {
    const globalConfig = options.config || loadSleepConfig();
    const manualTriggerProfile = process.env.MH_TRIGGER_PROFILE || process.env.MH_TRIGGER_USERNAME || null;

    if (!globalConfig.enabled && !manualTriggerProfile && !options.forceRun) {
      console.log('[dreamer] Sleep system disabled and no manual trigger detected. Exiting.');
      result.success = true;
      return result;
    }

    console.log('[dreamer] Drifting into a dream (multi-user)...');

    // Audit cycle start (system-level)
    audit({
      level: 'info',
      category: 'action',
      event: 'sleep_started',
      details: {
        agent: 'dreamer',
        mode: manualTriggerProfile ? 'manual-single' : 'multi-user',
        usedGraph: true,
      },
      actor: 'dreamer',
    });

    // Get all logged-in users (or targeted user if manual trigger)
    const allUsers = getLoggedInUsers();
    const users = manualTriggerProfile
      ? allUsers.filter(u => u.username === manualTriggerProfile || u.userId === manualTriggerProfile)
      : allUsers;

    if (manualTriggerProfile && users.length === 0) {
      console.warn(`[dreamer] Manual trigger requested for ${manualTriggerProfile} but no matching user found.`);
      result.errors.push(`No matching user found for ${manualTriggerProfile}`);
      return result;
    }

    console.log(`[dreamer] Found ${users.length} logged-in users to process`);
    result.userCount = users.length;

    // Process each user with isolated context
    for (const user of users) {
      try {
        const stats = await withUserContext(
          { userId: user.userId, username: user.username, role: user.role },
          async () => generateUserDreams(user.username, {
            forceRun: !!manualTriggerProfile || options.forceRun,
            config: globalConfig,
          })
        );

        result.dreamsGenerated += stats.dreamsGenerated;
        result.memoriesCurated += stats.memoriesCurated;
        result.preferencesExtracted += stats.preferencesExtracted;
        result.heuristicsExtracted += stats.heuristicsExtracted;
      } catch (error) {
        const errorMsg = `User ${user.username}: ${(error as Error).message}`;
        console.error(`[dreamer] Failed to process: ${errorMsg}`);
        result.errors.push(errorMsg);
      }

      if (manualTriggerProfile) {
        break; // manual run processes only the triggering profile
      }
    }

    console.log(`[dreamer] Cycle finished. Generated ${result.dreamsGenerated} dreams across ${users.length} users.`);

    // Audit completion (system-level)
    audit({
      level: 'info',
      category: 'action',
      event: 'sleep_cycle_completed',
      details: {
        agent: 'dreamer',
        mode: manualTriggerProfile ? 'manual-single' : 'multi-user',
        totalDreams: result.dreamsGenerated,
        totalMemories: result.memoriesCurated,
        totalPreferences: result.preferencesExtracted,
        totalHeuristics: result.heuristicsExtracted,
        userCount: users.length,
        usedGraph: true,
      },
      actor: 'dreamer',
    });

    result.success = result.errors.length === 0;
    return result;
  } catch (error) {
    const errorMsg = (error as Error).message;
    console.error('[dreamer] Error during sleep cycle:', errorMsg);

    audit({
      level: 'error',
      category: 'action',
      event: 'sleep_failed',
      details: { error: errorMsg },
      actor: 'dreamer',
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

  const options: DreamerOptions = {
    forceRun: args.includes('--force') || opts.forceRun === true,
    singleUser: args.includes('--single-user') || opts.singleUser === true,
  };

  try {
    // If running for a specific user context, process just that user
    if (ctx.username && options.singleUser) {
      const stats = await withUserContext(
        { userId: ctx.username, username: ctx.username, role: 'owner' },
        async () => generateUserDreams(ctx.username, options)
      );

      return {
        success: stats.dreamsGenerated > 0 || stats.memoriesCurated > 0,
        data: { ...stats, userCount: 1, errors: [] },
        duration: Date.now() - startTime,
        itemsProcessed: stats.dreamsGenerated,
      };
    }

    // Otherwise run full cycle
    const result = await runCycle(options);

    return {
      success: result.success,
      data: result,
      error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
      duration: Date.now() - startTime,
      itemsProcessed: result.dreamsGenerated,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      duration: Date.now() - startTime,
    };
  }
}
