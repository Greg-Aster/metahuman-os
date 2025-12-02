#!/usr/bin/env tsx
/**
 * Curiosity Service Agent (REFACTORED)
 *
 * Monitors user inactivity and asks thoughtful questions when appropriate.
 * Respects maxOpenQuestions limit and trust/autonomy policies.
 *
 * SECURITY: Uses node-based workflow with explicit user path isolation
 * REFACTOR: Migrated from legacy LLM calls to graph execution (2025-11-24)
 *
 * MULTI-USER: Processes all users sequentially with isolated contexts.
 */

import {
  ROOT,
  audit,
  acquireLock,
  isLocked,
  initGlobalLogger,
  getLoggedInUsers,
  withUserContext,
  loadCuriosityConfig,
  loadTrustLevel,
  executeGraph,
  validateCognitiveGraph,
  type CognitiveGraph,
  ollama
} from '@metahuman/core';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * NOTE: User activity detection is now handled by the scheduler (agent-scheduler.ts).
 * This service is only triggered after inactivityThreshold seconds of conversation inactivity.
 */

/**
 * Load curiosity cognitive graph
 */
async function loadCuriosityGraph(): Promise<CognitiveGraph> {
  const graphPath = path.join(ROOT, 'etc', 'cognitive-graphs', 'curiosity-mode.json');
  const raw = await fs.readFile(graphPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return validateCognitiveGraph(parsed);
}

/**
 * Generate a curiosity question for a single user using node-based workflow
 *
 * SECURITY: All memory access is user-specific via context.userId
 */
async function generateUserQuestion(username: string): Promise<boolean> {
  console.log(`[curiosity-service] Processing user: ${username}`);

  const config = loadCuriosityConfig();
  const trust = loadTrustLevel();

  // Check if system is enabled
  if (config.maxOpenQuestions === 0) {
    console.log(`[curiosity-service] Curiosity disabled (maxOpenQuestions = 0)`);
    return false;
  }

  // Check if user has permission (min trust level)
  const trustLevels = ['observe', 'suggest', 'trusted', 'supervised_auto', 'bounded_auto', 'adaptive_auto'];
  const currentTrustIdx = trustLevels.indexOf(trust);
  const requiredTrustIdx = trustLevels.indexOf(config.minTrustLevel);

  if (currentTrustIdx < requiredTrustIdx) {
    console.log(`[curiosity-service] Trust level ${trust} below minimum ${config.minTrustLevel}, skipping`);
    return false;
  }

  // NOTE: Inactivity check removed - scheduler (agent-scheduler.ts) now handles this
  // via activity-based triggering. The scheduler only runs this service after
  // inactivityThreshold seconds of conversation inactivity.

  try {
    // Preflight: ensure Ollama is available
    const running = await ollama.isRunning();
    if (!running) {
      console.warn('[curiosity-service] Ollama is not running; skipping question generation. Start with: ollama serve');
      audit({
        category: 'system',
        level: 'warn',
        message: 'Curiosity service skipped: Ollama not running',
        actor: 'curiosity-service',
      });
      return false;
    }

    // Load curiosity cognitive graph
    const graph = await loadCuriosityGraph();

    // Execute graph with user context
    // SECURITY: userId is passed explicitly to ensure user-specific path resolution
    const graphContext = {
      userId: username,
      allowMemoryWrites: true,
      cognitiveMode: 'agent' as const,
      questionIntervalSeconds: config.questionIntervalSeconds || 1800, // 30 min default
    };

    console.log(`[curiosity-service] Executing curiosity workflow for user: ${username}`);
    const graphResult = await executeGraph(graph, graphContext);

    // Extract results from graph execution
    const activityCheckNode = graphResult.nodes.get(1);
    const canAsk = activityCheckNode?.output?.canAsk;

    if (!canAsk) {
      const timeSince = activityCheckNode?.output?.timeSinceLastQuestion;
      console.log(`[curiosity-service] Cannot ask yet - only ${Math.round((timeSince || 0) / 60)}min since last question`);
      return false;
    }

    const samplerNode = graphResult.nodes.get(3);
    const questionGeneratorNode = graphResult.nodes.get(4);
    const saverNode = graphResult.nodes.get(5);

    const memoriesCount = samplerNode?.output?.count || 0;
    const question = questionGeneratorNode?.output?.question || '';
    const questionId = saverNode?.output?.questionId;
    const saved = saverNode?.output?.saved;

    if (!saved || !question) {
      console.log(`[curiosity-service] Failed to generate or save question`);
      return false;
    }

    console.log(`[curiosity-service] Asked question (ID: ${questionId}): "${question.substring(0, 60)}..."`);
    console.log(`[curiosity-service] Based on ${memoriesCount} weighted memories`);

    // Audit successful question generation
    audit({
      category: 'decision',
      level: 'info',
      message: 'Curiosity service generated question',
      actor: 'curiosity-service',
      metadata: {
        questionId,
        questionPreview: question.substring(0, 100),
        memoriesConsidered: memoriesCount,
        trust,
        autonomy: 'normal',
        username,
        usedGraph: true,
      }
    });

    return true;

  } catch (error) {
    console.error(`[curiosity-service] Error generating question for ${username}:`, error);
    audit({
      category: 'system',
      level: 'error',
      message: `Curiosity service error for ${username}: ${(error as Error).message}`,
      actor: 'curiosity-service',
      metadata: { error: (error as Error).stack, username }
    });
    return false;
  }
}

/**
 * Main entry point - processes all logged-in users
 */
async function run() {
  initGlobalLogger('curiosity-service');

  // Single-instance guard
  let lock;
  try {
    if (isLocked('agent-curiosity')) {
      console.log('[curiosity-service] Another instance is already running. Exiting.');
      return;
    }
    lock = acquireLock('agent-curiosity');
  } catch {
    console.log('[curiosity-service] Failed to acquire lock. Exiting.');
    return;
  }

  console.log('[curiosity-service] Starting curiosity cycle (logged-in users only)...');

  audit({
    category: 'action',
    level: 'info',
    event: 'curiosity_service_start',
    details: { phase: 'cycle_start' },
    actor: 'curiosity-service'
  });

  try {
    // Get all logged-in users (active sessions only)
    const loggedInUsers = getLoggedInUsers();

    if (loggedInUsers.length === 0) {
      console.log('[curiosity-service] No logged-in users found, exiting.');
      return;
    }

    console.log(`[curiosity-service] Processing ${loggedInUsers.length} logged-in user(s)...`);

    let totalQuestionsAsked = 0;

    // Process each logged-in user sequentially with isolated context
    for (const user of loggedInUsers) {
      console.log(`[curiosity-service] Processing user: ${user.username}`);

      try {
        // SECURITY: withUserContext ensures user-specific path resolution
        const asked = await withUserContext(
          { userId: user.userId, username: user.username, role: user.role },
          async () => {
            return await generateUserQuestion(user.username);
          }
        );
        // Context automatically cleaned up - no leakage to next user

        if (asked) totalQuestionsAsked++;
      } catch (error) {
        console.error(`[curiosity-service] Failed to process user ${user.username}:`, (error as Error).message);
        audit({
          category: 'system',
          level: 'error',
          event: 'curiosity_service_user_error',
          details: {
            error: (error as Error).message,
            username: user.username
          },
          actor: 'curiosity-service'
        });
      }
    }

    console.log(`[curiosity-service] Cycle complete. Asked ${totalQuestionsAsked} questions across ${loggedInUsers.length} user(s).`);

    audit({
      category: 'action',
      level: 'info',
      event: 'curiosity_service_complete',
      details: {
        questionsAsked: totalQuestionsAsked,
        usersProcessed: loggedInUsers.length
      },
      actor: 'curiosity-service'
    });

  } finally {
    lock.release();
  }
}

run().catch(console.error);
