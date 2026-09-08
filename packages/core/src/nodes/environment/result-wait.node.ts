import { defineNode } from '../types.js'
import { getEnvironmentActionContext, type EnvironmentObservation } from '../../environment-interface/index.js'

export const environmentResultWaitNode = defineNode({
  id: 'environment_result_wait', name: 'Wait for Robot Results', category: 'environment',
  description: 'Waits for the identified robot actions to finish. It does not send commands or judge whether an objective succeeded.',
  inputs: [{ name: 'commands', type: 'array', description: 'Checkpointed commands from Environment Bridge Out' }],
  outputs: [
    { name: 'context', type: 'object', description: 'Correlated results and observations for the next workflow' },
    { name: 'events', type: 'array', description: 'Ordered events received while waiting' },
    { name: 'observation', type: 'object', description: 'Bridge observation correlated to the returned action' },
    { name: 'actionContext', type: 'object', description: 'Verified Coordinator action record' },
  ],
  properties: {},
  async execute(inputs, context) {
    if (!context.graphExecution) throw new Error('Robot result waiting requires durable execution')
    const pending = new Set((inputs.commands as any[]).map(command => command.id))
    const reports = new Map<string, Record<string, any>>()
    const observations = new Set<string>()
    if (!pending.size || pending.has(undefined)) throw new Error('Robot result waiting requires identified commands')
    const events = []
    let resultContext: Record<string, unknown> = {}
    while (pending.size) {
      const event = context.graphExecution.waitForEvent('robot_result')
      events.push(event)
      const payload = event.payload as Record<string, any>
      if (event.kind === 'user_steering') resultContext = { ...resultContext, ...payload }
      if (event.kind === 'physical_result' && event.actionId && pending.has(event.actionId)) {
        // Uncertainty is evidence for review, never evidence of completion.
        // The Coordinator retains the body reservation until reconciliation.
        reports.set(event.actionId, payload.feedback)
        resultContext = { ...resultContext, ...payload }
      }
      if (event.kind === 'observation_received' && event.actionId && pending.has(event.actionId)) {
        observations.add(event.actionId)
        resultContext = { ...resultContext, ...payload }
      }
      for (const id of pending) if (reports.has(id) && (observations.has(id)
        || ['failed', 'rejected', 'expired', 'cancelled'].includes(reports.get(id)!.type))) pending.delete(id)
    }
    const supplied = resultContext.environmentObservation as EnvironmentObservation | undefined
    const base = supplied ?? context.environmentObservation
    if (base) resultContext.environmentObservation = { ...base,
      feedback: [...reports.values()], metadata: { ...base.metadata, actionId: [...reports.keys()].at(-1) } }
    if (!supplied) resultContext.environmentObservationCurrent = false
    if (resultContext.environmentObservation) resultContext.environmentActionContext = getEnvironmentActionContext(resultContext.environmentObservation as EnvironmentObservation)
    return { context: { ...resultContext, executionEvents: events }, events,
      observation: resultContext.environmentObservation, actionContext: resultContext.environmentActionContext }
  },
})
