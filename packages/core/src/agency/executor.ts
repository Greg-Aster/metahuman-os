/**
 * Agency Executor
 *
 * Graph-level execution functions for the canonical desire execution and
 * outcome-review services.
 */

import type { Desire, DesireExecution, DesireOutcomeReview, OutcomeVerdict } from './types.js';
import type { SvelteFlowGraph } from '../cognitive-graph-schema.js';
import { getUserContext } from '../context.js';
import type { ExecutionEventHandler, GraphExecutionState } from '../graph-executor.js';
import {
  cognitiveGraphPath,
  loadGraphFile,
  requireGraphNodeOutput,
  runGraph,
  type CachedGraphEntry,
} from '../graph-runtime.js';

// ============================================================================
// Progress Callback Types
// ============================================================================

export interface DesireExecutionProgress {
  type: 'step_start' | 'step_complete' | 'step_error' | 'execution_start' | 'execution_complete' | 'execution_error' | 'claude_working';
  stepNumber?: number;
  totalSteps?: number;
  action?: string;
  message: string;
  timestamp: number;
  data?: any;
}

export type DesireProgressCallback = (progress: DesireExecutionProgress) => void;

const LOG_PREFIX = '[agency:executor]';

// ============================================================================
// Graph Caching
// ============================================================================

const graphCache: Record<string, CachedGraphEntry | null> = {};

/**
 * Load the desire-executor cognitive graph
 */
export async function loadDesireExecutorGraph(): Promise<SvelteFlowGraph> {
  const loaded = await loadGraphFile(cognitiveGraphPath('desire-executor.json'), {
    cache: graphCache,
    cacheKey: 'desire-executor',
    logPrefix: LOG_PREFIX,
  });

  if (!loaded) {
    throw new Error('Could not load desire-executor graph');
  }

  return loaded.graph;
}

/**
 * Load the outcome-reviewer cognitive graph
 */
export async function loadOutcomeReviewerGraph(): Promise<SvelteFlowGraph> {
  const loaded = await loadGraphFile(cognitiveGraphPath('outcome-reviewer.json'), {
    cache: graphCache,
    cacheKey: 'outcome-reviewer',
    logPrefix: LOG_PREFIX,
  });

  if (!loaded) {
    throw new Error('Could not load outcome-reviewer graph');
  }

  return loaded.graph;
}

/**
 * Clear cached graphs (useful for testing or hot-reloading)
 */
export function clearGraphCache(): void {
  Object.keys(graphCache).forEach(key => delete graphCache[key]);
}

// ============================================================================
// Desire Execution via Graph
// ============================================================================

export interface ExecuteDesireResult {
  success: boolean;
  graphCompleted: boolean;
  execution?: DesireExecution;
  error?: string;
}

export function buildDesireExecutionGraphContext(
  desire: Desire,
  username: string,
  onProgress?: DesireProgressCallback,
  signal?: AbortSignal,
): Record<string, unknown> {
  const activeUser = getUserContext();
  if (!activeUser) throw new Error('Desire execution requires an authenticated user context');
  if (activeUser.username !== username && activeUser.activeProfile !== username) {
    throw new Error(`Desire execution context does not own profile ${username}`);
  }
  return {
    userId: activeUser.userId,
    username,
    allowMemoryWrites: true,
    recordPersonaMemory: true,
    cognitiveMode: 'agent' as const,
    desire,
    onDesireProgress: onProgress,
    abortSignal: signal,
  };
}

export function evaluateDesireExecutionGraph(graphResult: GraphExecutionState): ExecuteDesireResult {
  const executorOutputs = requireGraphNodeOutput(graphResult, 'desire_executor');
  const execution = executorOutputs.execution as DesireExecution | undefined;
  const success = executorOutputs.success;
  const error = executorOutputs.error as string | undefined;
  if (!execution || typeof success !== 'boolean') {
    throw new Error('Desire Executor did not produce a typed execution result');
  }

  const innerOutputs = requireGraphNodeOutput(graphResult, 'inner_dialogue_buffer');
  if (innerOutputs.saved !== true || innerOutputs.persisted !== true) {
    throw new Error(
      `Execution inner-dialogue persistence failed: ${innerOutputs.error || innerOutputs.reason || 'not saved'}`,
    );
  }
  const admittedCount = Number(innerOutputs.savedCount);
  if (!Number.isInteger(admittedCount) || admittedCount < 1) {
    throw new Error('Execution inner-dialogue buffer did not confirm an admitted summary');
  }

  const memoryOutputs = requireGraphNodeOutput(graphResult, 'inner_dialogue_saver');
  if (memoryOutputs.saved !== true || memoryOutputs.success !== true
      || memoryOutputs.savedCount !== admittedCount) {
    throw new Error(
      `Execution Persona Memory persistence failed: expected ${admittedCount} saved entry or entries, received ${Number(memoryOutputs.savedCount) || 0}`,
    );
  }

  return { success, graphCompleted: true, execution, error };
}

/**
 * Execute a single desire via the graph pipeline.
 * This handles: execution → inner dialogue → TTS output
 *
 * @param desire - The desire to execute (must have a plan)
 * @param username - The user context for execution
 * @param onProgress - Optional callback for real-time progress updates
 * @returns Execution result with success status, execution data, and any errors
 */
export async function executeDesireViaGraph(
  desire: Desire,
  username: string,
  onProgress?: DesireProgressCallback,
  signal?: AbortSignal,
): Promise<ExecuteDesireResult> {
  try {
    const graph = await loadDesireExecutorGraph();

    // Emit execution start
    onProgress?.({
      type: 'execution_start',
      totalSteps: desire.plan?.steps?.length || 0,
      message: `Starting execution of "${desire.title}"`,
      timestamp: Date.now(),
      data: { desireId: desire.id, title: desire.title },
    });

    const graphContext = buildDesireExecutionGraphContext(desire, username, onProgress, signal);

    const executorGraphNodes = graph.nodes.filter(node => node.data.nodeType === 'desire_executor');
    if (executorGraphNodes.length !== 1) {
      throw new Error(`Desire executor graph requires exactly one desire_executor node; found ${executorGraphNodes.length}`);
    }
    const [executorGraphNode] = executorGraphNodes;
    let graphError: string | undefined;

    // Create event handler that forwards graph events to progress callback
    const eventHandler: ExecutionEventHandler = (event) => {
      if (event.type === 'graph_error') {
        graphError = typeof event.data?.error === 'string' ? event.data.error : 'Graph execution failed';
      }
      if (event.type === 'node_start' && event.nodeId === executorGraphNode.id) {
        // Desire executor node starting
        onProgress?.({
          type: 'claude_working',
          message: 'Big Brother is executing the plan...',
          timestamp: event.timestamp,
        });
      }
    };

    console.log(`${LOG_PREFIX} Executing via graph pipeline for: ${desire.title}`);
    const graphResult = await runGraph({ graph, context: graphContext, eventHandler, signal });

    if (graphResult.status !== 'completed') {
      return {
        success: false,
        graphCompleted: false,
        error: graphError || 'Desire executor graph did not complete',
      };
    }

    const evaluated = evaluateDesireExecutionGraph(graphResult);

    // Emit completion event
    onProgress?.({
      type: evaluated.success ? 'execution_complete' : 'execution_error',
      totalSteps: desire.plan?.steps?.length || 0,
      message: evaluated.success
        ? `Completed "${desire.title}" (${evaluated.execution?.stepsCompleted || 0}/${desire.plan?.steps?.length || 0} steps)`
        : `Failed: ${evaluated.error || 'Unknown error'}`,
      timestamp: Date.now(),
      data: {
        success: evaluated.success,
        stepsCompleted: evaluated.execution?.stepsCompleted,
        error: evaluated.error,
      },
    });

    return evaluated;
  } catch (graphError) {
    const errorMsg = (graphError as Error).message;
    console.error(`${LOG_PREFIX} Graph execution failed:`, errorMsg);

    // Emit error event
    onProgress?.({
      type: 'execution_error',
      message: `Graph execution failed: ${errorMsg}`,
      timestamp: Date.now(),
      data: { error: errorMsg },
    });

    return {
      success: false,
      graphCompleted: false,
      error: `Graph execution failed: ${errorMsg}`,
    };
  }
}

// ============================================================================
// Outcome Review via Graph
// ============================================================================

export interface ReviewOutcomeResult {
  success: boolean;
  desire?: Desire;
  outcomeReview?: DesireOutcomeReview;
  verdict?: OutcomeVerdict;
  action?: string;
  summary?: string;
  error?: string;
}

/**
 * Review a desire's execution outcome via the graph pipeline.
 * This handles: LLM review → inner dialogue → TTS output
 *
 * @param desire - The desire to review (must have execution data)
 * @param username - The user context for the review
 * @returns Review result with verdict, outcome review data, and any errors
 */
export async function reviewOutcomeViaGraph(
  desire: Desire,
  username: string,
  signal?: AbortSignal,
): Promise<ReviewOutcomeResult> {
  try {
    const graph = await loadOutcomeReviewerGraph();

    // Execute graph with context
    // The desire_loader node checks for context.desire and uses it directly
    const graphContext = {
      userId: username,
      username, // Some nodes check context.username
      allowMemoryWrites: true,
      cognitiveMode: 'dual' as const,
      // Pass desire in context - desire_loader checks context.desire
      desire,
      abortSignal: signal,
    };

    console.log(`${LOG_PREFIX} Reviewing outcome via graph pipeline for: ${desire.title}`);
    const graphResult = await runGraph({ graph, context: graphContext, signal });
    if (graphResult.status !== 'completed') {
      throw new Error('Outcome reviewer graph did not complete');
    }

    const reviewerOutputs = requireGraphNodeOutput(graphResult, 'outcome_reviewer');
    const transitionOutputs = requireGraphNodeOutput(graphResult, 'desire_updater');
    const outcomeReview = reviewerOutputs.outcomeReview as DesireOutcomeReview | undefined;
    const verdict = reviewerOutputs.verdict as OutcomeVerdict | undefined;
    const updatedDesire = transitionOutputs.desire as Desire | undefined;
    if (reviewerOutputs.success !== true || transitionOutputs.success !== true
      || !outcomeReview || !verdict || !updatedDesire) {
      throw new Error('Outcome reviewer graph did not produce a durable Agency transition');
    }

    return {
      success: true,
      desire: updatedDesire,
      outcomeReview,
      verdict,
      action: transitionOutputs.action as string | undefined,
      summary: transitionOutputs.summary as string | undefined,
    };
  } catch (graphError) {
    console.error(`${LOG_PREFIX} Graph review failed:`, (graphError as Error).message);
    return {
      success: false,
      error: `Graph review failed: ${(graphError as Error).message}`,
    };
  }
}
