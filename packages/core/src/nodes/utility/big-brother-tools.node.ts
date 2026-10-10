import { defineNode } from '../types.js'
import { graphContextSnapshot } from '../../durable-execution/graph-contract.js'
import { loadGraphForMode } from '../../graph-streaming.js'
import { executeBigBrotherTool } from '../../terminal/client.js'
import { bigBrotherToolRequestSchema, bigBrotherToolExecutionSchema } from './big-brother-tools.schema.js'

export const bigBrotherToolRequestNode = defineNode({
  ...bigBrotherToolRequestSchema,
  async execute(inputs, context, properties) {
    const loaded = await loadGraphForMode('big-brother-tool', context.username)
    const requestedAt = new Date().toISOString()
    const effect = context.graphExecution!.dispatch({ kind: 'coordinator_work', payload: {
      type: 'big_brother_escalation', handler: 'environment.tools', resource: 'big-brother-tools',
      executionScope: 'independent', source: 'environment', username: context.username, maxAttempts: 1,
      input: { request: inputs.request, selectedContext: inputs.selectedContext,
        responseContext: inputs.responseContext ?? { currentInstruction: inputs.request }, requestedAt,
        options: { ...bigBrotherToolRequestSchema.properties, ...properties }, graph: loaded.graph,
        graphContext: graphContextSnapshot({ ...context, graphExecution: undefined }) },
    } })
    return { toolWork: { effectId: effect.effectId, state: 'submitted', requestedAt, request: inputs.request } }
  },
})

export const bigBrotherToolExecutionNode = defineNode({
  ...bigBrotherToolExecutionSchema,
  async execute(_inputs, context) {
    const work = context.environmentToolWork
    let result
    try {
      result = await executeBigBrotherTool({ prompt: work.options.prompt, model: work.options.model || undefined,
        reasoning: work.options.reasoning, username: context.username, toolTaskId: work.taskId,
        data: { request: work.request, selectedContext: work.selectedContext },
        source: { taskId: work.taskId, effectId: work.effectId, requestedAt: work.requestedAt,
          originalRequest: work.request, sessionId: context.sessionId } }, context.abortSignal)
    } catch (error) {
      context.abortSignal?.throwIfAborted()
      // A failed provider remains explicit evidence for the return workflow.
      result = { success: false, output: '', error: (error as Error).message }
    }
    context.abortSignal?.throwIfAborted()
    return { request: work.request, selectedContext: work.responseContext,
      toolWork: { taskId: work.taskId, effectId: work.effectId, request: work.request,
        requestedAt: work.requestedAt, completedAt: new Date().toISOString(),
        state: result.success ? 'completed' : 'failed', result: result.output, error: result.error } }
  },
})
