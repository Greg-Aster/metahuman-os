import { defineNode, NodeInputValidationError } from '../types.js'
import { selectActivatedOperations, type ActivationAssessment, type ActivationUpdate } from '../../active-operator/activation.js'
import type { AutonomyMode } from '../../queue/types.js'

export function buildRobotAutonomyControllerJsonSchema(tasks: Array<{ id: string }>) {
  return {
    type: 'object', additionalProperties: false, required: ['updates'],
    properties: { updates: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      required: ['operationId', 'activation', 'reason', 'instruction'],
      properties: {
        operationId: { type: 'string', enum: tasks.map(task => task.id) },
        activation: { type: 'number', minimum: 0, maximum: 100 },
        reason: { type: 'string' }, instruction: { type: 'string' },
      },
    } } },
  }
}

export function parseRobotAutonomyChoice(value: unknown, operations: Array<{ id: string }>): ActivationUpdate[] {
  const raw = typeof value === 'string' ? value : (value as { content?: string })?.content
  let parsed: any
  try { parsed = JSON.parse(raw ?? '') } catch { throw new NodeInputValidationError('response', 'Activation assessment is not JSON') }
  if (!parsed || Object.keys(parsed).length !== 1 || !Array.isArray(parsed.updates)) {
    throw new NodeInputValidationError('response', 'Activation assessment requires updates')
  }
  return parsed.updates.map((update: any) => {
    if (!update || Object.keys(update).sort().join(',') !== 'activation,instruction,operationId,reason'
      || !operations.some(operation => operation.id === update.operationId)
      || typeof update.activation !== 'number' || !Number.isFinite(update.activation)
      || update.activation < 0 || update.activation > 100
      || typeof update.reason !== 'string' || typeof update.instruction !== 'string') {
      throw new NodeInputValidationError('response', 'Activation update does not match the supplied operation contract')
    }
    return update as ActivationUpdate
  })
}

export const robotAutonomyControllerParserNode = defineNode({
  id: 'robot_autonomy_controller_parser', name: 'Read Activation Assessment', category: 'operator',
  inputs: [
    { name: 'response', type: 'any' },
    { name: 'availableTasks', type: 'array' },
    { name: 'activationState', type: 'object' },
  ],
  outputs: [
    { name: 'assessment', type: 'object' },
  ],
  properties: {}, propertySchemas: {},
  description: 'Records model-selected activation levels and applies the configured Semi or Full selection rule.',
  async execute(inputs, context) {
    const updates = parseRobotAutonomyChoice(inputs.response, inputs.availableTasks)
    const state = inputs.activationState as { mode: AutonomyMode; previous: ActivationAssessment | null; assessedAt: string }
    const assessedAt = new Date().toISOString()
    const levels = { ...state.previous?.levels }
    for (const update of updates) levels[update.operationId] = { ...update, assessedAt }
    const assessment: ActivationAssessment = {
      executionId: context.graphExecution!.executionId, assessedAt,
      mode: state.mode, updates, levels, selected: selectActivatedOperations(updates, state.mode),
    }
    return { assessment }
  },
})
