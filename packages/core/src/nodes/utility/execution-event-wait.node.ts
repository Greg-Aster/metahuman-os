import { defineNode } from '../types.js'
import { getOperatorMode } from '../../active-operator/mode-controller.js'

export const executionEventWaitNode = defineNode({
  id: 'execution_event_wait', name: 'Wait for Continuation', category: 'utility',
  execution: { eventInput: true },
  description: 'Receives user or autonomy events for an execution awaiting new input.',
  inputs: [
    { name: 'receivedInput', type: 'object', optional: true, description: 'Input received during preceding work, delivered once before checking newer events' },
    { name: 'workResult', type: 'object', optional: true, description: 'Completed task evidence for the next decision in this execution' },
    { name: 'instructionEntry', type: 'message', optional: true, description: 'Original admitted instruction retained across an internal result handoff' },
    { name: 'evidence', type: 'object', optional: true, description: 'Returned result context for input received after that result' },
  ],
  outputs: [
    { name: 'invocation', type: 'object', description: 'Next workflow with the newly received context' },
  ],
  properties: { drain: false, userGraph: 'environment', autonomyGraph: 'robot-autonomy-controller', resultGraph: 'environment' },
  propertySchemas: {
    drain: { type: 'boolean', default: false, label: 'Receive Available Input Only', description: 'Handles already received input and returns immediately when none remains. A graph may select this node as its late-input entry point.' },
    userGraph: { type: 'text', default: 'environment', label: 'User Workflow', description: 'Workflow used for a user correction.' },
    resultGraph: { type: 'text', default: 'environment', label: 'Task Result Workflow', description: 'Existing task workflow receiving acquisition evidence for its next decision.' },
    autonomyGraph: { type: 'text', default: 'robot-autonomy-controller', label: 'Autonomy Workflow', description: 'Workflow used to reconsider context after an autonomy trigger.' },
  },
  async execute(inputs, context, properties) {
    if (!context.graphExecution) throw new Error('Continuation requires a durable execution')
    // A body event is a finite invocation. Its unresolved objective remains in
    // the execution record; waiting for a future event is not unfinished work
    // in this invocation. Genuine admitted user input retains its own lifecycle.
    // Body Event supplies its intention separately and clears these user fields.
    const hasUserInput = Boolean(context.userMessage)
      || (inputs.instructionEntry ?? context.userMessageEntry)?.role === 'user'
    const finiteBodyEvent = Boolean(context.bodyEventDecision) && !hasUserInput
    if (properties?.drain || finiteBodyEvent) {
      // Supplied input belongs to this graph pass. Later event-tail occurrences
      // consume only newly admitted events, never the earlier input again.
      const supplied = context._graphExecutorIteration === 1 ? inputs.receivedInput : null
      const workResult = context._graphExecutorIteration === 1 ? inputs.workResult : null
      let kind = supplied ? 'user_steering' : ''
      let payload = supplied ?? {}
      const events = [...(supplied?.executionEvents ?? inputs.evidence?.executionEvents ?? [])]
      while (!supplied?.environmentInterpretation && context.graphExecution.pendingEvents().length) {
        const event = context.graphExecution.waitForEvent('pending_input')
        events.push(event)
        if (event.kind !== 'user_steering' && event.kind !== 'autonomy_trigger') continue
        if (event.kind === 'autonomy_trigger' && getOperatorMode() === 'reactive') continue
        kind = event.kind
        const received = event.payload as Record<string, unknown>
        payload = { ...inputs.evidence, ...workResult,
          // Later input replaces turn metadata, not the settled continuation
          // returned by the active task immediately before this drain.
          ...(supplied?.activeTaskContinuation ? { activeTaskContinuation: supplied.activeTaskContinuation } : {}),
          ...received,
          environmentObservationCurrent: received.environmentObservation ? received.environmentObservationCurrent : false }
      }
      if (!kind && workResult) return { invocation: {
        graph: properties?.resultGraph ?? 'environment',
        context: { ...workResult, executionEvents: events,
          userMessageEntry: inputs.instructionEntry ?? context.userMessageEntry,
          environmentInterpretation: undefined, pendingInstructionTurns: undefined },
      } }
      return { invocation: kind ? {
        graph: kind === 'user_steering' ? properties?.userGraph : properties?.autonomyGraph,
        context: { ...payload, executionEvents: events },
      } : null }
    }
    for (;;) {
      const event = context.graphExecution.waitForEvent('user_or_autonomy')
      if (event.kind !== 'user_steering' && event.kind !== 'autonomy_trigger') continue
      if (event.kind === 'autonomy_trigger' && getOperatorMode() === 'reactive') continue
      const payload = event.payload as Record<string, unknown>
      return { invocation: {
        graph: event.kind === 'user_steering' ? properties?.userGraph : properties?.autonomyGraph,
        context: { ...payload, executionEvents: [event] },
      } }
    }
  },
})
