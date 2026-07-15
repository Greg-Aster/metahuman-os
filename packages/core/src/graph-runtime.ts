/**
 * Shared graph runtime helpers.
 *
 * This module keeps graph runners thin without changing graph execution
 * semantics. Missing executors remain report-only here; executeGraph still
 * owns runtime behavior.
 */

import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { SvelteFlowGraph, SvelteFlowNode } from './cognitive-graph-schema.js'
import { validateSvelteFlowGraph } from './cognitive-graph-schema.js'
import {
  executeGraph,
  getGraphOutput,
  type ExecutionEventHandler,
  type GraphExecutionState,
} from './graph-executor.js'
import { getNodeExecutor } from './nodes/index.js'
import { ROOT } from './path-builder.js'

export interface GraphRunParams {
  graph: SvelteFlowGraph;
  context: Record<string, any>;
  eventHandler?: ExecutionEventHandler;
  signal?: AbortSignal;
}

export interface CachedGraphEntry {
  source: string;
  mtimeMs: number;
  graph: SvelteFlowGraph;
}

export interface FailedGraphNode {
  nodeId: string;
  error: string;
}

export interface MissingExecutorInfo {
  nodeId: string;
  nodeType: string;
  label?: string;
}

export class AsyncEventQueue {
  private queue: string[] = []
  private resolvers: Array<(value: IteratorResult<string>) => void> = []
  private done = false

  push(event: string): void {
    if (this.done) return

    if (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()!
      resolver({ value: event, done: false })
    } else {
      this.queue.push(event)
    }
  }

  finish(): void {
    this.done = true
    while (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift()!
      resolver({ value: undefined as any, done: true })
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!
      } else if (this.done) {
        return
      } else {
        const event = await new Promise<IteratorResult<string>>(resolve => {
          this.resolvers.push(resolve)
        })
        if (event.done) return
        yield event.value
      }
    }
  }
}

export function sseData(type: string, data: any): string {
  return `data: ${JSON.stringify({ type, data })}\n\n`
}

export function namedSse(event: string, data: any): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function runGraph(params: GraphRunParams): Promise<GraphExecutionState> {
  return executeGraph(params.graph, params.context, params.eventHandler, params.signal)
}

export function extractGraphOutput(graphState: GraphExecutionState): Record<string, any> | null {
  return getGraphOutput(graphState)
}

export function collectNodeOutputs(graphState: GraphExecutionState): Record<string, any> {
  const nodeOutputs: Record<string, any> = {}
  graphState.nodes.forEach((nodeState, nodeId) => {
    if (nodeState.outputs) {
      nodeOutputs[nodeId] = nodeState.outputs
    }
  })
  return nodeOutputs
}

export function listExecutedNodes(graphState: GraphExecutionState): string[] {
  return Array.from(graphState.nodes.keys())
}

export function listFailedNodes(graphState: GraphExecutionState): FailedGraphNode[] {
  const failedNodes: FailedGraphNode[] = []
  graphState.nodes.forEach((nodeState, nodeId) => {
    if (nodeState.status === 'failed') {
      failedNodes.push({
        nodeId,
        error: nodeState.error?.message || 'Unknown error',
      })
    }
  })
  return failedNodes
}

export function getFirstFailedNode(graphState: GraphExecutionState): FailedGraphNode | null {
  return listFailedNodes(graphState)[0] ?? null
}

export function extractQueuedTTSOutput(graphState: GraphExecutionState): {
  text: string;
  itemId?: string;
  mode?: 'conversation' | 'inner';
  source?: string;
} | null {
  let latest: { text: string; itemId?: string; mode?: 'conversation' | 'inner'; source?: string } | null = null

  for (const [, nodeState] of graphState.nodes) {
    if (nodeState.status !== 'completed' || !nodeState.outputs) continue

    const outputs = nodeState.outputs
    if (outputs.queued === true && typeof outputs.text === 'string' && outputs.text.trim()) {
      latest = {
        text: outputs.text.trim(),
        itemId: typeof outputs.itemId === 'string' ? outputs.itemId : undefined,
        mode: outputs.conversationQueued ? 'conversation' : outputs.innerQueued ? 'inner' : undefined,
        source: nodeState.definition?.type,
      }
    }
  }

  return latest
}

export function getGraphNodeType(node: SvelteFlowNode): string {
  return node.data?.nodeType || node.type || node.id
}

export function findMissingExecutors(graph: SvelteFlowGraph): MissingExecutorInfo[] {
  const missing: MissingExecutorInfo[] = []

  for (const node of graph.nodes) {
    const nodeType = getGraphNodeType(node)
    if (!getNodeExecutor(nodeType)) {
      missing.push({
        nodeId: node.id,
        nodeType,
        label: node.data?.label,
      })
    }
  }

  return missing
}

export async function loadGraphFile(
  filePath: string,
  options: {
    cache?: Record<string, CachedGraphEntry | null>;
    cacheKey?: string;
    logPrefix?: string;
  } = {}
): Promise<{ graph: SvelteFlowGraph; source: string } | null> {
  const { cache, cacheKey = filePath, logPrefix = '[graph-runtime]' } = options

  try {
    if (!existsSync(filePath)) {
      console.error(`${logPrefix} Graph file not found: ${filePath}`)
      return null
    }

    const stats = await stat(filePath)
    const cached = cache?.[cacheKey]
    if (cached && cached.source === filePath && cached.mtimeMs === stats.mtimeMs) {
      return { graph: cached.graph, source: filePath }
    }

    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    const graph = validateSvelteFlowGraph(parsed)

    if (cache) {
      cache[cacheKey] = { source: filePath, mtimeMs: stats.mtimeMs, graph }
    }

    return { graph, source: filePath }
  } catch (error) {
    console.error(`${logPrefix} Failed to load graph:`, error)
    return null
  }
}

export function cognitiveGraphPath(fileName: string): string {
  return path.join(ROOT, 'etc', 'cognitive-graphs', fileName)
}
