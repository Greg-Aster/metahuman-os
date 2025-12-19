/**
 * Curiosity Service Agent — Core Logic
 *
 * Monitors user inactivity and asks thoughtful questions when appropriate.
 * Respects maxOpenQuestions limit and trust/autonomy policies.
 *
 * This module can be used both:
 * - CLI: via cli.ts wrapper
 * - Mobile: imported directly and run in-process
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT,
  audit,
  getLoggedInUsers,
  withUserContext,
  loadCuriosityConfig,
  loadTrustLevel,
  executeGraph,
  validateSvelteFlowGraph,
  getActiveBackend,
  type SvelteFlowGraph,
} from '@metahuman/core';
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';

// ============================================================================
// Types
// ============================================================================

export interface CuriosityServiceOptions {
  singleUser?: boolean;
}

export interface CuriosityServiceResult {
  success: boolean;
  questionsAsked: number;
  userCount: number;
  errors: string[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Load curiosity cognitive graph
 */
export async function loadCuriosityGraph(): Promise<SvelteFlowGraph> {
  const graphPath = path.join(ROOT, 'etc', 'cognitive-graphs', 'curiosity-mode.json');
  const raw = await fs.readFile(graphPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return validateSvelteFlowGraph(parsed);
}

// ============================================================================
// Question Generation
// ============================================================================

/**
 * Generate a curiosity question for a single user using node-based workflow
 *
 * SECURITY: All memory access is user-specific via context.userId
 */
export async function generateUserQuestion(username: string): Promise<boolean> {
  console.log(`[curiosity-service] Processing user: ${username}`);

  const config = loadCuriosityConfig(username);
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

  try {
    // Log which backend is active (model router handles actual availability)
    try {
      const backend = getActiveBackend();
      console.log(`[curiosity-service] Using LLM backend: ${backend}`);
    } catch (e) {
      console.log('[curiosity-service] Using model router (backend auto-selected)');
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

    // Extract results from graph execution (node IDs are strings in Svelte Flow format)
    const activityCheckNode = graphResult.nodes.get('1');
    const canAsk = activityCheckNode?.outputs?.canAsk;

    if (!canAsk) {
      const timeSince = activityCheckNode?.outputs?.timeSinceLastQuestion;
      console.log(`[curiosity-service] Cannot ask yet - only ${Math.round((timeSince || 0) / 60)}min since last question`);
      return false;
    }

    const samplerNode = graphResult.nodes.get('2');
    const questionGeneratorNode = graphResult.nodes.get('3');
    const saverNode = graphResult.nodes.get('4');

    const memoriesCount = samplerNode?.outputs?.count || 0;
    const question = questionGeneratorNode?.outputs?.question || '';
    const questionId = saverNode?.outputs?.questionId;
    const saved = saverNode?.outputs?.saved;

    if (!saved || !question) {
      console.log(`[curiosity-service] Failed to generate or save question`);
      return false;
    }

    console.log(`[curiosity-service] Asked question (ID: ${questionId}): "${question.substring(0, 60)}..."`);
    console.log(`[curiosity-service] Based on ${memoriesCount} weighted memories`);

    // Audit successful question generation
    audit({
      event: 'curiosity_question_generated',
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
      event: 'curiosity_error',
      category: 'system',
      level: 'error',
      message: `Curiosity service error for ${username}: ${(error as Error).message}`,
      actor: 'curiosity-service',
      metadata: { error: (error as Error).stack, username }
    });
    return false;
  }
}

// ============================================================================
// Main Cycle
// ============================================================================

/**
 * Run a full curiosity service cycle (multi-user)
 */
export async function runCycle(options: CuriosityServiceOptions = {}): Promise<CuriosityServiceResult> {
  console.log('[curiosity-service] Starting cycle...');

  const result: CuriosityServiceResult = {
    success: false,
    questionsAsked: 0,
    userCount: 0,
    errors: [],
  };

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
      result.success = true;
      return result;
    }

    console.log(`[curiosity-service] Processing ${loggedInUsers.length} logged-in user(s)...`);
    result.userCount = loggedInUsers.length;

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

        if (asked) result.questionsAsked++;
      } catch (error) {
        const errorMsg = `User ${user.username}: ${(error as Error).message}`;
        console.error(`[curiosity-service] Failed: ${errorMsg}`);
        result.errors.push(errorMsg);
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

    console.log(`[curiosity-service] Cycle complete. Asked ${result.questionsAsked} questions across ${loggedInUsers.length} user(s).`);

    audit({
      category: 'action',
      level: 'info',
      event: 'curiosity_service_complete',
      details: {
        questionsAsked: result.questionsAsked,
        usersProcessed: loggedInUsers.length
      },
      actor: 'curiosity-service'
    });

    result.success = result.errors.length === 0;
    return result;
  } catch (error) {
    const errorMsg = (error as Error).message;
    console.error('[curiosity-service] Error during cycle:', errorMsg);
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

  const options: CuriosityServiceOptions = {
    singleUser: args.includes('--single-user') || opts.singleUser === true,
  };

  try {
    // If running for a specific user context, process just that user
    if (ctx.username && options.singleUser) {
      const asked = await withUserContext(
        { userId: ctx.username, username: ctx.username, role: 'owner' },
        async () => generateUserQuestion(ctx.username)
      );

      return {
        success: true,
        data: { questionsAsked: asked ? 1 : 0, userCount: 1, errors: [] },
        duration: Date.now() - startTime,
        itemsProcessed: asked ? 1 : 0,
      };
    }

    // Otherwise run full cycle
    const result = await runCycle(options);

    return {
      success: result.success,
      data: result,
      error: result.errors.length > 0 ? result.errors.join('; ') : undefined,
      duration: Date.now() - startTime,
      itemsProcessed: result.questionsAsked,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      duration: Date.now() - startTime,
    };
  }
}
