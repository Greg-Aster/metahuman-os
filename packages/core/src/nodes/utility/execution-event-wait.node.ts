import { defineNode } from '../types.js'
import { getOperatorMode } from '../../active-operator/mode-controller.js'

export const executionEventWaitNode = defineNode({
  id: 'execution_event_wait', name: 'Wait for Continuation', category: 'utility',
  description: 'Keeps this execution saved until a user correction or an authorized autonomy trigger arrives. Full mode can authorize an already selected next workflow immediately.',
  inputs: [
    { name: 'invocation', type: 'object', optional: true, description: 'Next workflow already chosen by the LLM' },
    { name: 'selection', type: 'object', optional: true, description: 'Finite specialist already chosen by the LLM, awaiting mode authorization before dispatch' },
  ],
  outputs: [
    { name: 'invocation', type: 'object', description: 'Authorized next workflow with the newly received context' },
    { name: 'selection', type: 'object', description: 'Authorized specialist selection, unchanged' },
  ],
  properties: { waitForEvent: false, userGraph: 'environment', autonomyGraph: 'robot-autonomy-controller' },
  propertySchemas: {
    waitForEvent: { type: 'boolean', default: false, label: 'Always Await a New Event', description: 'Used when the LLM chose to wait or request input, instead of selecting a next action.' },
    userGraph: { type: 'text', default: 'environment', label: 'User Workflow', description: 'Workflow used for a user correction.' },
    autonomyGraph: { type: 'text', default: 'robot-autonomy-controller', label: 'Autonomy Workflow', description: 'Workflow used to reconsider context after an autonomy trigger.' },
  },
  async execute(inputs, context, properties) {
    if (!context.graphExecution) throw new Error('Continuation requires a durable execution')
    const selected = { invocation: inputs.invocation ?? null, selection: inputs.selection ?? null }
    if (!properties?.waitForEvent && (selected.invocation || selected.selection) && getOperatorMode() === 'full') return selected
    for (;;) {
      const event = context.graphExecution.waitForEvent(properties?.waitForEvent ? 'user_or_autonomy' : 'operator_authorization')
      if (event.kind !== 'user_steering' && event.kind !== 'autonomy_trigger') continue
      if (event.kind === 'autonomy_trigger' && getOperatorMode() === 'reactive') continue
      const payload = event.payload as Record<string, unknown>
      if (event.kind === 'autonomy_trigger' && (selected.invocation || selected.selection)) return selected
      return { selection: null, invocation: {
        graph: event.kind === 'user_steering' ? properties?.userGraph : properties?.autonomyGraph,
        context: { ...payload, executionEvents: [event] },
      } }
    }
  },
})
