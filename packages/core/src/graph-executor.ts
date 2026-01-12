/**
 * Graph Execution Engine for Cognitive Node System
 *
 * This module provides the runtime execution logic for cognitive graphs,
 * using native Svelte Flow format (string IDs, edges with handles).
 */

import type { SvelteFlowGraph, SvelteFlowNode, SvelteFlowEdge } from './cognitive-graph-schema.js';
import { createLogger } from './logger.js';
import { loadOperatorConfig } from './config.js';

const log = createLogger('graph-pipeline');

// Default timeouts (in ms)
const DEFAULT_NODE_TIMEOUT = 600000;  // 10 minutes
const DEFAULT_LLM_TIMEOUT = 900000;   // 15 minutes

// Node types that are considered LLM nodes (need longer timeouts)
const LLM_NODE_TYPES = new Set([
  'curator_llm', 'response_llm', 'planner_llm', 'decision_llm',
  'unified_decision_llm', 'big_brother_reviewer', 'big_brother_decision', 'llm',
  'claude_full_task', 'orchestrator_llm', 'persona_llm', 'response_synthesizer'
]);

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface NodeExecutionState {
  nodeId: string;
  status: ExecutionStatus;
  startTime?: number;
  endTime?: number;
  inputs?: Record<string, any>;
  outputs?: Record<string, any>;
  error?: Error;
}

export interface GraphExecutionState {
  nodes: Map<string, NodeExecutionState>;
  startTime: number;
  endTime?: number;
  currentNodeId?: string;
  status: ExecutionStatus;
}

export interface ExecutionEvent {
  type: 'node_start' | 'node_complete' | 'node_error' | 'node_reasoning' | 'graph_complete' | 'graph_error';
  nodeId?: string;
  data?: any;
  timestamp: number;
}

export type ExecutionEventHandler = (event: ExecutionEvent) => void;

// Back-edge handle names that indicate loop paths
// These are explicit handle names that always indicate a back-edge
const BACK_EDGE_HANDLES = new Set([
  'loop_back', 'loop', 'back', 'retry', 'refine', 'feedbackContext', 'false'
]);

/**
 * Generate unique edge key that includes source handle
 * This allows distinguishing between edges with same source/target but different handles
 */
function getEdgeKey(edge: SvelteFlowEdge): string {
  return `${edge.source}:${edge.sourceHandle || 'default'}->${edge.target}`;
}

/**
 * Check if an edge is a back-edge (creates intentional loop)
 */
function isBackEdge(edge: SvelteFlowEdge, routerNodeIds: Set<string>): boolean {
  // Only router nodes can have back-edges
  if (!routerNodeIds.has(edge.source)) return false;

  // Check by handle name (explicit back-edge handles)
  if (BACK_EDGE_HANDLES.has(edge.sourceHandle)) return true;

  // Check by explicit back-edge marker in comment
  // Only 'BACK-EDGE' or 'back_edge' are explicit markers
  // Do NOT match generic words like 'loop' or 'back' which may appear in descriptions
  if (edge.data?.comment?.includes('BACK-EDGE') ||
      edge.data?.comment?.includes('back_edge') ||
      edge.data?.comment?.includes('back-edge')) {
    return true;
  }

  return false;
}

/**
 * Identify back-edges (edges that would create cycles)
 * These are allowed from conditional_router and feedback_router nodes
 */
function identifyBackEdges(graph: SvelteFlowGraph): Set<string> {
  const backEdges = new Set<string>();

  // Find all router nodes that can create back-edges
  const routerNodeIds = new Set<string>();
  graph.nodes.forEach(node => {
    const nodeType = node.data.nodeType;
    if (nodeType === 'conditional_router' || nodeType === 'cognitive/conditional_router' ||
        nodeType === 'control_flow/conditional_router' ||
        nodeType === 'feedback_router' || nodeType === 'cognitive/feedback_router' ||
        nodeType === 'control_flow/feedback_router') {
      routerNodeIds.add(node.id);
      console.log(`[BackEdge] Found router node: ${node.id} (${nodeType})`);
    }
  });

  // Identify back-edges (using unique edge keys that include handle)
  graph.edges.forEach(edge => {
    if (routerNodeIds.has(edge.source)) {
      console.log(`[BackEdge] Checking edge from router ${edge.source}: ${getEdgeKey(edge)} (handle: ${edge.sourceHandle})`);
    }
    if (isBackEdge(edge, routerNodeIds)) {
      const edgeKey = getEdgeKey(edge);
      backEdges.add(edgeKey);
      console.log(`[BackEdge] IDENTIFIED: ${edgeKey} via handle "${edge.sourceHandle}"`);
    }
  });

  return backEdges;
}

/**
 * Topological sort for determining execution order
 * Supports conditional loops via conditional_router nodes
 */
function topologicalSort(graph: SvelteFlowGraph): string[] {
  const nodeIds = graph.nodes.map(n => n.id);
  const adjacencyList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // Identify back-edges (loop edges from conditional_router)
  const backEdges = identifyBackEdges(graph);

  // Initialize
  nodeIds.forEach(id => {
    adjacencyList.set(id, []);
    inDegree.set(id, 0);
  });

  // Build adjacency list and in-degree map (excluding back-edges)
  graph.edges.forEach(edge => {
    const edgeKey = getEdgeKey(edge);
    if (!backEdges.has(edgeKey)) {
      adjacencyList.get(edge.source)?.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    }
  });

  // Find nodes with no incoming edges
  const queue: string[] = [];
  inDegree.forEach((degree, nodeId) => {
    if (degree === 0) {
      queue.push(nodeId);
    }
  });

  const sorted: string[] = [];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    sorted.push(nodeId);

    adjacencyList.get(nodeId)?.forEach(neighbor => {
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    });
  }

  // Check for cycles (excluding allowed back-edges)
  if (sorted.length !== nodeIds.length) {
    const missing = nodeIds.filter(id => !sorted.includes(id));
    throw new Error(`Graph contains invalid cycles. Missing nodes: ${missing.join(', ')}`);
  }

  return sorted;
}

/**
 * Get input data for a node based on its connections
 */
function getNodeInputs(
  nodeId: string,
  graph: SvelteFlowGraph,
  executionState: Map<string, NodeExecutionState>
): Record<string, any> {
  const inputs: Record<string, any> = {};

  // Find all edges that target this node
  const incomingEdges = graph.edges.filter(edge => edge.target === nodeId);

  incomingEdges.forEach(edge => {
    const sourceNode = executionState.get(edge.source);

    if (sourceNode?.outputs) {
      const sourceNodeDef = graph.nodes.find(n => n.id === edge.source);
      const targetNodeDef = graph.nodes.find(n => n.id === nodeId);

      if (sourceNodeDef && targetNodeDef) {
        let value;

        // Special handling for conditional_router: extract routedData for all outputs
        if (sourceNode.outputs.routedData !== undefined) {
          value = sourceNode.outputs.routedData;
        }
        // Try to get output by handle name
        else if (sourceNode.outputs[edge.sourceHandle] !== undefined) {
          value = sourceNode.outputs[edge.sourceHandle];
        }
        // Fallback: use entire output object
        else {
          value = sourceNode.outputs;
        }

        // Map to target input by handle name
        inputs[edge.targetHandle] = value;
      }
    }
  });

  return inputs;
}

/**
 * Execute a single node
 */
async function executeNode(
  nodeId: string,
  graph: SvelteFlowGraph,
  executionState: Map<string, NodeExecutionState>,
  contextData: Record<string, any>,
  eventHandler?: ExecutionEventHandler
): Promise<void> {
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) {
    throw new Error(`Node ${nodeId} not found in graph`);
  }

  const nodeType = node.data.nodeType;

  // Skip muted nodes - pass through inputs directly
  if (node.data.muted) {
    log.debug(`   Node ${nodeId} (${nodeType}) MUTED - skipping execution`);

    const inputs = getNodeInputs(nodeId, graph, executionState);

    const state: NodeExecutionState = {
      nodeId,
      status: 'completed',
      startTime: Date.now(),
      endTime: Date.now(),
      inputs,
      outputs: inputs, // Pass through inputs unchanged
    };

    executionState.set(nodeId, state);

    if (eventHandler) {
      eventHandler({
        type: 'node_complete',
        nodeId,
        data: { outputs: inputs, muted: true },
        timestamp: Date.now(),
      });
    }

    return;
  }

  const state: NodeExecutionState = {
    nodeId,
    status: 'running',
    startTime: Date.now(),
  };

  executionState.set(nodeId, state);

  if (eventHandler) {
    eventHandler({
      type: 'node_start',
      nodeId,
      data: { nodeType },
      timestamp: Date.now(),
    });
  }

  try {
    // Get inputs from connected nodes
    const inputs = getNodeInputs(nodeId, graph, executionState);

    // Execute the node based on its type
    const outputs = await executeNodeByType(node, inputs, contextData);

    const outputSummary = typeof outputs === 'object' ? `{${Object.keys(outputs).join(',')}}` : outputs;
    const duration = Date.now() - state.startTime!;
    log.debug(`   Node ${nodeId} (${nodeType}) DONE (${duration}ms)`);
    log.debug(`     Outputs: ${outputSummary}`);

    state.inputs = inputs;
    state.outputs = outputs;
    state.status = 'completed';
    state.endTime = Date.now();

    if (eventHandler) {
      eventHandler({
        type: 'node_complete',
        nodeId,
        data: { outputs },
        timestamp: Date.now(),
      });

      // Emit reasoning event if node produced thinking output
      // This captures reasoning from all LLM nodes that use callLLM() or have thinking output
      const thinking = outputs?.thinking || outputs?.response?.thinking;
      if (thinking && typeof thinking === 'string' && thinking.length > 0) {
        eventHandler({
          type: 'node_reasoning',
          nodeId,
          data: {
            nodeType,
            thinking,
            thinkingLength: thinking.length,
          },
          timestamp: Date.now(),
        });
      }
    }
  } catch (error) {
    console.error(`[GraphExecutor] Node ${nodeId} (${nodeType}) FAILED:`, error);
    state.status = 'failed';
    state.error = error as Error;
    state.endTime = Date.now();

    if (eventHandler) {
      eventHandler({
        type: 'node_error',
        nodeId,
        data: { error: (error as Error).message },
        timestamp: Date.now(),
      });
    }

    throw error;
  }
}

/**
 * Execute a node based on its type
 * This integrates with the actual cognitive system
 */
async function executeNodeByType(
  node: SvelteFlowNode,
  inputs: Record<string, any>,
  context: Record<string, any>
): Promise<Record<string, any>> {
  // Get node type without prefix
  let nodeType = node.data.nodeType;
  if (nodeType.includes('/')) {
    nodeType = nodeType.split('/').pop()!;
  }

  // Check if environment is explicitly set to 'server' in context
  const forceServerExecution = context.environment === 'server';

  // Check if we're in a browser environment (and not forcing server execution)
  const isBrowser = typeof window !== 'undefined' && !forceServerExecution;

  if (isBrowser) {
    // In browser: Use mock executors (visual testing only)
    log.debug(`     Browser mode: Using mock executor for ${nodeType}`);
    return {
      mockOutput: `Mock output from ${nodeType}`,
      nodeType,
      executed: true,
      timestamp: new Date().toISOString(),
    };
  }

  // In Node.js (or forced server mode): Import the real node executors
  log.debug(`     Server mode: Using real executor for ${nodeType}`);
  const { getNodeExecutor } = await import('./nodes/index.js');

  // Get the executor for this node type
  const executor = getNodeExecutor(nodeType);

  if (executor) {
    try {
      // Determine timeout based on node type and config
      // Priority: node property > operator config > defaults
      let timeoutMs = node.data.properties?.timeout;

      if (!timeoutMs) {
        // Try to load operator config for custom timeouts
        const username = context.userId || context.username;
        let graphConfig: { defaultNodeTimeout?: number; llmNodeTimeout?: number } | undefined;

        if (username && username !== 'anonymous') {
          try {
            const opConfig = loadOperatorConfig(username);
            graphConfig = (opConfig as any).graphExecutor;
          } catch {
            // Config not available, use defaults
          }
        }

        // Use LLM timeout for LLM nodes, otherwise default timeout
        if (LLM_NODE_TYPES.has(nodeType)) {
          timeoutMs = graphConfig?.llmNodeTimeout || DEFAULT_LLM_TIMEOUT;
        } else {
          timeoutMs = graphConfig?.defaultNodeTimeout || DEFAULT_NODE_TIMEOUT;
        }
      }

      const startTime = Date.now();

      // Big Brother nodes and desire executor have no timeout - cloud LLM/research takes as long as needed
      const neverTimeout = nodeType === 'claude_full_task' || nodeType === 'big_brother_executor' || nodeType === 'desire_executor';

      if (neverTimeout) {
        if (process.env.DEBUG_GRAPH) console.log(`[EXEC_START] Node ${node.id} (${nodeType}) starting, no timeout (Big Brother)`);
        const result = await executor(inputs, context, node.data.properties);
        const duration = Date.now() - startTime;
        if (process.env.DEBUG_GRAPH) console.log(`[EXEC_END] Node ${node.id} (${nodeType}) completed in ${duration}ms`);
        return result as Record<string, any>;
      }

      if (process.env.DEBUG_GRAPH) console.log(`[EXEC_START] Node ${node.id} (${nodeType}) starting, timeout: ${timeoutMs}ms`);

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`TIMEOUT: Node ${node.id} (${nodeType}) exceeded ${timeoutMs / 1000} second execution limit`));
        }, timeoutMs);
      });

      const executionPromise = executor(inputs, context, node.data.properties);

      const result = await Promise.race([executionPromise, timeoutPromise]);

      const duration = Date.now() - startTime;
      if (process.env.DEBUG_GRAPH) console.log(`[EXEC_END] Node ${node.id} (${nodeType}) completed in ${duration}ms`);

      return result as Record<string, any>;
    } catch (error) {
      console.error(`[Node:${nodeType}] EXECUTION FAILED:`, error);
      throw error;
    }
  }

  // Fallback: pass through inputs if no executor found
  console.warn(`[Node:${nodeType}] No executor found, passing through inputs`);
  return inputs;
}

/**
 * Get nodes reachable from a router's loop-back edge
 */
function getLoopNodes(routerId: string, graph: SvelteFlowGraph, backEdges: Set<string>): string[] {
  const loopTargets: string[] = [];

  // Find all back-edges from this router
  graph.edges.forEach(edge => {
    if (edge.source === routerId) {
      const edgeKey = getEdgeKey(edge);
      if (backEdges.has(edgeKey)) {
        loopTargets.push(edge.target);
      }
    }
  });

  if (loopTargets.length === 0) return [];

  // Find all nodes between loop target and router (the loop body)
  const loopBody = new Set<string>();
  const visited = new Set<string>();
  const queue = [...loopTargets];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId) || nodeId === routerId) continue;

    visited.add(nodeId);
    loopBody.add(nodeId);

    // Find downstream nodes
    graph.edges.forEach(edge => {
      if (edge.source === nodeId && edge.target !== routerId) {
        const edgeKey = getEdgeKey(edge);
        if (!backEdges.has(edgeKey)) {
          queue.push(edge.target);
        }
      }
    });
  }

  return Array.from(loopBody);
}

/**
 * Get nodes downstream of a router via NON-back-edges (the output path)
 * These nodes receive data when the loop exits
 */
function getOutputPathNodes(routerId: string, graph: SvelteFlowGraph, backEdges: Set<string>): string[] {
  const outputTargets: string[] = [];

  // Find all non-back-edges from this router (these are output paths)
  graph.edges.forEach(edge => {
    if (edge.source === routerId) {
      const edgeKey = getEdgeKey(edge);
      if (!backEdges.has(edgeKey)) {
        outputTargets.push(edge.target);
      }
    }
  });

  if (outputTargets.length === 0) return [];

  // Find all downstream nodes from output targets
  const outputPath = new Set<string>();
  const visited = new Set<string>();
  const queue = [...outputTargets];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId) || nodeId === routerId) continue;

    visited.add(nodeId);
    outputPath.add(nodeId);

    // Find downstream nodes
    graph.edges.forEach(edge => {
      if (edge.source === nodeId) {
        const edgeKey = getEdgeKey(edge);
        if (!backEdges.has(edgeKey)) {
          queue.push(edge.target);
        }
      }
    });
  }

  return Array.from(outputPath);
}

/**
 * Execute an entire graph
 * Accepts Svelte Flow format directly
 */
export async function executeGraph(
  graph: SvelteFlowGraph,
  contextData: Record<string, any>,
  eventHandler?: ExecutionEventHandler
): Promise<GraphExecutionState> {
  const executionState = new Map<string, NodeExecutionState>();
  const graphState: GraphExecutionState = {
    nodes: executionState,
    startTime: Date.now(),
    status: 'running',
  };

  log.info(`Starting execution: ${graph.name} v${graph.version}`);
  log.debug(`   Nodes: ${graph.nodes.length}, Edges: ${graph.edges.length}`);
  log.debug(`   Cognitive Mode: ${graph.cognitiveMode || 'default'}`);
  log.debug(`   Context: userId=${contextData.userId}, sessionId=${contextData.sessionId}`);

  try {
    // Identify back-edges for conditional loops
    const backEdges = identifyBackEdges(graph);
    if (backEdges.size > 0) {
      log.debug(`   Detected ${backEdges.size} conditional loop edge(s)`);
      console.log(`[GraphExecutor] Back-edges identified: ${Array.from(backEdges).join(', ')}`);
    } else {
      console.log(`[GraphExecutor] No back-edges found in graph`);
    }

    // Get initial execution order (excluding back-edges)
    const executionOrder = topologicalSort(graph);
    log.debug(`   Execution Order: ${executionOrder.length} nodes`);
    console.log(`[GraphExecutor] Topological order: ${executionOrder.join(' → ')}`);

    // Dynamic execution queue (supports re-execution for loops)
    const executionQueue: string[] = [...executionOrder];
    const executedCount = new Map<string, number>(); // Track iteration count per node
    const maxIterations = 5; // Safety limit - 3 refinement loops should be enough

    console.log(`[GraphExecutor] ========== EXECUTION QUEUE ==========`);
    console.log(`[GraphExecutor] Initial queue:`, executionQueue.join(', '));
    console.log(`[GraphExecutor] Total nodes to execute: ${executionQueue.length}`);

    while (executionQueue.length > 0) {
      const nodeId = executionQueue.shift()!;
      const node = graph.nodes.find(n => n.id === nodeId);
      const nodeType = node?.data.nodeType || 'unknown';

      console.log(`[GraphExecutor] >>> Executing node ${nodeId} (${nodeType})`);

      // Track iteration count (prevent infinite loops)
      const iterCount = (executedCount.get(nodeId) || 0) + 1;
      executedCount.set(nodeId, iterCount);

      if (iterCount > maxIterations) {
        throw new Error(`Node ${nodeId} exceeded maximum iterations (${maxIterations}). Possible infinite loop.`);
      }

      graphState.currentNodeId = nodeId;

      // Inject iteration count into context for feedback_router and other loop-aware nodes
      // Also add emitEvent for nodes to emit arbitrary events (e.g., Claude CLI streaming)
      const nodeContext = {
        ...contextData,
        _graphExecutorIteration: iterCount,
        emitEvent: eventHandler
          ? (type: string, data: any) => eventHandler({ type, data, nodeId, timestamp: Date.now() })
          : undefined,
      };

      // Execute the node
      await executeNode(nodeId, graph, executionState, nodeContext, eventHandler);
      console.log(`[GraphExecutor] <<< Completed node ${nodeId} (${nodeType})`);

      // Check if this node is a conditional_router or feedback_router
      if (node) {
        const type = node.data.nodeType;
        if (type === 'conditional_router' || type === 'cognitive/conditional_router' ||
            type === 'feedback_router' || type === 'cognitive/feedback_router' ||
            type === 'control_flow/feedback_router') {
          const nodeState = executionState.get(nodeId);
          const outputs = nodeState?.outputs;

          console.log(`[GraphExecutor] ========== ROUTER DECISION HANDLING ==========`);
          console.log(`[GraphExecutor] Router node ${nodeId} executed (iteration ${iterCount})`);
          console.log(`[GraphExecutor] Outputs: branch=${outputs?.branch}, routedTo=${outputs?.routedTo}, shouldContinueLoop=${outputs?.shouldContinueLoop}`);

          // Determine if we should loop back
          // - conditional_router uses: branch === 'false' to loop
          // - feedback_router uses: routedTo === 'orchestrator' or shouldContinueLoop === true
          const shouldLoop = outputs && (
            outputs.branch === 'false' ||
            outputs.routedTo === 'orchestrator' ||
            outputs.shouldContinueLoop === true
          );

          if (shouldLoop) {
            // Router decided to loop back
            log.debug(`   Loop triggered by router ${nodeId} (iteration ${iterCount})`);
            console.log(`[GraphExecutor] LOOPING BACK - Refinement needed`);

            // Get the loop body nodes and re-add them to execution queue
            const loopNodes = getLoopNodes(nodeId, graph, backEdges);

            // Sort loop nodes by their original topological order to maintain dependencies
            // Without this, nodes can execute in wrong order (e.g., response_synthesizer before context_builder)
            const loopNodeSet = new Set(loopNodes);
            const sortedLoopNodes = executionOrder.filter((id: string) => loopNodeSet.has(id));

            console.log(`[GraphExecutor] Loop body nodes to re-execute: ${sortedLoopNodes.join(', ')}`);

            if (sortedLoopNodes.length > 0) {
              // Clear execution state for loop body nodes ONLY
              sortedLoopNodes.forEach((id: string) => executionState.delete(id));

              // Add loop nodes back to queue in topological order, then re-queue router at the end
              executionQueue.unshift(...sortedLoopNodes);
              executionQueue.push(nodeId);  // Router runs after loop body
              log.debug(`   Re-queued ${sortedLoopNodes.length} nodes + router for iteration`);
            }
          } else {
            log.debug(`   Router ${nodeId} exited loop (branch: ${outputs?.branch}, routedTo: ${outputs?.routedTo})`);
            console.log(`[GraphExecutor] EXITING LOOP - Proceeding to output`);

            // Re-queue output path nodes so they execute with updated router outputs
            // This is needed because they may have already executed with old values during loop iterations
            const outputPathNodes = getOutputPathNodes(nodeId, graph, backEdges);
            if (outputPathNodes.length > 0) {
              console.log(`[GraphExecutor] Re-queuing output path nodes: ${outputPathNodes.join(', ')}`);
              // Clear execution state for output nodes so they can re-execute
              outputPathNodes.forEach(id => executionState.delete(id));
              // Remove any existing copies from queue first to prevent duplicates
              const outputPathSet = new Set(outputPathNodes);
              const filteredQueue = executionQueue.filter(id => !outputPathSet.has(id));
              executionQueue.length = 0;
              executionQueue.push(...outputPathNodes, ...filteredQueue);
            }
          }
          console.log(`[GraphExecutor] ================================================`);
        }
      }
    }

    graphState.status = 'completed';
    graphState.endTime = Date.now();

    // Log execution summary
    const duration = graphState.endTime - graphState.startTime;
    const totalExecutions = Array.from(executedCount.values()).reduce((a, b) => a + b, 0);
    log.info(`COMPLETE: ${totalExecutions} total node executions in ${duration}ms`);

    // Show iteration counts for looped nodes
    const loopedNodes = Array.from(executedCount.entries()).filter(([_, count]) => count > 1);
    if (loopedNodes.length > 0) {
      log.info(`   Iterations: ${loopedNodes.map(([id, count]) => `node${id}x${count}`).join(', ')}`);
    }

    if (eventHandler) {
      eventHandler({
        type: 'graph_complete',
        data: { duration: graphState.endTime - graphState.startTime, iterations: totalExecutions },
        timestamp: Date.now(),
      });
    }

    return graphState;

  } catch (error) {
    graphState.status = 'failed';
    graphState.endTime = Date.now();

    if (eventHandler) {
      eventHandler({
        type: 'graph_error',
        data: { error: (error as Error).message },
        timestamp: Date.now(),
      });
    }
    return graphState;
  }
}

/**
 * Get the final output from a graph execution
 * Looks for stream_writer node output or falls back to last completed node
 */
export function getGraphOutput(state: GraphExecutionState): any {
  let streamWriterOutput: any = null;
  let lastOutput: any = null;
  let streamWriterNodeId: string | null = null;

  state.nodes.forEach((nodeState, nodeId) => {
    if (nodeState.status === 'completed' && nodeState.outputs) {
      // Check if this has output/response properties (stream_writer signature)
      if (nodeState.outputs.output !== undefined || nodeState.outputs.response !== undefined) {
        streamWriterOutput = nodeState.outputs;
        streamWriterNodeId = nodeId;
      }
      lastOutput = nodeState.outputs;
    }
  });

  // Debug logging
  console.log('[getGraphOutput] streamWriterNodeId:', streamWriterNodeId);
  console.log('[getGraphOutput] streamWriterOutput:', streamWriterOutput ? {
    hasOutput: streamWriterOutput.output !== undefined,
    hasResponse: streamWriterOutput.response !== undefined,
    outputPreview: typeof streamWriterOutput.output === 'string' ? streamWriterOutput.output.substring(0, 100) : typeof streamWriterOutput.output,
    responsePreview: typeof streamWriterOutput.response === 'string' ? streamWriterOutput.response.substring(0, 100) : typeof streamWriterOutput.response,
  } : null);

  // Return stream_writer output if found, otherwise fall back to last output
  return streamWriterOutput || lastOutput;
}

/**
 * Format execution state for debugging
 */
export function formatExecutionState(state: GraphExecutionState): string {
  const lines: string[] = [];
  lines.push(`Graph Execution (${state.status})`);
  lines.push(`Duration: ${state.endTime ? state.endTime - state.startTime : 'ongoing'}ms`);
  lines.push('');
  lines.push('Nodes:');

  state.nodes.forEach((nodeState, nodeId) => {
    const duration = nodeState.endTime && nodeState.startTime
      ? nodeState.endTime - nodeState.startTime
      : 'N/A';
    lines.push(`  ${nodeId}: ${nodeState.status} (${duration}ms)`);

    if (nodeState.error) {
      lines.push(`    Error: ${nodeState.error.message}`);
    }
  });

  return lines.join('\n');
}
