import { defineNode } from '../types.js'
import { isDeepStrictEqual } from 'node:util'
import type { ExecutionEvent } from '../../durable-execution/types.js'

// Lossless changes avoid repeating an entire capability/body envelope after
// every action. This is a model-context representation, not another event store.
function observationChanges(before: any, after: any, path: string[] = []): Array<Record<string, unknown>> {
  if (isDeepStrictEqual(before, after)) return []
  if (before && after && typeof before === 'object' && typeof after === 'object'
    && !Array.isArray(before) && !Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => (
      key in after ? observationChanges(before[key], after[key], [...path, key])
        : [{ path: [...path, key], removed: true }]
    ))
  }
  return [{ path, value: after }]
}

export function executionEventContext(events: ExecutionEvent[]) {
  let previousObservation: unknown
  return events.map(event => {
    let payload = event.payload as Record<string, any>
    if (event.kind === 'work_result' && payload?.result?.graphResults?.length) {
      // Worker stdout remains in the work receipt. Actual graph returns, not
      // terminal logging, are the specialist's semantic result.
      const processResult = payload.result.result
      payload = { ...payload, result: { ...payload.result, result:
        processResult && typeof processResult === 'object'
          ? Object.fromEntries(Object.entries(processResult).filter(([key]) => key !== 'stdout' && key !== 'stderr'))
          : processResult } }
      event = { ...event, payload }
    }
    const observation = payload?.environmentObservation
    if (!observation) return event
    const frame = (value: any) => value ? { id: value.id, timestamp: value.timestamp, metadata: value.metadata } : value
    const current = { ...observation, visual: frame(observation.visual), visuals: observation.visuals?.map(frame) }
    const projected = previousObservation
      ? { ...payload, environmentObservation: undefined, observationChanges: observationChanges(previousObservation, current) }
      : { ...payload, environmentObservation: current }
    previousObservation = current
    return { ...event, payload: projected }
  })
}

export const executionContextNode = defineNode({
  id: 'execution_context', name: 'Current Execution', category: 'context',
  description: 'Reads this execution’s checkpointed objective and ordered events. Robot Status and conversation history do not own or replace this task.',
  inputs: [],
  outputs: [
    { name: 'context', type: 'object', description: 'Execution identity, task and recent event facts' },
    { name: 'task', type: 'object', description: 'Checkpointed task, or null for an execution without a task' },
    { name: 'activeExecutions', type: 'array', description: 'Other unfinished executions available for user steering' },
    { name: 'needsGoalReview', type: 'boolean', description: 'An unfinished objective whose continuation is owned by Robot Goal Review rather than Agency' },
    { name: 'hasActiveTask', type: 'boolean', description: 'Whether the saved LLM decision leaves an objective unfinished' },
  ],
  properties: { eventLimit: 16 },
  propertySchemas: { eventLimit: { type: 'number', default: 16, label: 'Recent Events', description: 'Events included in model context; the complete execution evidence remains saved.' } },
  async execute(_inputs, context, properties) {
    if (!context.graphExecution) throw new Error('Current Execution requires the durable graph runtime')
    const task = context.graphExecution.task()
    const events = context.graphExecution.events()
    const limit = Number(properties?.eventLimit)
    if (!Number.isInteger(limit) || limit < 0) throw new Error('Recent Events must be a non-negative integer')
    const hasActiveTask = Boolean(task && !task.decision.objectiveComplete && !['abandon', 'cancel', 'complete'].includes(task.decision.outcome))
    return {
      activeExecutions: context.graphExecution.activeExecutions(),
      context: { executionId: context.graphExecution.executionId, task,
        latestEventSequence: events.at(-1)?.sequence ?? 0,
        observationEncoding: 'First observation is complete; later observationChanges replace or remove the named path relative to the previous observation. Image references retain their recorded time.',
        events: executionEventContext(limit ? events.slice(-limit) : events) },
      task,
      hasActiveTask,
      needsGoalReview: hasActiveTask && !task?.desireId,
    }
  },
})
