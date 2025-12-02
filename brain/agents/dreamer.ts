/**
 * Dreamer Agent (REFACTORED)
 *
 * Enhanced version using node-based cognitive graph workflow that:
 * 1. Curates a weighted sample of diverse memories from lifetime
 * 2. Generates surreal dream narratives using LLM
 * 3. Generates continuation dreams probabilistically
 * 4. Extracts preferences and heuristics using LLM
 * 5. Writes overnight learnings to procedural memory
 *
 * SECURITY: Uses node-based workflow with explicit user path isolation
 * REFACTOR: Migrated from legacy LLM calls to graph execution (2025-11-26)
 *
 * MULTI-USER: Processes all users sequentially with isolated contexts.
 */

import {
  storageClient,
  ROOT,
  systemPaths,
  acquireLock,
  isLocked,
  audit,
  recordSystemActivity,
  scheduler,
  listUsers,
  withUserContext,
  initGlobalLogger,
  executeGraph,
  validateCognitiveGraph,
  type CognitiveGraph,
  ollama,
} from '../../packages/core/src/index.js';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

interface SleepConfig {
  enabled: boolean;
  maxDreamsPerNight: number;
  evaluate: boolean;
}

function markBackgroundActivity() {
  try {
    recordSystemActivity();
  } catch {}

  try {
    scheduler.recordActivity();
  } catch {}
}

function loadSleepConfig(): SleepConfig {
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
async function loadDreamerGraph(): Promise<CognitiveGraph> {
  const graphPath = path.join(ROOT, 'etc', 'cognitive-graphs', 'dreamer-mode.json');
  const raw = await fsp.readFile(graphPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return validateCognitiveGraph(parsed);
}

/**
 * Generate dreams and learnings for a single user using node-based workflow
 *
 * SECURITY: All memory access is user-specific via context.userId
 */
async function generateUserDreams(
  username: string,
  options: { forceRun?: boolean; config?: SleepConfig } = {}
): Promise<{
  dreamsGenerated: number;
  memoriesCurated: number;
  preferencesExtracted: number;
  heuristicsExtracted: number;
}> {
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

    // Preflight: ensure Ollama is available
    const running = await ollama.isRunning();
    if (!running) {
      console.warn('[dreamer] Ollama is not running; skipping dream generation. Start with: ollama serve');
      audit({
        category: 'system',
        level: 'warn',
        event: 'dreamer_skipped',
        details: { reason: 'ollama_not_running' },
        actor: 'dreamer',
      });
      return { dreamsGenerated: 0, memoriesCurated: 0, preferencesExtracted: 0, heuristicsExtracted: 0 };
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

    // Extract results from graph execution
    // Node 1: Memory Curator
    const memoryCuratorNode = graphResult.nodes.get(1);
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
    const dreamGeneratorNode = graphResult.nodes.get(2);
    const initialDream = dreamGeneratorNode?.outputs?.dream;
    let dreamsGenerated = initialDream ? 1 : 0;

    if (initialDream) {
      console.log(`[dreamer]   Initial dream generated for ${username}`);
    }

    // Node 3: Dream Saver (handled by graph)
    const dreamSaverNode = graphResult.nodes.get(3);
    const dreamSaved = dreamSaverNode?.outputs?.saved || false;
    if (dreamSaved) {
      console.log(`[dreamer]   Dream saved to episodic memory`);
    }

    // Node 4: Continuation Generator
    const continuationNode = graphResult.nodes.get(4);
    const continuationCount = continuationNode?.outputs?.count || 0;
    dreamsGenerated += continuationCount;

    if (continuationCount > 0) {
      console.log(`[dreamer]   Generated ${continuationCount} continuation dreams`);
    }

    // Node 5: Learnings Extractor
    const learningsExtractorNode = graphResult.nodes.get(5);
    const preferences = learningsExtractorNode?.outputs?.preferences || [];
    const heuristics = learningsExtractorNode?.outputs?.heuristics || [];
    const styleNotes = learningsExtractorNode?.outputs?.styleNotes || [];
    const avoidances = learningsExtractorNode?.outputs?.avoidances || [];

    console.log(`[dreamer]   Extracted ${preferences.length} preferences, ${heuristics.length} heuristics`);

    // Node 6: Learnings Writer
    const learningsWriterNode = graphResult.nodes.get(6);
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

/**
 * Main dreaming cycle (multi-user)
 */
async function run() {
  initGlobalLogger('dreamer');

  // Single-instance guard
  let lock;
  try {
    if (isLocked('agent-dreamer')) {
      console.log('[dreamer] Another instance is already running. Exiting.');
      return;
    }
    lock = acquireLock('agent-dreamer');
  } catch {
    console.log('[dreamer] Failed to acquire lock. Exiting.');
    return;
  }

  try {
    const globalConfig = loadSleepConfig();
    const manualTriggerProfile = process.env.MH_TRIGGER_PROFILE || process.env.MH_TRIGGER_USERNAME || null;

    if (!globalConfig.enabled && !manualTriggerProfile) {
      console.log('[dreamer] Sleep system disabled and no manual trigger detected. Exiting.');
      return;
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

    // Get all users (or targeted user if manual trigger)
    const allUsers = listUsers();
    const users = manualTriggerProfile
      ? allUsers.filter(u => u.username === manualTriggerProfile || u.id === manualTriggerProfile)
      : allUsers;

    if (manualTriggerProfile && users.length === 0) {
      console.warn(`[dreamer] Manual trigger requested for ${manualTriggerProfile} but no matching user found.`);
      return;
    }

    console.log(`[dreamer] Found ${users.length} users to process`);

    let totalDreams = 0;
    let totalMemories = 0;
    let totalPreferences = 0;
    let totalHeuristics = 0;

    // Process each user with isolated context
    for (const user of users) {
      try {
        const stats = await withUserContext(
          { userId: user.id, username: user.username, role: user.role },
          async () => generateUserDreams(user.username, {
            forceRun: !!manualTriggerProfile,
            config: globalConfig,
          })
        );

        totalDreams += stats.dreamsGenerated;
        totalMemories += stats.memoriesCurated;
        totalPreferences += stats.preferencesExtracted;
        totalHeuristics += stats.heuristicsExtracted;
      } catch (error) {
        console.error(`[dreamer] Failed to process user ${user.username}:`, (error as Error).message);
        // Continue with next user
      }
      if (manualTriggerProfile) {
        break; // manual run processes only the triggering profile
      }
    }

    console.log(`[dreamer] Cycle finished. Generated ${totalDreams} dreams across ${users.length} users. ✅`);

    // Audit completion (system-level)
    audit({
      level: 'info',
      category: 'action',
      event: 'sleep_cycle_completed',
      details: {
        agent: 'dreamer',
        mode: manualTriggerProfile ? 'manual-single' : 'multi-user',
        totalDreams,
        totalMemories,
        totalPreferences,
        totalHeuristics,
        userCount: users.length,
        usedGraph: true,
      },
      actor: 'dreamer',
    });
  } catch (error) {
    console.error('[dreamer] Error during sleep cycle:', error);
    audit({
      level: 'error',
      category: 'action',
      event: 'sleep_failed',
      details: { error: (error as Error).message },
      actor: 'dreamer',
    });
  } finally {
    lock.release();
  }
}

run().catch(console.error);
