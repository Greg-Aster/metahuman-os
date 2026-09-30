import { observationHistorySchema } from './observation.schemas.js'
import { defineNode } from '../types.js'
import { visualObservationSource } from '../../visual-observation.js'
import type { EnvironmentObservation } from '../../environment-interface/types.js'

export const observationHistoryNode = defineNode({
  ...observationHistorySchema,
  async execute(inputs, context, properties) {
    if (!context.graphExecution) throw new Error('Observation History requires checkpointed execution')
    const observation = inputs.observation as EnvironmentObservation | undefined
    if (!observation) return { observations: [], count: 0 }
    const observations = context.graphExecution.observationHistory({
      ...visualObservationSource(observation), limit: properties?.limit ?? observationHistorySchema.properties.limit,
    })
    return { observations, count: observations.length }
  },
})
