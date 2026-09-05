import { defineNode } from '../types.js'
import type { RobotOperatorDecision } from './decision-parser.node.js'
import {
  ROBOT_AUTONOMY_EXECUTOR_TASK_ID,
  ROBOT_AUTONOMY_NO_TASK_ID,
  type RobotAutonomyTaskDescriptor,
} from './autonomy-task-options.js'

const REQUIRED_FIELDS = new Set([
  'response',
  'taskId',
  'reason',
  'observationSummary',
  'instruction',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : ''
}

function parseJson(value: unknown): unknown {
  const raw = typeof value === 'string'
    ? value
    : isRecord(value) && typeof value.content === 'string'
      ? value.content
      : ''
  try {
    return JSON.parse(raw.trim())
  } catch {
    return null
  }
}

function availableTasks(value: unknown): RobotAutonomyTaskDescriptor[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is RobotAutonomyTaskDescriptor => (
    isRecord(entry)
    && typeof entry.id === 'string'
    && typeof entry.name === 'string'
    && typeof entry.description === 'string'
    && (entry.kind === 'agent' || entry.kind === 'environment-executor')
    && typeof entry.handler === 'string'
    && typeof entry.taskType === 'string'
    && (entry.priority === 'low' || entry.priority === 'normal' || entry.priority === 'high')
    && Array.isArray(entry.tags)
  ))
}

export function buildRobotAutonomyControllerJsonSchema(tasks: unknown) {
  const taskIds = availableTasks(tasks).map(task => task.id)
  return {
    type: 'object',
    additionalProperties: false,
    required: [...REQUIRED_FIELDS],
    properties: {
      response: { type: 'string', maxLength: 500 },
      taskId: { type: 'string', enum: [...taskIds, ROBOT_AUTONOMY_NO_TASK_ID] },
      reason: { type: 'string', minLength: 1, maxLength: 500 },
      observationSummary: { type: 'string', minLength: 1, maxLength: 500 },
      instruction: { type: 'string', maxLength: 1_000 },
    },
  } as const
}

export const robotAutonomyControllerParserNode = defineNode({
  id: 'robot_autonomy_controller_parser',
  name: 'Validate Autonomy Decision',
  category: 'operator',
  inputs: [
    { name: 'response', type: 'any', description: 'Strict JSON from the Robot Autonomy Controller LLM' },
    { name: 'availableTasks', type: 'array', description: 'Exact task catalog supplied to the controller LLM' },
  ],
  outputs: [
    { name: 'taskDecision', type: 'object', description: 'Catalog-backed finite agent selection, or null when no agent task was selected' },
    { name: 'executorDecision', type: 'object', description: 'High-level embodied intention only when Robot Autonomy Executor was selected' },
    { name: 'response', type: 'string', description: 'Optional concise conversation authored by the LLM' },
  ],
  properties: {},
  propertySchemas: {},
  description: 'Validates one LLM-owned Full-mode decision against the exact task catalog it received. It does not select or execute work.',
  async execute(inputs) {
    const parsed = parseJson(inputs.response)
    const tasks = availableTasks(inputs.availableTasks)
    const invalid = (error: string): never => { throw new Error(error) }
    if (!isRecord(parsed)) return invalid('Robot autonomy controller result was not a JSON object.')
    if (Object.keys(parsed).length !== REQUIRED_FIELDS.size || Object.keys(parsed).some(field => !REQUIRED_FIELDS.has(field))) {
      return invalid('Robot autonomy controller result contains unexpected or missing fields.')
    }

    const taskId = cleanText(parsed.taskId, 100)
    const reason = cleanText(parsed.reason, 500)
    const observationSummary = cleanText(parsed.observationSummary, 500)
    const instruction = cleanText(parsed.instruction, 1_000)
    const response = cleanText(parsed.response, 500)
    const task = tasks.find(candidate => candidate.id === taskId) ?? null
    if (taskId !== ROBOT_AUTONOMY_NO_TASK_ID && !task) {
      return invalid('Robot autonomy controller selected a task outside its available catalog.')
    }
    if (!reason || !observationSummary) {
      return invalid('Robot autonomy controller requires a reason and observation summary.')
    }
    if (taskId === ROBOT_AUTONOMY_NO_TASK_ID && !response) {
      return invalid('Robot autonomy controller must select a task or author a response.')
    }
    if (taskId === ROBOT_AUTONOMY_EXECUTOR_TASK_ID && !instruction) {
      return invalid('Robot Autonomy Executor selection requires one high-level instruction.')
    }

    const executorDecision: RobotOperatorDecision | null = taskId === ROBOT_AUTONOMY_EXECUTOR_TASK_ID
      ? { observed: observationSummary, instruction, reason }
      : null
    const taskDecision = task?.kind === 'agent'
      ? { task, reason, observationSummary }
      : null
    return { taskDecision, executorDecision, response }
  },
})
