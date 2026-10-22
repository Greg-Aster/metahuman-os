import { defineNode } from '../types.js'
import { isDeepStrictEqual } from 'node:util'
import type { ExecutionEvent } from '../../durable-execution/types.js'
import { projectSelectorState } from '../environment/helpers.js'

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

// Execution text carries camera references. Pixel bytes remain in durable
// receipts/frames and reach models only through the selected image-input path.
function executionPayloadContext(value: any): any {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(executionPayloadContext)
  const isFrame = typeof value.id === 'string' && typeof value.timestamp === 'string'
    && ('dataUrl' in value || typeof value.mimeType === 'string' && value.mimeType.startsWith('image/'))
  return Object.fromEntries(Object.entries(value)
    .filter(([key, child]) => !isFrame || key !== 'dataUrl'
      && !(key === 'url' && typeof child === 'string' && child.startsWith('data:image/')))
    .map(([key, child]) => [key, executionPayloadContext(child)]))
}

export function executionEventContext(events: ExecutionEvent[]) {
  let previousObservation: unknown
  return events.map(event => {
    let payload = executionPayloadContext(event.payload) as Record<string, any>
    event = { ...event, payload }
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
    const current = { ...observation, state: projectSelectorState(observation.state) }
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
  inputs: [
    { name: 'routingAnalysis', type: 'object', optional: true, description: 'Intent routing decision for this workflow pass' },
    { name: 'responseEntry', type: 'message', optional: true, description: 'Delivered response from this workflow pass' },
    { name: 'instructionEntry', type: 'message', optional: true, description: 'Original admitted input for continuation' },
    { name: 'resultContext', type: 'object', optional: true, description: 'Returned task observation context' },
    { name: 'taskResult', type: 'object', optional: true, description: 'Current program result, including an unfinished input or planning handoff' },
  ],
  outputs: [
    { name: 'reviewContext', type: 'object', description: 'Returned evidence and input provenance for the existing review workflow' },
    { name: 'context', type: 'object', description: 'Execution identity, task and recent event facts' },
    { name: 'task', type: 'object', description: 'Checkpointed task, or null for an execution without a task' },
    { name: 'activeExecutions', type: 'array', description: 'Other unfinished executions available for user steering' },
    { name: 'needsGoalReview', type: 'boolean', description: 'An unfinished non-Agency objective eligible for assessment by Robot Goal Review' },
    { name: 'awaitContext', type: 'boolean', description: 'The objective is awaiting new input, not another immediate review' },
    { name: 'hasActiveTask', type: 'boolean', description: 'Whether the saved LLM decision leaves an objective unfinished' },
  ],
  properties: {},
  propertySchemas: {},
  async execute(inputs, context) {
    if (!context.graphExecution) throw new Error('Current Execution requires the durable graph runtime')
    const task = context.graphExecution.task()
    const events = context.graphExecution.events()
    const hasActiveTask = Boolean(task && !task.decision.objectiveComplete && !['abandon', 'cancel', 'complete', 'failed'].includes(task.decision.outcome))
    const awaitingInput = (
      ['wait', 'request_user'].includes(task?.decision.outcome ?? '')
      || task?.decision.continuationPolicy === 'none' && task.decision.requiredCompletionBasis === 'user_input'
    )
    const hasReviewableGoal = hasActiveTask && !task?.desireId
    const needsGoalReview = hasReviewableGoal && !awaitingInput && (!inputs.taskResult || inputs.taskResult.done === true)
    const responseEntry = inputs.responseEntry ?? context.environmentResponseEntry
    const routingAnalysis = inputs.routingAnalysis ?? context.environmentRoutingAnalysis
    return {
      reviewContext: { ...inputs.resultContext,
        environmentRoutingAnalysis: routingAnalysis,
        userMessageEntry: inputs.instructionEntry ?? context.userMessageEntry,
        environmentResponseEntry: responseEntry },
      activeExecutions: context.graphExecution.activeExecutions(),
      context: { executionId: context.graphExecution.executionId, task,
        ...(routingAnalysis ? { routingAnalysis } : {}),
        ...(responseEntry ? { responseEntry } : {}),
        latestEventSequence: events.at(-1)?.sequence ?? 0,
        observationEncoding: 'First observation is complete; later observationChanges replace or remove the named path relative to the previous observation. Image references retain their recorded time.',
        events: executionEventContext(events) },
      task,
      hasActiveTask,
      awaitContext: hasReviewableGoal && awaitingInput,
      needsGoalReview,
    }
  },
})
