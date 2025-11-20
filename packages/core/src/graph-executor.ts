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
 * Topological sort for determining execution order
 */
function topologicalSort(graph: CognitiveGraph): number[] {
  const nodeIds = graph.nodes.map(n => n.id);
  const adjacencyList = new Map<number, number[]>();
  const inDegree = new Map<number, number>();

  // Initialize
  nodeIds.forEach(id => {
    adjacencyList.set(id, []);
    inDegree.set(id, 0);
  });

  // Build adjacency list and in-degree map
  graph.links.forEach(link => {
    adjacencyList.get(link.origin_id)?.push(link.target_id);
    inDegree.set(link.target_id, (inDegree.get(link.target_id) || 0) + 1);
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

  // Check for cycles
  if (sorted.length !== nodeIds.length) {
    throw new Error('Graph contains cycles - cannot execute');
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
        // For now, use a simple mapping based on slot index
        // In a real implementation, this would use the node schema
        const value = sourceNode.outputs[link.origin_slot] || sourceNode.outputs;
        inputs[link.target_slot] = value;
      }
    }
  });

  return inputs;
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
  const { getNodeExecutor } = await import('./node-executors.js');

  // Get the executor for this node type
  const executor = getNodeExecutor(nodeType);

  if (executor) {
    try {
      // Execute with real implementation
      return await executor(inputs, context, node.properties);
    } catch (error) {
      console.error(`[Node:${nodeType}] Execution error:`, error);
      throw error;
    }
  }

  // Fallback: pass through inputs if no executor found
  console.warn(`[Node:${nodeType}] No executor found, passing through inputs`);
  return inputs;
}

/**
 * Execute an entire graph
 */
export async function executeGraph(
  graph: CognitiveGraph,
  contextData: Record<string, any>,
  eventHandler?: ExecutionEventHandler
): Promise<GraphExecutionState> {
  const executionState = new Map<number, NodeExecutionState>();
  const graphState: GraphExecutionState = {
    nodes: executionState,
    startTime: Date.now(),
    status: 'running',
  };

  log.info(`🚀 Starting execution: ${graph.name} v${graph.version}`);
  log.debug(`   Nodes: ${graph.nodes.length}, Links: ${graph.links.length}`);
  log.debug(`   Cognitive Mode: ${graph.cognitiveMode || 'default'}`);
  log.debug(`   Context: userId=${contextData.userId}, sessionId=${contextData.sessionId}`);

  try {
    // Get execution order
    const executionOrder = topologicalSort(graph);
    log.debug(`   Execution Order: ${executionOrder.length} nodes`);

    // Execute nodes in order
    for (const nodeId of executionOrder) {
      graphState.currentNodeId = nodeId;
      await executeNode(nodeId, graph, executionState, contextData, eventHandler);
    }

    graphState.status = 'completed';
    graphState.endTime = Date.now();

    // Log execution summary
    const duration = graphState.endTime - graphState.startTime;
    const nodeTypes = executionOrder
      .map(id => graph.nodes.find(n => n.id === id)?.type.replace('cognitive/', ''))
      .filter(Boolean);
    log.info(`✅ COMPLETE: ${nodeTypes.length} nodes in ${duration}ms`);
    log.info(`   Pipeline: ${nodeTypes.join(' → ')}`);

    if (eventHandler) {
      eventHandler({
        type: 'graph_complete',
        data: { duration: graphState.endTime - graphState.startTime },
        timestamp: Date.now(),
      });
    }

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
  }

  return graphState;
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
