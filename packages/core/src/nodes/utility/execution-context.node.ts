import { defineNode } from '../types.js'

export const executionContextNode = defineNode({
  id: 'execution_context', name: 'Current Execution', category: 'context',
  description: 'Reads this execution’s checkpointed objective and ordered events. Robot Status and conversation history do not own or replace this task.',
  inputs: [],
  outputs: [
    { name: 'context', type: 'object', description: 'Execution identity, task and recent event facts' },
    { name: 'task', type: 'object', description: 'Checkpointed task, or null for an execution without a task' },
    { name: 'activeExecutions', type: 'array', description: 'Other unfinished executions available for user steering' },
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
    return {
      activeExecutions: context.graphExecution.activeExecutions(),
      context: { executionId: context.graphExecution.executionId, task,
        events: (limit ? events.slice(-limit) : events).map((event: import('../../durable-execution/types.js').ExecutionEvent) => {
          const payload = event.payload as Record<string, any>
          const observation = payload?.environmentObservation
          return { ...event, payload: observation ? { ...payload, environmentObservation: {
            ...observation, visual: undefined, visuals: undefined,
          } } : payload }
        }) },
      task,
      hasActiveTask: Boolean(task && !task.decision.objectiveComplete && !['abandon', 'cancel', 'complete'].includes(task.decision.outcome)),
    }
  },
})
