import { saveVisualObservationSchema } from './observation.schemas.js'
import { defineNode } from '../types.js'
import type { EnvironmentObservation, EnvironmentVisualFrame } from '../../environment-interface/types.js'
import { visualObservationSource, type VisualObservationRecord } from '../../visual-observation.js'
import { visualObservationOutput } from './visual-observation-output.js'

export const saveVisualObservationNode = defineNode({
  ...saveVisualObservationSchema,
  async execute(inputs, context) {
    if (!context.graphExecution) throw new Error('Save Visual Observation requires checkpointed execution')
    const frames = (inputs.frames ?? []) as EnvironmentVisualFrame[]
    const visual = visualObservationOutput(inputs.visualObservation, frames)
    if (!visual) return { observation: null, saved: false }
    const source = inputs.observation as EnvironmentObservation | undefined
    if (!source?.environmentId || !source.adapter) throw new Error('Visual observation requires Environment Bridge identity')
    const selected = visual.frameIds.map(id => frames.find(frame => frame.id === id)!)
    const { executionId, occurrenceId } = context.graphExecution
    const observation: VisualObservationRecord = {
      ...visual, observationId: `${occurrenceId}:visual-observation`, executionId, occurrenceId,
      ...visualObservationSource(source), interpretedAt: new Date().toISOString(),
      frames: selected.map(frame => ({ id: frame.id, timestamp: frame.timestamp,
        ...(typeof frame.metadata?.actionId === 'string' ? { actionId: frame.metadata.actionId } : {}) })),
    }
    context.graphExecution.recordFrames(selected)
    context.graphExecution.recordObservation(observation)
    return { observation, saved: true }
  },
})
