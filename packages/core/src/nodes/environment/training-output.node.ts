import { openExecutionStore } from '../../durable-execution/storage.js'
import { recordEnvironmentTrainingOutput, type EnvironmentTrainingSpecialist } from '../../environment-training-bank.js'
import { defineNode } from '../types.js'
import { environmentTrainingOutputSchema } from './training-output.schema.js'

export const environmentTrainingOutputNode = defineNode({
  ...environmentTrainingOutputSchema,
  async execute(inputs, context, properties) {
    if (typeof inputs.precomputedResponse === 'string' && inputs.precomputedResponse.trim()) {
      return { saved: false, candidateId: '', error: '' }
    }
    try {
      const username = typeof context.username === 'string' ? context.username.trim() : ''
      const execution = context.graphExecution
      const specialist = properties?.specialist as EnvironmentTrainingSpecialist
      if (!username || !execution?.executionId || !execution?.occurrenceId
        || !['intent', 'task'].includes(specialist)) throw new Error('Environment decision saving needs a durable profile execution and training bank')
      const store = openExecutionStore(username)
      let graphHash: string
      try { graphHash = store.get(execution.executionId).definition.graphHash }
      finally { store.close() }
      const candidate = recordEnvironmentTrainingOutput({
        username, executionId: execution.executionId, occurrenceId: execution.occurrenceId,
        nodeId: String(properties?.sourceNodeId || ''), graphHash, specialist,
        messages: inputs.messages, observedOutput: String(inputs.response ?? ''),
      })
      return { saved: true, candidateId: candidate.id, error: '' }
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause)
      console.error(`[environment-training-output] ${error}`)
      return { saved: false, candidateId: '', error }
    }
  },
})
