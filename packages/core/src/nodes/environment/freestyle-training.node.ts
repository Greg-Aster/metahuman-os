import { recordFreestyleTrainingOutput } from '../../environment-training-bank.js'
import { defineNode } from '../types.js'
import { freestyleRequestInputSchema, freestyleTrainingOutputSchema } from './freestyle-training.schemas.js'

export const freestyleRequestInputNode = defineNode({
  ...freestyleRequestInputSchema,
  async execute(_inputs, context) {
    const work = context.environmentMotionRequest
    if (!work || typeof work !== 'object') throw new Error('Freestyle graph requires its Coordinator work input')
    return {
      movementRequest: work.movementRequest,
      instruction: work.instruction,
      observation: work.observation,
      sessionId: work.sessionId,
    }
  },
})

export const freestyleTrainingOutputNode = defineNode({
  ...freestyleTrainingOutputSchema,
  async execute(inputs, context) {
    if (!Array.isArray(inputs.modelMessages) || inputs.modelMessages.length === 0) {
      return { saved: false, candidateId: '', error: '' }
    }
    try {
      const identity = context.environmentMotionTrainingIdentity
      if (!context.username || !identity?.executionId || !identity?.effectId) {
        throw new Error('Freestyle saving requires its durable Coordinator identity')
      }
      const candidate = recordFreestyleTrainingOutput({
        username: context.username, executionId: identity.executionId, effectId: identity.effectId,
        messages: inputs.modelMessages, observedOutput: String(inputs.rawOutput ?? ''),
        valid: inputs.valid === true, generationError: String(inputs.error ?? ''),
        generatedAction: inputs.action ?? null,
      })
      return { saved: true, candidateId: candidate.id, error: '' }
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause)
      console.error(`[environment-freestyle-training-output] ${error}`)
      return { saved: false, candidateId: '', error }
    }
  },
})
