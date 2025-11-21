/**
 * Graph Execution Engine for Cognitive Node System
 *
 * This module provides the runtime execution logic for cognitive graphs,
 * allowing them to actually process messages and drive the cognitive pipeline.
 */

import type { CognitiveGraph } from './cognitive-graph-schema';
import { createLogger } from './logger.js';

const log = createLogger('graph-pipeline');

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface NodeExecutionState {
  nodeId: number;
  status: ExecutionStatus;
  startTime?: number;
  endTime?: number;
  inputs?: Record<string, any>;
  outputs?: Record<string, any>;
  error?: Error;
}

export interface GraphExecutionState {
  nodes: Map<number, NodeExecutionState>;
  startTime: number;
  endTime?: number;
  currentNodeId?: number;
  status: ExecutionStatus;
}

export interface ExecutionEvent {
  type: 'node_start' | 'node_complete' | 'node_error' | 'graph_complete' | 'graph_error';
  nodeId?: number;
  data?: any;
  timestamp: number;
}

export type ExecutionEventHandler = (event: ExecutionEvent) => void;

/**
 * Identify back-edges (edges that would create cycles)
 * These are allowed ONLY from conditional_router nodes
 */
function identifyBackEdges(graph: CognitiveGraph): Set<string> {
  const backEdges = new Set<string>();

  // Find all conditional_router nodes
  const routerNodes = graph.nodes.filter(n => n.type === 'conditional_router' || n.type === 'cognitive/conditional_router');
  const routerIds = new Set(routerNodes.map(n => n.id));

  // For each router, identify which of its output links are "loop back" links
  graph.links.forEach(link => {
    if (routerIds.has(link.origin_id)) {
      // Check if this link creates a cycle (target comes before origin in dependency order)
      // We'll mark links that might loop back based on slot naming or link properties
      // Slot 0 = "true path" (exit/continue), Slot 1 = "false path" (loop back)
      if (link.origin_slot === 1 || link.comment?.includes('loop') || link.comment?.includes('back')) {
        backEdges.add(`${link.origin_id}->${link.target_id}`);
      }
    }
  });

  return backEdges;
}

/**
 * Topological sort for determining execution order
 * Supports conditional loops via conditional_router nodes
 */
function topologicalSort(graph: CognitiveGraph): number[] {
  const nodeIds = graph.nodes.map(n => n.id);
  const adjacencyList = new Map<number, number[]>();
  const inDegree = new Map<number, number>();

  // Identify back-edges (loop edges from conditional_router)
  const backEdges = identifyBackEdges(graph);

  // Initialize
  nodeIds.forEach(id => {
    adjacencyList.set(id, []);
    inDegree.set(id, 0);
  });

  // Build adjacency list and in-degree map (excluding back-edges)
  graph.links.forEach(link => {
    const edgeKey = `${link.origin_id}->${link.target_id}`;
    if (!backEdges.has(edgeKey)) {
      adjacencyList.get(link.origin_id)?.push(link.target_id);
      inDegree.set(link.target_id, (inDegree.get(link.target_id) || 0) + 1);
    }
  });

  // Find nodes with no incoming edges
  const queue: number[] = [];
  inDegree.forEach((degree, nodeId) => {
    if (degree === 0) {
      queue.push(nodeId);
    }
  });

  const sorted: number[] = [];
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
  nodeId: number,
  graph: CognitiveGraph,
  executionState: Map<number, NodeExecutionState>
): Record<string, any> {
  const inputs: Record<string, any> = {};

  // Find all links that target this node
  const incomingLinks = graph.links.filter(link => link.target_id === nodeId);

  incomingLinks.forEach(link => {
    const sourceNode = executionState.get(link.origin_id);
    if (sourceNode?.outputs) {
      // Get the output from the source node's slot
      const sourceNodeDef = graph.nodes.find(n => n.id === link.origin_id);
      const targetNodeDef = graph.nodes.find(n => n.id === nodeId);

      if (sourceNodeDef && targetNodeDef) {
        // Handle slot-based outputs
        let value;

        // Special handling for conditional_router: extract routedData for all slots
        if (sourceNode.outputs.routedData !== undefined) {
          value = sourceNode.outputs.routedData;
        }
        // Try numeric slot access first (for array-based outputs)
        else if (sourceNode.outputs[link.origin_slot] !== undefined) {
          value = sourceNode.outputs[link.origin_slot];
        }
        // Fallback: use entire output object
        else {
          value = sourceNode.outputs;
        }

        // DEBUG: Log data passing between nodes
        if (link.origin_id === 9 && link.target_id === 14) {
          console.log('[getNodeInputs] 🔗 ResponseSynthesizer → CoTStripper');
          console.log('[getNodeInputs] sourceNode.outputs:', JSON.stringify(sourceNode.outputs).substring(0, 200));
          console.log('[getNodeInputs] link.origin_slot:', link.origin_slot);
          console.log('[getNodeInputs] value to pass:', JSON.stringify(value).substring(0, 200));
          console.log('[getNodeInputs] target_slot:', link.target_slot);
        }

        inputs[link.target_slot] = value;
      }
    }
  });

  // Convert sparse object to array for executor compatibility
  // Node executors expect inputs as an array-like structure
  const maxSlot = Math.max(-1, ...Object.keys(inputs).map(k => parseInt(k, 10)).filter(n => !isNaN(n)));
  const inputArray: any[] = [];
  for (let i = 0; i <= maxSlot; i++) {
    inputArray[i] = inputs[i];
  }

  // DEBUG: Log final inputs array for CoTStripper
  if (nodeId === 14) {
    console.log('[getNodeInputs] 🎯 Final inputs for CoTStripper (node 14):');
    console.log('[getNodeInputs] inputs object:', JSON.stringify(inputs).substring(0, 200));
    console.log('[getNodeInputs] maxSlot:', maxSlot);
    console.log('[getNodeInputs] inputArray length:', inputArray.length);
    console.log('[getNodeInputs] inputArray[0]:', inputArray[0] ? JSON.stringify(inputArray[0]).substring(0, 200) : 'undefined');
  }

  return inputArray.length > 0 ? inputArray : inputs;
}

/**
 * Execute a single node
 */
async function executeNode(
  nodeId: number,
  graph: CognitiveGraph,
  executionState: Map<number, NodeExecutionState>,
  contextData: Record<string, any>,
  eventHandler?: ExecutionEventHandler
): Promise<void> {
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) {
    throw new Error(`Node ${nodeId} not found in graph`);
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
      data: { nodeType: node.type },
      timestamp: Date.now(),
    });
  }

  try {
    // Get inputs from connected nodes
    const inputs = getNodeInputs(nodeId, graph, executionState);

    const inputSummary = Array.isArray(inputs)
      ? inputs.map(i => typeof i === 'object' ? `{${Object.keys(i).join(',')}}` : i)
      : inputs;
    log.debug(`   ➤ Node ${nodeId} (${node.type.replace('cognitive/', '')}) START`);
    log.debug(`     Inputs: ${JSON.stringify(inputSummary).substring(0, 200)}`);

    // Execute the node based on its type
    const outputs = await executeNodeByType(node, inputs, contextData);

    const outputSummary = typeof outputs === 'object' ? `{${Object.keys(outputs).join(',')}}` : outputs;
    const duration = Date.now() - state.startTime!;
    log.debug(`   ✓ Node ${nodeId} (${node.type.replace('cognitive/', '')}) DONE (${duration}ms)`);
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
    }
  } catch (error) {
    console.error(`[GraphExecutor] Node ${nodeId} (${node.type}) FAILED:`, error);
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
  node: any,
  inputs: Record<string, any>,
  context: Record<string, any>
): Promise<Record<string, any>> {
  const nodeType = node.type.replace('cognitive/', '');

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
  const { getNodeExecutor } = await import('./node-executors/index.js');

  // Get the executor for this node type
  const executor = getNodeExecutor(nodeType);

  if (executor) {
    try {
      // Execute with timeout protection (30 seconds)
      const startTime = Date.now();
      if (process.env.DEBUG_GRAPH) console.log(`[EXEC_START] Node ${node.id} (${nodeType}) starting at ${new Date().toISOString()}`);

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`⏱️ TIMEOUT: Node ${node.id} (${nodeType}) exceeded 30 second execution limit`));
        }, 30000);
      });

      const executionPromise = executor(inputs, context, node.properties);

      const result = await Promise.race([executionPromise, timeoutPromise]);

      const duration = Date.now() - startTime;
      if (process.env.DEBUG_GRAPH) console.log(`[EXEC_END] Node ${node.id} (${nodeType}) completed in ${duration}ms`);

      return result as Record<string, any>;
    } catch (error) {
      console.error(`[Node:${nodeType}] ❌ EXECUTION FAILED:`, error);
      console.error(`[Node:${nodeType}] Stack trace:`, (error as Error).stack);
      throw error;
    }
  }

  // Fallback: pass through inputs if no executor found
  console.warn(`[Node:${nodeType}] No executor found, passing through inputs`);
  return inputs;
}

/**
 * Get nodes reachable from a conditional router's loop-back edge
 */
function getLoopNodes(routerId: number, graph: CognitiveGraph, backEdges: Set<string>): number[] {
  const loopTargets: number[] = [];

  // Find all back-edges from this router
  graph.links.forEach(link => {
    if (link.origin_id === routerId) {
      const edgeKey = `${link.origin_id}->${link.target_id}`;
      if (backEdges.has(edgeKey)) {
        loopTargets.push(link.target_id);
      }
    }
  });

  if (loopTargets.length === 0) return [];

  // Find all nodes between loop target and router (the loop body)
  const loopBody = new Set<number>();
  const visited = new Set<number>();
  const queue = [...loopTargets];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId) || nodeId === routerId) continue;

    visited.add(nodeId);
    loopBody.add(nodeId);

    // Find downstream nodes
    graph.links.forEach(link => {
      if (link.origin_id === nodeId && link.target_id !== routerId) {
        const edgeKey = `${link.origin_id}->${link.target_id}`;
        if (!backEdges.has(edgeKey)) {
          queue.push(link.target_id);
        }
      }
    });
  }

  return Array.from(loopBody).sort((a, b) => a - b);
}

/**
 * Execute an entire graph
 * Supports conditional loops via conditional_router nodes
 */
export async function executeGraph(
  graph: CognitiveGraph,
  contextData: Record<string, any>,
  eventHandler?: ExecutionEventHandler
): Promise<GraphExecutionState> {
  console.log(`[🎯 EXEC_GRAPH_ENTRY] Function called at ${new Date().toISOString()}`);
  console.log(`[🎯 EXEC_GRAPH_ENTRY] Graph: ${graph?.name}, Nodes: ${graph?.nodes?.length}`);
  const timeoutMs = typeof contextData?.timeoutMs === 'number' ? contextData.timeoutMs : 30000;
  console.log(`[🎯 EXEC_GRAPH_ENTRY] Timeout set to ${timeoutMs}ms`);
  let timedOut = false;
  const timeoutError = new Error(`Graph execution timed out after ${timeoutMs}ms`);

  const executionState = new Map<number, NodeExecutionState>();
  const graphState: GraphExecutionState = {
    nodes: executionState,
    startTime: Date.now(),
    status: 'running',
  };

  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    log.warn(`[GraphExecutor] Timeout fired after ${timeoutMs}ms for graph "${graph.name}"`);
    if (eventHandler) {
      eventHandler({
        type: 'graph_error',
        data: { error: timeoutError.message },
        timestamp: Date.now(),
      });
    }
  }, timeoutMs);

  log.info(`🚀 Starting execution: ${graph.name} v${graph.version}`);
  log.debug(`   Nodes: ${graph.nodes.length}, Links: ${graph.links.length}`);
  log.debug(`   Cognitive Mode: ${graph.cognitiveMode || 'default'}`);
  log.debug(`   Context: userId=${contextData.userId}, sessionId=${contextData.sessionId}`);

  try {
    // Identify back-edges for conditional loops
    const backEdges = identifyBackEdges(graph);
    if (backEdges.size > 0) {
      log.debug(`   Detected ${backEdges.size} conditional loop edge(s)`);
    }

    // Get initial execution order (excluding back-edges)
    const executionOrder = topologicalSort(graph);
    log.debug(`   Execution Order: ${executionOrder.length} nodes`);

    // Dynamic execution queue (supports re-execution for loops)
    const executionQueue: number[] = [...executionOrder];
    const executedCount = new Map<number, number>(); // Track iteration count per node
    const maxIterations = 20; // Safety limit

    console.log(`[GraphExecutor] ========== EXECUTION QUEUE ==========`);
    console.log(`[GraphExecutor] Initial queue:`, executionQueue.join(', '));
    console.log(`[GraphExecutor] Total nodes to execute: ${executionQueue.length}`);

    while (executionQueue.length > 0) {
      const nodeId = executionQueue.shift()!;
      const node = graph.nodes.find(n => n.id === nodeId);
      const nodeType = node?.type || 'unknown';

      console.log(`[GraphExecutor] >>> Executing node ${nodeId} (${nodeType})`);

      // Track iteration count (prevent infinite loops)
      const iterCount = (executedCount.get(nodeId) || 0) + 1;
      executedCount.set(nodeId, iterCount);

      if (iterCount > maxIterations) {
        throw new Error(`Node ${nodeId} exceeded maximum iterations (${maxIterations}). Possible infinite loop.`);
      }

       if (timedOut) {
        throw timeoutError;
      }

      graphState.currentNodeId = nodeId;

      // Execute the node
      await executeNode(nodeId, graph, executionState, contextData, eventHandler);
      console.log(`[GraphExecutor] <<< Completed node ${nodeId} (${nodeType})`);

      // Check if this node is a conditional_router
      if (node && (node.type === 'conditional_router' || node.type === 'cognitive/conditional_router')) {
        const nodeState = executionState.get(nodeId);
        const outputs = nodeState?.outputs;

        console.log(`[GraphExecutor] ========== ROUTER DECISION HANDLING ==========`);
        console.log(`[GraphExecutor] Router node ${nodeId} executed (iteration ${iterCount})`);
        console.log(`[GraphExecutor] Outputs:`, JSON.stringify(outputs, null, 2));
        console.log(`[GraphExecutor] Branch: ${outputs?.branch}`);
        console.log(`[GraphExecutor] Routing Decision: ${outputs?.routingDecision}`);

        if (outputs && outputs.branch === 'false') {
          // Router decided to loop back
          log.debug(`   🔄 Loop triggered by router ${nodeId} (iteration ${iterCount})`);
          console.log(`[GraphExecutor] 🔄 LOOPING BACK - Branch is FALSE`);

          // Get the loop body nodes and re-add them to execution queue
          const loopNodes = getLoopNodes(nodeId, graph, backEdges);

          console.log(`[GraphExecutor] Loop body nodes to re-execute: ${loopNodes.join(', ')}`);

          if (loopNodes.length > 0) {
            // Clear execution state for loop body nodes ONLY
            // DON'T clear router state yet - loop body needs to read its outputs via back-edge!
            // Router state will be naturally overwritten when it re-executes
            loopNodes.forEach(id => executionState.delete(id));

            // Add loop nodes back to queue, then re-queue router at the end
            executionQueue.unshift(...loopNodes);
            executionQueue.push(nodeId);  // Router runs after loop body
            log.debug(`   🔄 Re-queued ${loopNodes.length} nodes + router for iteration`);
            console.log(`[GraphExecutor] Re-queued ${loopNodes.length} loop body nodes + router (node ${nodeId}). Queue size: ${executionQueue.length}`);
          } else {
            console.log(`[GraphExecutor] ⚠️  WARNING: No loop body nodes found! Loop cannot continue.`);
          }
        } else {
          log.debug(`   ✅ Router ${nodeId} exited loop (branch: ${outputs?.branch})`);
          console.log(`[GraphExecutor] ✅ EXITING LOOP - Branch is TRUE or other value`);
          console.log(`[GraphExecutor] Continuing with remaining ${executionQueue.length} nodes in queue`);
        }
        console.log(`[GraphExecutor] ================================================`);
      }
    }

    graphState.status = 'completed';
    graphState.endTime = Date.now();

    // Log execution summary
    const duration = graphState.endTime - graphState.startTime;
    const totalExecutions = Array.from(executedCount.values()).reduce((a, b) => a + b, 0);
    log.info(`✅ COMPLETE: ${totalExecutions} total node executions in ${duration}ms`);

    // Show iteration counts for looped nodes
    const loopedNodes = Array.from(executedCount.entries()).filter(([_, count]) => count > 1);
    if (loopedNodes.length > 0) {
      log.info(`   Iterations: ${loopedNodes.map(([id, count]) => `node${id}×${count}`).join(', ')}`);
    }

    if (eventHandler) {
      eventHandler({
        type: 'graph_complete',
        data: { duration: graphState.endTime - graphState.startTime, iterations: totalExecutions },
        timestamp: Date.now(),
      });
    }

    // Return the successful execution state
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
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Get the final output from a graph execution
 */
export function getGraphOutput(state: GraphExecutionState): any {
  // Priority 1: Look for stream_writer node (node 16 in dual-mode, node 9 in emulation-mode)
  let streamWriterOutput: any = null;
  let lastOutput: any = null;

  state.nodes.forEach((nodeState, nodeId) => {
    if (nodeState.status === 'completed' && nodeState.outputs) {
      // Check if this is a stream_writer node
      if (nodeId === 16 || nodeId === 9 || nodeState.outputs.output || nodeState.outputs.response) {
        streamWriterOutput = nodeState.outputs;
      }
      lastOutput = nodeState.outputs;
    }
  });

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
