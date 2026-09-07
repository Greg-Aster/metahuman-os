import { defineNode } from '../types.js'

export const executionEventOutNode = defineNode({
  id: 'execution_event_out', name: 'Send Input to Existing Execution', category: 'output',
  description: 'Appends the unchanged input to the execution selected by the intent LLM. It neither interprets the message nor creates an objective.',
  inputs: [
    { name: 'selection', type: 'object', description: 'Existing execution and event kind selected by the LLM' },
    { name: 'message', type: 'string', description: 'Original user input' },
  ],
  outputs: [{ name: 'sent', type: 'boolean', description: 'Input handoff committed with this node output' }],
  properties: {},
  async execute(inputs, context) {
    if (!context.graphExecution) throw new Error('Execution input handoff requires durable execution')
    const selected = inputs.selection
    if (!selected?.executionId || !['user_steering', 'user_cancelled'].includes(selected.kind)) throw new Error('Invalid execution input selection')
    context.graphExecution.dispatch({ kind: 'execution_event', payload: {
      executionId: selected.executionId, kind: selected.kind,
      context: { userMessage: inputs.message, ...(context.environmentObservation ? { environmentObservation: context.environmentObservation, environmentObservationCurrent: context.environmentObservationCurrent } : {}) },
    } })
    return { sent: true }
  },
})
