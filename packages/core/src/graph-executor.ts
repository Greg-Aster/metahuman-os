/**
 * Graph Execution Engine for Cognitive Node System
 *
 * This module provides the runtime execution logic for cognitive graphs,
 * using native Svelte Flow format (string IDs, edges with handles).
 */

import {
  validateSvelteFlowGraph,
  type GraphOutputCondition,
  type SvelteFlowGraph,
  type SvelteFlowNode,
  type SvelteFlowEdge,
} from './cognitive-graph-schema.js';
import { createLogger } from './logger.js';
import { loadOperatorConfig } from './config.js';
import { eventBus, EventTypes, generateRequestId } from './infrastructure/event-bus/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { systemPaths } from './path-builder.js';
import { getNode, getNodeExecutor, materializeNodeProperties } from './nodes/index.js';

const log = createLogger('graph-pipeline');

// Default timeouts (in ms)
const DEFAULT_NODE_TIMEOUT = 600000;  // 10 minutes
const DEFAULT_LLM_TIMEOUT = 900000;   // 15 minutes

// Node types that are considered LLM nodes (need longer timeouts)
const LLM_NODE_TYPES = new Set([
  'curator_llm', 'response_llm', 'planner_llm', 'decision_llm',
  'unified_decision_llm', 'big_brother_reviewer', 'big_brother_decision', 'llm',
  'claude_full_task', 'orchestrator_llm', 'persona_llm', 'response_synthesizer',
  'movement_generator', 'llm_enricher',
  'inner_curiosity_question_generator', 'inner_curiosity_answer_generator',
]);

/**
 * Write a graph execution trace to the NDJSON trace file.
 * This populates the trace file that graph-traces.ts reads from.
 */
function writeGraphTrace(trace: {
  timestamp: string;
  mode?: string;
  graph?: string;
  sessionId?: string;
  requestId?: string;
  status: 'started' | 'completed' | 'failed';
  durationMs?: number;
  eventCount?: number;
  error?: string;
}): void {
  try {
    const traceFile = path.join(systemPaths.logs, 'graph-traces.ndjson');
    fs.mkdirSync(path.dirname(traceFile), { recursive: true });
    fs.appendFileSync(traceFile, JSON.stringify(trace) + '\n');
  } catch (error) {
    console.error('[graph-executor] Failed to write trace:', error);
  }
}

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'skipped' | 'failed';

export interface NodeExecutionState {
  nodeId: string;
  status: ExecutionStatus;
  startTime?: number;
  endTime?: number;
  inputs?: Record<string, any>;
  outputs?: Record<string, any>;
  skipReason?: string;
  error?: Error;
  /** Node definition from graph (schema) - used for output node detection */
  definition?: {
    type?: string;
    isOutputNode?: boolean;
    [key: string]: any;
  };
}

export interface GraphExecutionState {
  nodes: Map<string, NodeExecutionState>;
  startTime: number;
  endTime?: number;
  currentNodeId?: string;
  status: ExecutionStatus;
}

export interface ExecutionEvent {
  type: 'node_start' | 'node_complete' | 'node_skip' | 'node_error' | 'node_reasoning' | 'graph_complete' | 'graph_error';
  nodeId?: string;
  data?: any;
  timestamp: number;
}

export type ExecutionEventHandler = (event: ExecutionEvent) => void;

/**
 * Generate unique edge key that includes source handle
 * This allows distinguishing between edges with same source/target but different handles
 */
function getEdgeKey(edge: SvelteFlowEdge): string {
  return edge.id;
}

function identifyBackEdges(graph: SvelteFlowGraph): Set<string> {
  return new Set(
    graph.edges.filter(edge => edge.data?.loop === true).map(getEdgeKey),
  );
}

/**
 * Topological sort for determining execution order
 * Supports bounded re-entry through explicitly declared loop edges.
 */
function topologicalSort(graph: SvelteFlowGraph): string[] {
  const nodeIds = graph.nodes.map(n => n.id);
  const adjacencyList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // Explicit loop edges are excluded from the acyclic schedule.
  const backEdges = identifyBackEdges(graph);

  // Initialize
  nodeIds.forEach(id => {
    adjacencyList.set(id, []);
    inDegree.set(id, 0);
  });

  const addDependency = (source: string, target: string): void => {
    const neighbors = adjacencyList.get(source);
    if (!neighbors || neighbors.includes(target)) return;
    neighbors.push(target);
    inDegree.set(target, (inDegree.get(target) || 0) + 1);
  };

  // Build data/control dependencies, excluding explicit loop edges.
  graph.edges.forEach(edge => {
    const edgeKey = getEdgeKey(edge);
    if (!backEdges.has(edgeKey)) {
      addDependency(edge.source, edge.target);
    }
  });

  // Cross-node activation conditions are explicit control dependencies.
  graph.nodes.forEach(node => {
    node.data.activation?.when?.forEach(condition => {
      addDependency(condition.nodeId, node.id);
    });
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
 * Read a dotted output path while preserving false, zero, and empty strings.
 */
function readOutputPath(outputs: Record<string, any>, outputPath: string): { found: boolean; value?: any } {
  const parts = outputPath.split('.');
  let current: any = outputs;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) {
      return { found: false };
    }
    current = current[part];
  }
  return { found: true, value: current };
}

function matchesOutputCondition(outputs: Record<string, any>, condition: GraphOutputCondition): boolean {
  const result = readOutputPath(outputs, condition.output);
  if (!result.found) return false;
  if ('equals' in condition) return Object.is(result.value, condition.equals);
  if ('notEquals' in condition) return !Object.is(result.value, condition.notEquals);
  return Boolean(result.value) === condition.truthy;
}

function isEdgeActive(
  edge: SvelteFlowEdge,
  executionState: Map<string, NodeExecutionState>,
): boolean {
  const sourceState = executionState.get(edge.source);
  if (sourceState?.status !== 'completed' || !sourceState.outputs) return false;
  if (edge.data?.when && !matchesOutputCondition(sourceState.outputs, edge.data.when)) return false;
  if (edge.data?.kind === 'control') return true;
  const output = readOutputPath(sourceState.outputs, edge.sourceHandle);
  return output.found && output.value !== undefined && output.value !== null;
}

interface NodeReadiness {
  ready: boolean;
  inputs: Record<string, any>;
  reason?: string;
}

function getNodeReadiness(
  node: SvelteFlowNode,
  graph: SvelteFlowGraph,
  executionState: Map<string, NodeExecutionState>,
): NodeReadiness {
  const definition = getNode(node.data.nodeType);
  if (!definition) {
    return { ready: false, inputs: {}, reason: `No registered definition for ${node.data.nodeType}` };
  }
  if (definition.editorOnly) {
    return { ready: false, inputs: {}, reason: 'Editor-only annotation' };
  }

  for (const condition of node.data.activation?.when || []) {
    const conditionState = executionState.get(condition.nodeId);
    if (conditionState?.status !== 'completed' || !conditionState.outputs
      || !matchesOutputCondition(conditionState.outputs, condition)) {
      return {
        ready: false,
        inputs: {},
        reason: `Activation condition from node ${condition.nodeId} was not selected`,
      };
    }
  }

  const incomingEdges = graph.edges.filter(edge => edge.target === node.id);
  const activeEdges = incomingEdges.filter(edge => isEdgeActive(edge, executionState));
  const inputs: Record<string, any> = {};
  const activeInputHandles = new Set<string>();

  // Apply loop values after forward values so re-entry owns a shared handle.
  const orderedEdges = [...activeEdges].sort((a, b) => Number(a.data?.loop === true) - Number(b.data?.loop === true));
  for (const edge of orderedEdges) {
    if (edge.data?.kind === 'control') continue;
    const output = readOutputPath(executionState.get(edge.source)!.outputs!, edge.sourceHandle);
    inputs[edge.targetHandle] = output.value;
    activeInputHandles.add(edge.targetHandle);
  }

  const activation = node.data.activation?.mode ?? definition.execution.activation;
  const requiredInputs = node.data.activation?.requiredInputs ?? definition.execution.requiredInputs;
  if (activation === 'always') return { ready: true, inputs };

  if (activation === 'required-inputs') {
    const missing = requiredInputs.filter(input => !activeInputHandles.has(input));
    if (missing.length > 0) {
      return { ready: false, inputs, reason: `Required input(s) inactive: ${missing.join(', ')}` };
    }
    return { ready: true, inputs };
  }

  if (incomingEdges.length === 0 || activeEdges.length > 0) return { ready: true, inputs };
  return { ready: false, inputs, reason: 'All incoming branches were inactive' };
}

/**
 * Execute a single node
 */
async function executeNode(
  nodeId: string,
  graph: SvelteFlowGraph,
  executionState: Map<string, NodeExecutionState>,
  inputs: Record<string, any>,
  contextData: Record<string, any>,
  eventHandler?: ExecutionEventHandler
): Promise<void> {
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) {
    throw new Error(`Node ${nodeId} not found in graph`);
  }

  const nodeType = node.data.nodeType;

  // Extract node definition/schema for output detection
  const nodeDefinition = {
    type: node.data.schema?.type || node.data.nodeType,
    isOutputNode: node.data.schema?.isOutputNode || false,
    ...node.data.schema,
  };

  const state: NodeExecutionState = {
    nodeId,
    status: 'running',
    startTime: Date.now(),
    definition: nodeDefinition,
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
        data: { outputs, durationMs: duration },
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
        data: { error: (error as Error).message, durationMs: state.endTime - state.startTime! },
        timestamp: Date.now(),
      });
    }

    throw error;
  }
}

function skipNode(
  node: SvelteFlowNode,
  executionState: Map<string, NodeExecutionState>,
  inputs: Record<string, any>,
  reason: string,
  eventHandler?: ExecutionEventHandler,
): void {
  const now = Date.now();
  executionState.set(node.id, {
    nodeId: node.id,
    status: 'skipped',
    startTime: now,
    endTime: now,
    inputs,
    skipReason: reason,
    definition: {
      type: node.data.schema?.type || node.data.nodeType,
      isOutputNode: node.data.schema?.isOutputNode || false,
      ...node.data.schema,
    },
  });
  log.debug(`   Node ${node.id} (${node.data.nodeType}) SKIPPED: ${reason}`);
  eventHandler?.({
    type: 'node_skip',
    nodeId: node.id,
    data: { nodeType: node.data.nodeType, reason },
    timestamp: now,
  });
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

  // In Node.js (or forced server mode): use the canonical node registry.
  log.debug(`     Server mode: Using real executor for ${nodeType}`);
  // Get the executor for this node type
  const executor = getNodeExecutor(nodeType);
  const nodeDefinition = getNode(nodeType);
  const effectiveProperties = nodeDefinition
    ? materializeNodeProperties(nodeDefinition, node.data.properties)
    : (node.data.properties || {});

  if (executor) {
    try {
      // Determine timeout based on node type and config
      // Priority: node property > operator config > defaults
      let timeoutMs = effectiveProperties?.timeout;

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
        const result = await executor(inputs, context, effectiveProperties);
        const duration = Date.now() - startTime;
        if (process.env.DEBUG_GRAPH) console.log(`[EXEC_END] Node ${node.id} (${nodeType}) completed in ${duration}ms`);
        return result as Record<string, any>;
      }

      if (process.env.DEBUG_GRAPH) console.log(`[EXEC_START] Node ${node.id} (${nodeType}) starting, timeout: ${timeoutMs}ms`);

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`TIMEOUT: Node ${node.id} (${nodeType}) exceeded ${timeoutMs / 1000} second execution limit`));
        }, timeoutMs);
      });

      const executionPromise = executor(inputs, context, effectiveProperties);
      let result: unknown;
      try {
        result = await Promise.race([executionPromise, timeoutPromise]);
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }

      const duration = Date.now() - startTime;
      if (process.env.DEBUG_GRAPH) console.log(`[EXEC_END] Node ${node.id} (${nodeType}) completed in ${duration}ms`);

      return result as Record<string, any>;
    } catch (error) {
      console.error(`[Node:${nodeType}] EXECUTION FAILED:`, error);
      throw error;
    }
  }

  throw new Error(`No executor registered for node type ${nodeType}`);
}

/**
 * Get nodes reachable from a loop source's explicit re-entry edge.
 */
function getLoopNodes(loopSourceId: string, graph: SvelteFlowGraph, backEdges: Set<string>): string[] {
  const loopTargets: string[] = [];

  // Find all re-entry edges from this source.
  graph.edges.forEach(edge => {
    if (edge.source === loopSourceId) {
      const edgeKey = getEdgeKey(edge);
      if (backEdges.has(edgeKey)) {
        loopTargets.push(edge.target);
      }
    }
  });

  if (loopTargets.length === 0) return [];

  // Find all nodes between the loop target and source (the loop body).
  const loopBody = new Set<string>();
  const visited = new Set<string>();
  const queue = [...loopTargets];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId) || nodeId === loopSourceId) continue;

    visited.add(nodeId);
    loopBody.add(nodeId);

    // Find downstream nodes
    graph.edges.forEach(edge => {
      if (edge.source === nodeId && edge.target !== loopSourceId) {
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
 * Get nodes downstream of a loop source via non-loop edges (the output path).
 * These nodes receive data when the loop exits
 */
function getOutputPathNodes(loopSourceId: string, graph: SvelteFlowGraph, backEdges: Set<string>): string[] {
  const outputTargets: string[] = [];

  // Find all non-loop edges from this source (these are output paths).
  graph.edges.forEach(edge => {
    if (edge.source === loopSourceId) {
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
    if (visited.has(nodeId) || nodeId === loopSourceId) continue;

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

/** @internal Pure queue helper exported for loop-scheduling regression tests. */
export function scheduleLoopIteration(
  executionQueue: string[],
  sortedLoopNodes: string[],
  outputPathNodes: string[],
  loopSourceId: string,
): string[] {
  const deferredNodeSet = new Set([
    ...sortedLoopNodes,
    ...outputPathNodes,
    loopSourceId,
  ]);
  const remainingQueue = executionQueue.filter(id => !deferredNodeSet.has(id));
  return [...sortedLoopNodes, loopSourceId, ...remainingQueue];
}

/** @internal Pure queue helper exported for loop-scheduling regression tests. */
export function scheduleAcceptedOutput(
  executionQueue: string[],
  sortedOutputPathNodes: string[],
): string[] {
  const outputPathSet = new Set(sortedOutputPathNodes);
  const remainingQueue = executionQueue.filter(id => !outputPathSet.has(id));
  return [...sortedOutputPathNodes, ...remainingQueue];
}

/**
 * Execute an entire graph
 * Accepts Svelte Flow format directly
 */
export async function executeGraph(
  graph: SvelteFlowGraph,
  contextData: Record<string, any>,
  eventHandler?: ExecutionEventHandler,
  signal?: AbortSignal,
): Promise<GraphExecutionState> {
  validateSvelteFlowGraph(graph);
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

  // Generate request ID for tracing if not provided
  const requestId = contextData.requestId || generateRequestId();
  const sessionId = contextData.sessionId;
  const userId = contextData.userId;

  // Write trace start and publish to event bus
  writeGraphTrace({
    timestamp: new Date().toISOString(),
    mode: graph.cognitiveMode,
    graph: graph.name,
    sessionId,
    requestId,
    status: 'started',
  });

  eventBus.emit('graph', EventTypes.GRAPH_EXECUTION_STARTED, {
    graphName: graph.name,
    graphVersion: graph.version,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    cognitiveMode: graph.cognitiveMode,
  }, { requestId, sessionId, userId });

  try {
    // Identify back-edges for conditional loops
    const backEdges = identifyBackEdges(graph);
    if (backEdges.size > 0) log.debug(`   Detected ${backEdges.size} explicit loop edge(s)`);

    // Get initial execution order (excluding back-edges)
    const executionOrder = topologicalSort(graph);
    log.debug(`   Execution Order: ${executionOrder.length} nodes`);
    console.log(`[GraphExecutor] Topological order: ${executionOrder.join(' → ')}`);

    // Dynamic execution queue (supports re-execution for loops)
    const executionQueue: string[] = [...executionOrder];
    const executedCount = new Map<string, number>();
    const maxLoopIterations = graph.scheduler.maxLoopIterations;

    while (executionQueue.length > 0) {
      if (signal?.aborted) throw new DOMException('Graph execution cancelled', 'AbortError');
      const nodeId = executionQueue.shift()!;
      const node = graph.nodes.find(n => n.id === nodeId);
      if (!node) throw new Error(`Node ${nodeId} not found in graph`);

      graphState.currentNodeId = nodeId;

      const readiness = getNodeReadiness(node, graph, executionState);
      if (node.data.muted || !readiness.ready) {
        skipNode(
          node,
          executionState,
          readiness.inputs,
          node.data.muted ? 'Muted by graph configuration' : readiness.reason || 'Node was not activated',
          eventHandler,
        );
        continue;
      }

      const iterCount = (executedCount.get(nodeId) || 0) + 1;
      executedCount.set(nodeId, iterCount);

      // Inject iteration count into context for feedback_router and other loop-aware nodes
      // Also add emitEvent for nodes to emit arbitrary events (e.g., Claude CLI streaming)
      const nodeContext = {
        ...contextData,
        _graphExecutorIteration: iterCount,
        emitEvent: eventHandler
          ? (type: ExecutionEvent['type'], data: any) => eventHandler({ type, data, nodeId, timestamp: Date.now() })
          : undefined,
      };

      // Execute the node
      await executeNode(nodeId, graph, executionState, readiness.inputs, nodeContext, eventHandler);
      if (signal?.aborted) throw new DOMException('Graph execution cancelled', 'AbortError');

      const outgoingLoopEdges = graph.edges.filter(edge => (
        edge.source === nodeId
        && edge.data?.loop === true
      ));
      if (outgoingLoopEdges.length === 0) continue;

      const activeLoopEdges = outgoingLoopEdges.filter(edge => isEdgeActive(edge, executionState));
      if (activeLoopEdges.length > 0) {
        if (iterCount >= maxLoopIterations) {
          throw new Error(`Loop at node ${nodeId} exceeded maximum iterations (${maxLoopIterations})`);
        }

        const loopNodes = getLoopNodes(nodeId, graph, backEdges);
        const loopNodeSet = new Set(loopNodes);
        const sortedLoopNodes = executionOrder.filter(id => loopNodeSet.has(id));
        if (sortedLoopNodes.length === 0) {
          throw new Error(`Active loop edge from node ${nodeId} has no schedulable loop body`);
        }

        sortedLoopNodes.forEach(id => executionState.delete(id));
        const outputPathNodes = getOutputPathNodes(nodeId, graph, backEdges);
        const scheduledQueue = scheduleLoopIteration(
          executionQueue,
          sortedLoopNodes,
          outputPathNodes,
          nodeId,
        );
        executionQueue.length = 0;
        executionQueue.push(...scheduledQueue);
        log.debug(`   Explicit loop ${nodeId}: scheduled iteration ${iterCount + 1}`);
      } else {
        const outputPathNodes = getOutputPathNodes(nodeId, graph, backEdges);
        const outputPathSet = new Set(outputPathNodes);
        const sortedOutputPathNodes = executionOrder.filter(id => outputPathSet.has(id));
        sortedOutputPathNodes.forEach(id => executionState.delete(id));
        const scheduledQueue = scheduleAcceptedOutput(executionQueue, sortedOutputPathNodes);
        executionQueue.length = 0;
        executionQueue.push(...scheduledQueue);
      }
    }

    graphState.status = 'completed';
    graphState.endTime = Date.now();

    // Log execution summary
    const duration = graphState.endTime - graphState.startTime;
    const totalExecutions = Array.from(executedCount.values()).reduce((a, b) => a + b, 0);
    const skippedNodes = Array.from(executionState.values()).filter(node => node.status === 'skipped').length;
    log.info(`COMPLETE: ${totalExecutions} executions, ${skippedNodes} skipped in ${duration}ms`);

    // Show iteration counts for looped nodes
    const loopedNodes = Array.from(executedCount.entries()).filter(([_, count]) => count > 1);
    if (loopedNodes.length > 0) {
      log.info(`   Iterations: ${loopedNodes.map(([id, count]) => `node${id}x${count}`).join(', ')}`);
    }

    // Write trace completion and publish to event bus
    writeGraphTrace({
      timestamp: new Date().toISOString(),
      mode: graph.cognitiveMode,
      graph: graph.name,
      sessionId,
      requestId,
      status: 'completed',
      durationMs: duration,
      eventCount: totalExecutions,
    });

    eventBus.emit('graph', EventTypes.GRAPH_EXECUTION_COMPLETED, {
      graphName: graph.name,
      durationMs: duration,
      totalExecutions,
      loopedNodes: loopedNodes.length,
      skippedNodes,
    }, { requestId, sessionId, userId, durationMs: duration });

    if (eventHandler) {
      eventHandler({
        type: 'graph_complete',
        data: { duration: graphState.endTime - graphState.startTime, iterations: totalExecutions, skippedNodes },
        timestamp: Date.now(),
      });
    }

    return graphState;

  } catch (error) {
    graphState.status = 'failed';
    graphState.endTime = Date.now();
    const duration = graphState.endTime - graphState.startTime;

    // Write trace failure and publish to event bus
    writeGraphTrace({
      timestamp: new Date().toISOString(),
      mode: graph.cognitiveMode,
      graph: graph.name,
      sessionId,
      requestId,
      status: 'failed',
      durationMs: duration,
      error: (error as Error).message,
    });

    eventBus.emit('graph', EventTypes.GRAPH_NODE_ERROR, {
      graphName: graph.name,
      error: (error as Error).message,
      durationMs: duration,
    }, { requestId, sessionId, userId, level: 'error' });

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

/** Node output info for getGraphOutput priority selection */
type NodeOutputInfo = { id: string; outputs: Record<string, any> };

/**
 * Get the final output from a graph execution
 *
 * Priority order:
 * 1. Node explicitly marked as output (isOutputNode: true in definition)
 * 2. Stream writer node
 * 3. Last completed node with output/response properties
 * 4. Last completed node (fallback)
 */
export function getGraphOutput(state: GraphExecutionState): Record<string, any> | null {
  let explicitOutputNode: NodeOutputInfo | null = null;
  let writerNode: NodeOutputInfo | null = null;
  let responseNode: NodeOutputInfo | null = null;
  let lastCompletedNode: NodeOutputInfo | null = null;

  // Use for...of for better type narrowing (forEach callbacks don't narrow well)
  for (const [nodeId, nodeState] of state.nodes) {
    if (nodeState.status !== 'completed' || !nodeState.outputs) continue;

    // Priority 1: Explicit output node marker
    if (nodeState.definition?.isOutputNode) {
      explicitOutputNode = { id: nodeId, outputs: nodeState.outputs };
    }

    // Priority 2: Writer nodes by type
    const nodeType = nodeState.definition?.type;
    if (nodeType === 'stream_writer') {
      writerNode = { id: nodeId, outputs: nodeState.outputs };
    }

    // Priority 3: Node with response property (but only track last one)
    if (nodeState.outputs.output !== undefined || nodeState.outputs.response !== undefined) {
      responseNode = { id: nodeId, outputs: nodeState.outputs };
    }

    // Track last completed node for fallback
    lastCompletedNode = { id: nodeId, outputs: nodeState.outputs };
  }

  // Select output based on priority
  const selected: NodeOutputInfo | null = explicitOutputNode || writerNode || responseNode || lastCompletedNode;

  // Debug logging
  console.log('[getGraphOutput] Priority check:', {
    explicitOutputNode: explicitOutputNode?.id ?? null,
    writerNode: writerNode?.id ?? null,
    responseNode: responseNode?.id ?? null,
    lastCompletedNode: lastCompletedNode?.id ?? null,
    selectedNode: selected?.id ?? null,
  });

  if (selected) {
    console.log('[getGraphOutput] Selected output from:', selected.id, {
      hasOutput: selected.outputs.output !== undefined,
      hasResponse: selected.outputs.response !== undefined,
      hasResponseBufferId: selected.outputs.responseBufferId !== undefined,
      hasActionTaken: selected.outputs.actionTaken !== undefined,
    });
  }

  return selected?.outputs ?? null;
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
    if (nodeState.skipReason) {
      lines.push(`    Skip reason: ${nodeState.skipReason}`);
    }
  });

  return lines.join('\n');
}
