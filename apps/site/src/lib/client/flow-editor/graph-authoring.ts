import type { Connection, Edge, Node } from '@xyflow/svelte'
import type {
  NodeSchema,
  NodeSlot,
  PropertySchema,
} from '@metahuman/core/nodes/types'
import { validatePropertyValue } from '@metahuman/core/nodes/types'
import type {
  GraphOutputCondition,
  GraphSchedulerContract,
} from '@metahuman/core/cognitive-graph-contract'
import type { SvelteFlowGraph } from './template-converter'

export type AuthoringIssueLevel = 'error' | 'warning'

export interface AuthoringIssue {
  level: AuthoringIssueLevel
  message: string
  nodeId?: string
  edgeId?: string
  propertyKey?: string
}

export interface BranchResult {
  edgeId: string
  label: string
  selected: boolean | null
}

function schemaFor(node: Node | undefined): NodeSchema | undefined {
  return node?.data?.schema as NodeSchema | undefined
}

function optionValue(option: string | { value: string; label: string }): string {
  return typeof option === 'string' ? option : option.value
}

export function slotFor(
  node: Node | undefined,
  direction: 'input' | 'output',
  handle: string | null | undefined,
): NodeSlot | undefined {
  if (!handle) return undefined
  const slots = direction === 'input' ? schemaFor(node)?.inputs : schemaFor(node)?.outputs
  return slots?.find(slot => slot.name === handle)
}

export function connectionProblem(
  nodes: Node[],
  edges: Edge[],
  connection: Connection,
  ignoredEdgeId?: string,
): string | null {
  const source = nodes.find(node => node.id === connection.source)
  const target = nodes.find(node => node.id === connection.target)
  if (!source || !target) return 'Both connection endpoints must exist.'
  const isControlEdge = (connection as Connection & { data?: { kind?: unknown } }).data?.kind === 'control'
  if (!isControlEdge) {
    if (!slotFor(source, 'output', connection.sourceHandle)) {
      return 'Choose a declared output handle.'
    }
    if (!slotFor(target, 'input', connection.targetHandle)) {
      return 'Choose a declared input handle.'
    }
  }
  const duplicate = edges.some(edge => (
    edge.id !== ignoredEdgeId
    && edge.source === connection.source
    && edge.target === connection.target
    && edge.sourceHandle === connection.sourceHandle
    && edge.targetHandle === connection.targetHandle
  ))
  return duplicate ? 'This exact connection already exists.' : null
}

export function connectionTypeWarning(
  nodes: Node[],
  connection: Pick<Connection, 'source' | 'target' | 'sourceHandle' | 'targetHandle'>,
): string | null {
  const sourceSlot = slotFor(nodes.find(node => node.id === connection.source), 'output', connection.sourceHandle)
  const targetSlot = slotFor(nodes.find(node => node.id === connection.target), 'input', connection.targetHandle)
  if (!sourceSlot || !targetSlot) return null
  if (sourceSlot.type === 'any' || targetSlot.type === 'any' || sourceSlot.type === targetSlot.type) return null
  return `Type review recommended: ${sourceSlot.type} output is connected to ${targetSlot.type} input.`
}

function getPathValue(value: unknown, path: string): { found: boolean; value: unknown } {
  const segments = path.split('.').filter(Boolean)
  let current = value
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || !(segment in current)) {
      return { found: false, value: undefined }
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return { found: true, value: current }
}

export function matchesCondition(outputs: unknown, condition: GraphOutputCondition): boolean | null {
  const selected = getPathValue(outputs, condition.output)
  if (!selected.found) return null
  if ('equals' in condition) return Object.is(selected.value, condition.equals)
  if ('notEquals' in condition) return !Object.is(selected.value, condition.notEquals)
  if ('truthy' in condition) return Boolean(selected.value) === condition.truthy
  return Boolean(selected.value)
}

export function describeCondition(condition: GraphOutputCondition | undefined): string {
  if (!condition) return ''
  if ('equals' in condition) return `${condition.output} = ${formatScalar(condition.equals)}`
  if ('notEquals' in condition) return `${condition.output} ≠ ${formatScalar(condition.notEquals)}`
  if ('truthy' in condition) return `${condition.output} is ${condition.truthy ? 'truthy' : 'falsey'}`
  return `${condition.output} is truthy`
}

export function edgeLabel(edge: Edge): string | undefined {
  const data = (edge.data || {}) as Record<string, any>
  const parts: string[] = []
  if (data.kind === 'control') parts.push('control')
  if (data.when) parts.push(describeCondition(data.when))
  if (data.loop === true) parts.push('loop')
  if (typeof data.comment === 'string' && data.comment.trim()) parts.push(data.comment.trim())
  return parts.length > 0 ? parts.join(' · ') : undefined
}

export function decorateEdge(edge: Edge): Edge {
  const data = (edge.data || {}) as Record<string, any>
  const classNames = [
    data.kind === 'control' ? 'control-edge' : 'data-edge',
    data.loop === true ? 'loop-edge' : '',
  ].filter(Boolean).join(' ')
  return {
    ...edge,
    label: edgeLabel(edge),
    animated: data.loop === true,
    class: classNames,
  }
}

export function branchResults(graph: SvelteFlowGraph, nodeOutputs: Record<string, unknown>): BranchResult[] {
  return graph.edges
    .filter(edge => Boolean((edge.data as any)?.when))
    .map(edge => {
      const condition = (edge.data as any).when as GraphOutputCondition
      return {
        edgeId: edge.id,
        label: edgeLabel(edge) || edge.id,
        selected: edge.source in nodeOutputs
          ? matchesCondition(nodeOutputs[edge.source], condition)
          : null,
      }
    })
}

export function parseScalar(value: string): string | number | boolean | null {
  const trimmed = value.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) return Number(trimmed)
  return value
}

export function formatScalar(value: unknown): string {
  return value === null ? 'null' : String(value ?? '')
}

function validateScheduler(scheduler: GraphSchedulerContract, issues: AuthoringIssue[]): void {
  if (!Number.isInteger(scheduler.maxLoopIterations)
    || scheduler.maxLoopIterations < 1
    || scheduler.maxLoopIterations > 100) {
    issues.push({ level: 'error', message: 'Maximum loop iterations must be an integer from 1 to 100.' })
  }
}

function effectivePropertyValue(node: Node, key: string, schema: PropertySchema): unknown {
  const properties = (node.data?.properties || {}) as Record<string, unknown>
  return key in properties ? properties[key] : schema.default
}

export function validateAuthoringGraph(graph: SvelteFlowGraph): AuthoringIssue[] {
  const issues: AuthoringIssue[] = []
  validateScheduler(graph.scheduler, issues)
  const nodesById = new Map(graph.nodes.map(node => [node.id, node]))

  for (const node of graph.nodes) {
    const schema = schemaFor(node)
    if (!schema) {
      issues.push({ level: 'error', nodeId: node.id, message: 'Node schema is unavailable.' })
      continue
    }
    if (schema.deprecated) {
      issues.push({ level: 'warning', nodeId: node.id, message: `${schema.name} is deprecated.` })
    }
    for (const [key, propertySchema] of Object.entries(schema.propertySchemas || {})) {
      const problem = validatePropertyValue(effectivePropertyValue(node, key, propertySchema), propertySchema)
      if (problem) {
        issues.push({
          level: 'error',
          nodeId: node.id,
          propertyKey: key,
          message: `${propertySchema.label || key}: ${problem}`,
        })
      }
    }

    const activation = node.data?.activation as Record<string, any> | undefined
    const mode = activation?.mode ?? schema.execution?.activation
    const requiredInputs = activation?.requiredInputs ?? schema.execution?.requiredInputs ?? []
    if (mode === 'required-inputs') {
      for (const input of requiredInputs) {
        const connected = graph.edges.some(edge => edge.target === node.id
          && edge.targetHandle === input
          && (edge.data as any)?.kind !== 'control')
        if (!connected) {
          issues.push({ level: 'error', nodeId: node.id, message: `Required input ${input} is not connected.` })
        }
      }
    }
    for (const condition of activation?.when || []) {
      const source = nodesById.get(condition.nodeId)
      if (!source) {
        issues.push({ level: 'error', nodeId: node.id, message: `Activation condition references missing node ${condition.nodeId}.` })
      } else if (!slotFor(source, 'output', condition.output.split('.')[0])) {
        issues.push({ level: 'error', nodeId: node.id, message: `Activation condition references undeclared output ${condition.output}.` })
      }
    }
  }

  for (const edge of graph.edges) {
    const problem = connectionProblem(graph.nodes, graph.edges, edge as Connection, edge.id)
    if (problem) issues.push({ level: 'error', edgeId: edge.id, message: problem })
    const edgeData = (edge.data || {}) as Record<string, any>
    if (edgeData.kind !== 'control') {
      const typeWarning = connectionTypeWarning(graph.nodes, edge as Connection)
      if (typeWarning) issues.push({ level: 'warning', edgeId: edge.id, message: typeWarning })
    }
    if (edgeData.when) {
      const source = nodesById.get(edge.source)
      const conditionOutput = edgeData.when.output
      const output = typeof conditionOutput === 'string' ? conditionOutput.split('.')[0] : ''
      if (source && (!output || !slotFor(source, 'output', output))) {
        issues.push({ level: 'error', edgeId: edge.id, message: `Branch condition references undeclared output ${conditionOutput || '(empty)'}.` })
      }
    }
    if (edgeData.loop === true && !edgeData.when) {
      issues.push({ level: 'error', edgeId: edge.id, message: 'A loop edge requires a branch condition.' })
    }
  }

  return issues
}

export interface SchemaHealth {
  nodes: number
  undocumentedInputs: number
  undocumentedOutputs: number
  undocumentedProperties: number
  enhancedPresentations: number
}

export function inspectSchemaHealth(nodes: Node[]): SchemaHealth {
  const result: SchemaHealth = {
    nodes: nodes.length,
    undocumentedInputs: 0,
    undocumentedOutputs: 0,
    undocumentedProperties: 0,
    enhancedPresentations: 0,
  }
  for (const node of nodes) {
    const schema = schemaFor(node)
    if (!schema) continue
    result.undocumentedInputs += schema.inputs.filter(slot => !slot.description?.trim()).length
    result.undocumentedOutputs += schema.outputs.filter(slot => !slot.description?.trim()).length
    result.undocumentedProperties += Object.values(schema.propertySchemas || {})
      .filter(property => !property.description?.trim()).length
    if (schema.presentation) result.enhancedPresentations += 1
  }
  return result
}

function nodeSize(node: Node): { width: number; height: number } {
  return {
    width: node.width || (node.measured as any)?.width || 360,
    height: node.height || (node.measured as any)?.height || 220,
  }
}

/** Deterministic dependency layout that ignores explicit loop back-edges. */
export function autoLayoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  const topLevel = nodes.filter(node => !node.parentId)
  const topIds = new Set(topLevel.map(node => node.id))
  const incoming = new Map(topLevel.map(node => [node.id, 0]))
  const outgoing = new Map(topLevel.map(node => [node.id, [] as string[]]))

  for (const edge of edges) {
    if ((edge.data as any)?.loop === true || !topIds.has(edge.source) || !topIds.has(edge.target)) continue
    outgoing.get(edge.source)?.push(edge.target)
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1)
  }

  const queue = topLevel.filter(node => incoming.get(node.id) === 0).map(node => node.id)
  const rank = new Map(queue.map(id => [id, 0]))
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const target of outgoing.get(id) || []) {
      rank.set(target, Math.max(rank.get(target) || 0, (rank.get(id) || 0) + 1))
      incoming.set(target, (incoming.get(target) || 1) - 1)
      if (incoming.get(target) === 0) queue.push(target)
    }
  }
  for (const node of topLevel) if (!rank.has(node.id)) rank.set(node.id, 0)

  const columns = new Map<number, Node[]>()
  for (const node of topLevel) {
    const value = rank.get(node.id) || 0
    columns.set(value, [...(columns.get(value) || []), node])
  }
  const positions = new Map<string, { x: number; y: number }>()
  for (const [column, columnNodes] of [...columns.entries()].sort(([a], [b]) => a - b)) {
    let y = 80
    for (const node of columnNodes.sort((a, b) => a.position.y - b.position.y || a.id.localeCompare(b.id))) {
      positions.set(node.id, { x: 80 + column * 460, y })
      y += nodeSize(node).height + 80
    }
  }

  return nodes.map(node => positions.has(node.id) ? { ...node, position: positions.get(node.id)! } : node)
}

export function schemaSearchText(schema: NodeSchema): string {
  return [
    schema.id,
    schema.name,
    schema.description,
    ...(schema.aliases || []),
    ...(schema.tags || []),
    ...schema.inputs.flatMap(slot => [slot.name, slot.label || '', slot.description || '']),
    ...schema.outputs.flatMap(slot => [slot.name, slot.label || '', slot.description || '']),
    ...Object.entries(schema.propertySchemas || {}).flatMap(([key, property]) => [
      key,
      property.label || '',
      property.description || '',
      ...(property.options || []).map(optionValue),
    ]),
  ].join(' ').toLowerCase()
}
