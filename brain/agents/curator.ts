#!/usr/bin/env node
/**
 * Curator Agent - Prepares clean, persona-friendly training data
 *
 * This agent:
 * - Processes raw episodic memories into curated summaries (LLM-based)
 * - Removes tool syntax, JSON, and operator transcripts
 * - Extracts conversational essence for LoRA training
 * - Generates training-ready conversation pairs
 * - Flags sensitive data for review
 * - Runs incrementally (processes ~50 uncurated memories per run)
 *
 * Part of Phase 3: Multi-Model Orchestration
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// Import from core
import {
  acquireLock,
  isLocked,
  initGlobalLogger,
  withUserContext,
  getUserContext,
  executeGraph,
  validateCognitiveGraph,
  audit,
  ROOT,
  type CognitiveGraph,
} from '../../packages/core/src/index.js';
import { registerAgent, unregisterAgent } from '../../packages/core/src/agent-monitor.js';
import { requireUserInfo } from '../../packages/core/src/user-resolver.js';

/**
 * Load curator cognitive graph
 */
async function loadCuratorGraph(): Promise<CognitiveGraph> {
  const graphPath = path.join(ROOT, 'etc', 'cognitive-graphs', 'curator-mode.json');
  const raw = await fs.readFile(graphPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return validateCognitiveGraph(parsed);
}

/**
 * Main curator process (runs with user context)
 */
async function mainWithContext() {
  const ctx = getUserContext();

  if (!ctx || !ctx.profilePaths) {
    console.error('[Curator] ERROR: No user context found');
    process.exit(1);
  }

  const lockName = `curator-${ctx.username}`;
  if (isLocked(lockName)) {
    console.log(`[Curator] Another instance is already running for user ${ctx.username}. Exiting.`);
    process.exit(0);
  }

  let lockHandle;
  try {
    lockHandle = acquireLock(lockName);

    // Register in agent monitor so it shows up while running
    registerAgent('curator', process.pid);

    console.log(`[Curator] Starting LLM-based curation for user: ${ctx.username}`);

    // Load curator cognitive graph
    const graph = await loadCuratorGraph();

    // Execute graph with context
    const graphContext = {
      userId: ctx.username,
      allowMemoryWrites: true,
      cognitiveMode: 'dual' as const,  // Use dual mode to get the 30B coder model
    };

    console.log('[Curator] Executing curator workflow graph...');
    const graphResult = await executeGraph(graph, graphContext);

    // Extract results from graph execution
    const curatorLLMNode = graphResult.nodes.get(4);
    const memoriesProcessed = curatorLLMNode?.outputs?.count || 0;

    console.log(`[Curator] ✅ Processed ${memoriesProcessed} memories`);

    audit({
      category: 'action',
      level: 'info',
      event: 'curator_completed',
      actor: 'curator',
      details: {
        username: ctx.username,
        memoriesProcessed,
      },
    });

  } catch (error) {
    console.error('[Curator] Fatal error:', error);
    audit({
      category: 'action',
      level: 'error',
      event: 'curator_failed',
      actor: 'curator',
      details: {
        error: (error as Error).message,
      },
    });
    process.exit(1);
  } finally {
    // Unregister from agent monitor
    unregisterAgent('curator');

    if (lockHandle) {
      lockHandle.release();
    }
  }
}

/**
 * Main entry point (handles multi-user context)
 */
async function main() {
  initGlobalLogger('curator');

  // Try to get username from environment variable first (API trigger), then CLI args
  let username: string | null = process.env.MH_TRIGGER_USERNAME || null;

  if (!username) {
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--username' && i + 1 < args.length) {
        username = args[i + 1];
        break;
      }
    }
  }

  if (!username) {
    console.error('[Curator] ERROR: --username <name> is required');
    console.error('\nUsage: tsx brain/agents/curator.ts --username <username>');
    console.error('Or set MH_TRIGGER_USERNAME environment variable when running from API');
    process.exit(1);
  }

  const userInfo = requireUserInfo(username);
  await withUserContext(userInfo, mainWithContext);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main as runCurator };
