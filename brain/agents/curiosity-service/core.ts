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
import { createHash } from 'node:crypto';
import {
  ROOT,
  audit,
  getTargetUser,
  withUserContext,
  loadCuriosityConfig,
  loadTrustLevel,
  curiosityQuestionStore,
  listFailedNodes,
  runGraph,
  validateSvelteFlowGraph,
  getActiveBackend,
  type SvelteFlowGraph,
} from '@metahuman/core';
import type { AgentContext, AgentInput, AgentResult } from '@metahuman/agent-runtime';

// ============================================================================
// Types
// ============================================================================

export type CuriosityQuestionSkipReason = 'disabled' | 'trust' | 'max-open' | 'no-memories';

export type CuriosityQuestionOutcome =
  | { status: 'generated'; questionId: string; memoriesConsidered: number; openQuestionsBefore: number }
  | { status: 'skipped'; reason: CuriosityQuestionSkipReason; openQuestionsBefore?: number };

export interface CuriosityServiceResult {
  success: boolean;
  questionsAsked: number;
  questionsSkipped: number;
  userCount: number;
  outcome?: CuriosityQuestionOutcome;
  errors: string[];
}

const TRUST_LEVELS = ['observe', 'suggest', 'supervised_auto', 'bounded_auto', 'adaptive_auto'] as const;

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

export function curiosityQuestionIdForExecution(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const digest = createHash('sha256').update(value.trim()).digest('hex').slice(0, 32);
  return `cur-q-task-${digest}`;
}

export function requireCuriosityDelivery(
  questionId: string,
  conversationOutputs: Record<string, any> | undefined,
  memoryOutputs: Record<string, any> | undefined,
): any[] {
  const bufferedEntries = Array.isArray(conversationOutputs?.entries)
    ? conversationOutputs.entries
    : [];
  if (conversationOutputs?.persisted !== true
    || !bufferedEntries.some(entry => entry?.meta?.questionId === questionId)) {
    throw new Error(`Curiosity question ${questionId} was not retained by the Conversation Buffer`);
  }
  if (memoryOutputs?.saved !== true || memoryOutputs.savedCount !== bufferedEntries.length) {
    throw new Error(`Curiosity question ${questionId} was not saved to Persona Memory`);
  }
  return bufferedEntries;
}

function requiredNodeId(graph: SvelteFlowGraph, nodeType: string): string {
  const matching = graph.nodes.filter(node => node.data.nodeType === nodeType);
  if (matching.length !== 1) {
    throw new Error(`Curiosity graph must contain exactly one ${nodeType} node; found ${matching.length}`);
  }
  return matching[0].id;
}

export function evaluateQuestionAdmission(input: {
  maxOpenQuestions: number;
  openQuestions: number;
  currentTrust: string;
  requiredTrust: string;
}): CuriosityQuestionSkipReason | null {
  if (!Number.isInteger(input.maxOpenQuestions) || input.maxOpenQuestions < 0) {
    throw new Error('maxOpenQuestions must be a non-negative integer');
  }
  if (!Number.isInteger(input.openQuestions) || input.openQuestions < 0) {
    throw new Error('openQuestions must be a non-negative integer');
  }
  if (input.maxOpenQuestions === 0) return 'disabled';
  const currentTrustIdx = TRUST_LEVELS.indexOf(input.currentTrust as typeof TRUST_LEVELS[number]);
  const requiredTrustIdx = TRUST_LEVELS.indexOf(input.requiredTrust as typeof TRUST_LEVELS[number]);
  if (currentTrustIdx < 0) throw new Error(`Unknown current trust level: ${input.currentTrust}`);
  if (requiredTrustIdx < 0) throw new Error(`Unknown minimum curiosity trust level: ${input.requiredTrust}`);
  if (currentTrustIdx < requiredTrustIdx) return 'trust';
  if (input.openQuestions >= input.maxOpenQuestions) return 'max-open';
  return null;
}

// ============================================================================
// Question Generation
// ============================================================================

/**
 * Generate a curiosity question for a single user using node-based workflow
 *
 * SECURITY: All memory access is user-specific via context.userId
 */
export async function generateUserQuestion(
  username: string,
  options: { signal?: AbortSignal; idempotencyKey?: string } = {},
): Promise<CuriosityQuestionOutcome> {
  console.log(`[curiosity-service] Processing user: ${username}`);

  const config = loadCuriosityConfig(username);
  const stableQuestionId = curiosityQuestionIdForExecution(options.idempotencyKey);
  const existingQuestion = stableQuestionId
    ? await curiosityQuestionStore.get(username, stableQuestionId)
    : null;
  if (existingQuestion && existingQuestion.status !== 'pending') {
    return {
      status: 'generated',
      questionId: existingQuestion.id,
      memoriesConsidered: existingQuestion.seedMemories.length,
      openQuestionsBefore: await curiosityQuestionStore.countPending(username),
    };
  }
  if (config.maxOpenQuestions === 0) {
    console.log(`[curiosity-service] Skipping ${username}: disabled`);
    return { status: 'skipped', reason: 'disabled' };
  }
  const trust = loadTrustLevel({ strict: true });
  const openQuestions = await curiosityQuestionStore.countPending(username);
  const skipReason = evaluateQuestionAdmission({
    maxOpenQuestions: config.maxOpenQuestions,
    openQuestions: existingQuestion?.status === 'pending'
      ? Math.max(0, openQuestions - 1)
      : openQuestions,
    currentTrust: trust,
    requiredTrust: config.minTrustLevel,
  });
  if (skipReason) {
    console.log(`[curiosity-service] Skipping ${username}: ${skipReason}`);
    return { status: 'skipped', reason: skipReason, openQuestionsBefore: openQuestions };
  }

  // Log which backend is active (model router handles actual availability)
  try {
    const backend = getActiveBackend();
    console.log(`[curiosity-service] Using LLM backend: ${backend}`);
  } catch {
    console.log('[curiosity-service] Using model router (backend auto-selected)');
  }

  const graph = await loadCuriosityGraph();
  const samplerNodeId = requiredNodeId(graph, 'curiosity_weighted_sampler');
  const saverNodeId = requiredNodeId(graph, 'curiosity_question_saver');
  const conversationBufferNodeId = requiredNodeId(graph, 'conversation_buffer');
  const memoryCaptureNodeId = requiredNodeId(graph, 'memory_capture');
  const graphContext = {
    userId: username,
    username,
    allowMemoryWrites: true,
    cognitiveMode: 'agent' as const,
    ...(stableQuestionId ? {
      curiosityQuestionId: stableQuestionId,
      idempotencyKey: `curiosity:${stableQuestionId}`,
    } : {}),
  };

  console.log(`[curiosity-service] Executing curiosity workflow for user: ${username}`);
  const graphResult = await runGraph({ graph, context: graphContext, signal: options.signal });
  if (graphResult.status === 'failed') {
    const failures = listFailedNodes(graphResult);
    const details = failures.map(failure => `${failure.nodeId}: ${failure.error}`).join('; ');
    throw new Error(`Curiosity graph failed${details ? ` (${details})` : ''}`);
  }

  const samplerNode = graphResult.nodes.get(samplerNodeId);
  const saverNode = graphResult.nodes.get(saverNodeId);
  const conversationBufferNode = graphResult.nodes.get(conversationBufferNodeId);
  const memoryCaptureNode = graphResult.nodes.get(memoryCaptureNodeId);
  const memoriesCount = Number(samplerNode?.outputs?.count ?? 0);
  if (!Number.isInteger(memoriesCount) || memoriesCount < 0) {
    throw new Error('Curiosity graph returned an invalid sampled-memory count');
  }
  const question = saverNode?.outputs?.question;
  const questionId = saverNode?.outputs?.questionId;
  const saved = saverNode?.outputs?.saved;
  if (memoriesCount === 0 && saved !== true) {
    return { status: 'skipped', reason: 'no-memories', openQuestionsBefore: openQuestions };
  }
  if (saved !== true || typeof question !== 'string' || !question.trim()
    || typeof questionId !== 'string' || !questionId.trim()) {
    throw new Error('Curiosity graph completed without a persisted question');
  }
  requireCuriosityDelivery(questionId, conversationBufferNode?.outputs, memoryCaptureNode?.outputs);

  const memoriesConsidered = Math.max(
    memoriesCount,
    existingQuestion?.seedMemories.length ?? 0,
  );

  console.log(`[curiosity-service] Asked question ${questionId} from ${memoriesConsidered} weighted memories`);
  audit({
    event: 'curiosity_question_generated',
    category: 'decision',
    level: 'info',
    message: 'Curiosity service generated question',
    actor: 'curiosity-service',
    metadata: {
      questionId,
      memoriesConsidered,
      trust,
      autonomy: 'normal',
      username,
      usedGraph: true,
    },
  });

  return {
    status: 'generated',
    questionId,
    memoriesConsidered,
    openQuestionsBefore: openQuestions,
  };
}

// ============================================================================
// Main Cycle
// ============================================================================

/**
 * Run a full curiosity service cycle (multi-user)
 */
export async function runCycle(): Promise<CuriosityServiceResult> {
  console.log('[curiosity-service] Starting cycle...');

  const result: CuriosityServiceResult = {
    success: false,
    questionsAsked: 0,
    questionsSkipped: 0,
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
    // SECURITY: Get target user - prioritizes explicit username, then API trigger, then most recently active
    const activeUser = getTargetUser();

    if (!activeUser) {
      console.log('[curiosity-service] No active users found, exiting.');
      result.success = true;
      return result;
    }

    console.log(`[curiosity-service] Processing user: ${activeUser.username}`);
    result.userCount = 1;

    try {
      // SECURITY: withUserContext ensures user-specific path resolution
      const outcome = await withUserContext(
        { userId: activeUser.userId, username: activeUser.username, role: activeUser.role },
        async () => {
          return await generateUserQuestion(activeUser.username, {
            idempotencyKey: process.env.MH_TASK_ID,
          });
        }
      );

      result.outcome = outcome;
      if (outcome.status === 'generated') result.questionsAsked++;
      else result.questionsSkipped++;
    } catch (error) {
      const errorMsg = `User ${activeUser.username}: ${(error as Error).message}`;
      console.error(`[curiosity-service] Failed: ${errorMsg}`);
      result.errors.push(errorMsg);
      audit({
        category: 'system',
        level: 'error',
        event: 'curiosity_service_user_error',
        details: {
          error: (error as Error).message,
          username: activeUser.username
        },
        actor: 'curiosity-service'
      });
    }

    console.log(`[curiosity-service] Cycle complete. Asked ${result.questionsAsked} questions for user ${activeUser.username}.`);

    audit({
      category: 'action',
      level: 'info',
      event: 'curiosity_service_complete',
      details: {
        questionsAsked: result.questionsAsked,
        questionsSkipped: result.questionsSkipped,
        outcome: result.outcome?.status,
        username: activeUser.username
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

  try {
    if ((input.args?.length ?? 0) > 0 || Object.keys(input.options || {}).length > 0) {
      throw new Error('Curiosity Service does not accept agent arguments or options');
    }
    const targetUser = getTargetUser({ username: ctx.username });
    if (!targetUser) {
      throw new Error(`No authenticated user found for Curiosity Service profile ${ctx.username}`);
    }
    const outcome = await withUserContext(
      targetUser,
      async () => generateUserQuestion(targetUser.username, {
        signal: ctx.signal,
        idempotencyKey: process.env.MH_TASK_ID,
      })
    );
    const generated = outcome.status === 'generated';

    return {
      success: true,
      data: {
        questionsAsked: generated ? 1 : 0,
        questionsSkipped: generated ? 0 : 1,
        userCount: 1,
        outcome,
        errors: [],
      },
      duration: Date.now() - startTime,
      itemsProcessed: generated ? 1 : 0,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      duration: Date.now() - startTime,
    };
  }
}
