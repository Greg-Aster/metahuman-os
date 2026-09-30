import { defineNode } from '../types.js'
import { getOperatorMode } from '../../active-operator/mode-controller.js'

export const executionEventWaitNode = defineNode({
  id: 'execution_event_wait', name: 'Wait for Continuation', category: 'utility',
  execution: { eventInput: true },
  description: 'Keeps this execution saved until a user correction or an authorized autonomy trigger arrives. Full mode can authorize an already selected next workflow immediately.',
  inputs: [
    { name: 'invocation', type: 'object', optional: true, description: 'Next workflow already chosen by the LLM' },
    { name: 'selection', type: 'object', optional: true, description: 'Finite specialist already chosen by the LLM, awaiting mode authorization before dispatch' },
    { name: 'receivedInput', type: 'object', optional: true, description: 'Input received during preceding work, delivered once before checking newer events' },
    { name: 'evidence', type: 'object', optional: true, description: 'Returned result context for input received after that result' },
  ],
  outputs: [
    { name: 'invocation', type: 'object', description: 'Authorized next workflow with the newly received context' },
    { name: 'selection', type: 'object', description: 'Authorized specialist selection, unchanged' },
  ],
  properties: { waitForEvent: false, drain: false, userGraph: 'environment', autonomyGraph: 'robot-autonomy-controller' },
  propertySchemas: {
    drain: { type: 'boolean', default: false, label: 'Receive Available Input Only', description: 'Handles already received input and returns immediately when none remains. A graph may select this node as its late-input entry point.' },
    waitForEvent: { type: 'boolean', default: false, label: 'Always Await a New Event', description: 'Used when the LLM chose to wait or request input, instead of selecting a next action.' },
    userGraph: { type: 'text', default: 'environment', label: 'User Workflow', description: 'Workflow used for a user correction.' },
    autonomyGraph: { type: 'text', default: 'robot-autonomy-controller', label: 'Autonomy Workflow', description: 'Workflow used to reconsider context after an autonomy trigger.' },
  },
  async execute(inputs, context, properties) {
    if (!context.graphExecution) throw new Error('Continuation requires a durable execution')
    if (properties?.drain) {
      // Supplied input belongs to this graph pass. Later event-tail occurrences
      // consume only newly admitted events, never the earlier input again.
      const supplied = context._graphExecutorIteration === 1 ? inputs.receivedInput : null
      let kind = supplied ? 'user_steering' : ''
      let payload = supplied ?? {}
      const events = [...(supplied?.executionEvents ?? inputs.evidence?.executionEvents ?? [])]
      while (context.graphExecution.pendingEvents().length) {
        const event = context.graphExecution.waitForEvent('pending_input')
        events.push(event)
        if (event.kind !== 'user_steering' && event.kind !== 'autonomy_trigger') continue
        if (event.kind === 'autonomy_trigger' && getOperatorMode() === 'reactive') continue
        kind = event.kind
        const received = event.payload as Record<string, unknown>
        payload = { ...inputs.evidence, ...received,
          environmentObservationCurrent: received.environmentObservation ? received.environmentObservationCurrent : false }
      }
      return { selection: null, invocation: kind ? {
        graph: kind === 'user_steering' ? properties.userGraph : properties.autonomyGraph,
        context: { ...payload, executionEvents: events },
      } : null }
    }
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
