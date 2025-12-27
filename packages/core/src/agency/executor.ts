/**
 * Agency Executor
 *
 * Graph-based execution functions for desires and outcome reviews.
 * Single source of truth - used by both API endpoints and agents.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Desire, DesireExecution, DesireOutcomeReview, OutcomeVerdict } from './types.js';
import type { SvelteFlowGraph } from '../cognitive-graph-schema.js';
import { executeGraph, type ExecutionEventHandler } from '../graph-executor.js';
import { validateSvelteFlowGraph } from '../cognitive-graph-schema.js';
import { systemPaths } from '../paths.js';

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

let cachedExecutorGraph: SvelteFlowGraph | null = null;
let cachedReviewerGraph: SvelteFlowGraph | null = null;

/**
 * Load the desire-executor cognitive graph
 */
export async function loadDesireExecutorGraph(): Promise<SvelteFlowGraph> {
  if (cachedExecutorGraph) {
    return cachedExecutorGraph;
  }

  const graphPath = path.join(systemPaths.etc, 'cognitive-graphs', 'desire-executor.json');
  try {
    const raw = await fs.readFile(graphPath, 'utf-8');
    const parsed = JSON.parse(raw);
    cachedExecutorGraph = validateSvelteFlowGraph(parsed);
    console.log(`${LOG_PREFIX} Loaded desire-executor graph`);
    return cachedExecutorGraph;
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not load executor graph:`, (error as Error).message);
    throw error;
  }
}

/**
 * Load the outcome-reviewer cognitive graph
 */
export async function loadOutcomeReviewerGraph(): Promise<SvelteFlowGraph> {
  if (cachedReviewerGraph) {
    return cachedReviewerGraph;
  }

  const graphPath = path.join(systemPaths.etc, 'cognitive-graphs', 'outcome-reviewer.json');
  try {
    const raw = await fs.readFile(graphPath, 'utf-8');
    const parsed = JSON.parse(raw);
    cachedReviewerGraph = validateSvelteFlowGraph(parsed);
    console.log(`${LOG_PREFIX} Loaded outcome-reviewer graph`);
    return cachedReviewerGraph;
  } catch (error) {
    console.warn(`${LOG_PREFIX} Could not load reviewer graph:`, (error as Error).message);
    throw error;
  }
}

/**
 * Clear cached graphs (useful for testing or hot-reloading)
 */
export function clearGraphCache(): void {
  cachedExecutorGraph = null;
  cachedReviewerGraph = null;
}

// ============================================================================
// Desire Execution via Graph
// ============================================================================

export interface ExecuteDesireResult {
  success: boolean;
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
  onProgress?: DesireProgressCallback
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
    };

    // Create event handler that forwards graph events to progress callback
    const eventHandler: ExecutionEventHandler = (event) => {
      if (event.type === 'node_start' && event.nodeId === '3') {
        // Desire executor node starting
        onProgress?.({
          type: 'claude_working',
          message: 'Big Brother is executing the plan...',
          timestamp: event.timestamp,
        });
      }
    };

    console.log(`${LOG_PREFIX} Executing via graph pipeline for: ${desire.title}`);
    const graphResult = await executeGraph(graph, graphContext, eventHandler);

    // Extract results from the desire_executor node (node 3 in our graph)
    const executorNode = graphResult.nodes.get('3');
    if (!executorNode?.outputs) {
      return {
        success: false,
        error: 'Graph execution failed - no executor output',
      };
    }

    const execution = executorNode.outputs.execution as DesireExecution | undefined;
    const success = executorNode.outputs.success as boolean;
    const error = executorNode.outputs.error as string | undefined;

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
      error: `Graph execution failed: ${errorMsg}`,
    };
  }
}

// ============================================================================
// Outcome Review via Graph
// ============================================================================

export interface ReviewOutcomeResult {
  success: boolean;
  outcomeReview?: DesireOutcomeReview;
  verdict?: OutcomeVerdict;
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
  username: string
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
    };

    console.log(`${LOG_PREFIX} Reviewing outcome via graph pipeline for: ${desire.title}`);
    const graphResult = await executeGraph(graph, graphContext);

    // Extract results from the outcome_reviewer node (node 2 in outcome-reviewer.json)
    const reviewerNode = graphResult.nodes.get('2');
    if (!reviewerNode?.outputs) {
      return {
        success: false,
        error: 'Graph execution failed - no reviewer output',
      };
    }

    const outcomeReview = reviewerNode.outputs.outcomeReview as DesireOutcomeReview | undefined;
    const verdict = reviewerNode.outputs.verdict as OutcomeVerdict | undefined;
    const success = reviewerNode.outputs.success as boolean;
    const error = reviewerNode.outputs.error as string | undefined;

    return {
      success,
      outcomeReview,
      verdict,
      error,
    };
  } catch (graphError) {
    console.error(`${LOG_PREFIX} Graph review failed:`, (graphError as Error).message);
    return {
      success: false,
      error: `Graph review failed: ${(graphError as Error).message}`,
    };
  }
}
