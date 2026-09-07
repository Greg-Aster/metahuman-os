import { defineNode } from '../types.js'
import { getOperatorMode } from '../../active-operator/mode-controller.js'

export const executionEventWaitNode = defineNode({
  id: 'execution_event_wait', name: 'Wait for Continuation', category: 'utility',
  description: 'Keeps this execution saved until a user correction or an authorized autonomy trigger arrives. Full mode can authorize an already selected next workflow immediately.',
  inputs: [{ name: 'invocation', type: 'object', optional: true, description: 'Next workflow already chosen by the LLM' }],
  outputs: [{ name: 'invocation', type: 'object', description: 'Authorized next workflow with the newly received context' }],
  properties: { waitForEvent: false, userGraph: 'environment', autonomyGraph: 'robot-autonomy-controller' },
  propertySchemas: {
    waitForEvent: { type: 'boolean', default: false, label: 'Always Await a New Event', description: 'Used when the LLM chose to wait or request input, instead of selecting a next action.' },
    userGraph: { type: 'text', default: 'environment', label: 'User Workflow', description: 'Workflow used for a user correction.' },
    autonomyGraph: { type: 'text', default: 'robot-autonomy-controller', label: 'Autonomy Workflow', description: 'Workflow used to reconsider context after an autonomy trigger.' },
  },
  async execute(inputs, context, properties) {
    if (!context.graphExecution) throw new Error('Continuation requires a durable execution')
    if (!properties?.waitForEvent && inputs.invocation && getOperatorMode() === 'full') return { invocation: inputs.invocation }
    for (;;) {
      const event = context.graphExecution.waitForEvent(properties?.waitForEvent ? 'user_or_autonomy' : 'operator_authorization')
      if (event.kind !== 'user_steering' && event.kind !== 'autonomy_trigger') continue
      if (event.kind === 'autonomy_trigger' && getOperatorMode() === 'reactive') continue
      const payload = event.payload as Record<string, unknown>
      return { invocation: event.kind === 'autonomy_trigger' && inputs.invocation
        ? inputs.invocation
        : { graph: event.kind === 'user_steering' ? properties?.userGraph : properties?.autonomyGraph,
          context: { ...payload, executionEvents: [event] } } }
    }
  },
})
