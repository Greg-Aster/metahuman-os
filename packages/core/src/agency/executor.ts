/**
 * Agency Executor
 *
 * Graph-level execution functions for the canonical desire execution and
 * outcome-review services.
 */

import type { Desire, DesireExecution, DesireOutcomeReview, OutcomeVerdict } from './types.js';
import type { SvelteFlowGraph } from '../cognitive-graph-schema.js';
import type { ExecutionEventHandler } from '../graph-executor.js';
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

    // Execute graph with context
    // The desire_loader node checks for context.desire and uses it directly
    // This allows the graph to work with the desire we pass in
    const graphContext = {
      userId: username,
      username, // Some nodes check context.username
      allowMemoryWrites: true,
      cognitiveMode: 'dual' as const,
      // Pass desire in context - desire_loader checks context.desire
      desire,
      // Pass progress callback for nodes to emit progress
      onDesireProgress: onProgress,
      abortSignal: signal,
    };

    const executorGraphNode = graph.nodes.find(node => node.data.nodeType === 'desire_executor');
    if (!executorGraphNode) {
      throw new Error('Desire executor graph has no desire_executor node');
    }
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

    // Extract results from the graph's declared desire_executor owner.
    const executorNode = graphResult.nodes.get(executorGraphNode.id);
    if (!executorNode?.outputs) {
      return {
        success: false,
        graphCompleted: false,
        error: 'Graph execution failed - no executor output',
      };
    }

    const execution = executorNode.outputs.execution as DesireExecution | undefined;
    const success = executorNode.outputs.success as boolean;
    const error = executorNode.outputs.error as string | undefined;

    const auditGraphNode = graph.nodes.find(node => node.data.nodeType === 'audit_logger');
    const auditOutputs = auditGraphNode ? graphResult.nodes.get(auditGraphNode.id)?.outputs : undefined;
    if (auditGraphNode && auditOutputs?.success !== true) {
      return {
        success: false,
        graphCompleted: false,
        execution,
        error: typeof auditOutputs?.error === 'string'
          ? `Execution audit failed: ${auditOutputs.error}`
          : 'Execution audit was not durably recorded',
      };
    }

    const innerGraphNode = graph.nodes.find(node => node.data.nodeType === 'inner_dialogue_buffer');
    const innerOutputs = innerGraphNode ? graphResult.nodes.get(innerGraphNode.id)?.outputs : undefined;
    if (innerGraphNode && innerOutputs?.saved !== true) {
      return {
        success: false,
        graphCompleted: false,
        execution,
        error: typeof innerOutputs?.error === 'string'
          ? `Execution inner-dialogue persistence failed: ${innerOutputs.error}`
          : `Execution inner-dialogue persistence failed: ${innerOutputs?.reason || 'not saved'}`,
      };
    }

    // Emit completion event
    onProgress?.({
      type: success ? 'execution_complete' : 'execution_error',
      totalSteps: desire.plan?.steps?.length || 0,
      message: success
        ? `Completed "${desire.title}" (${execution?.stepsCompleted || 0}/${desire.plan?.steps?.length || 0} steps)`
        : `Failed: ${error || 'Unknown error'}`,
      timestamp: Date.now(),
      data: { success, stepsCompleted: execution?.stepsCompleted, error },
    });

    return {
      success,
      graphCompleted: true,
      execution,
      error,
    };
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
