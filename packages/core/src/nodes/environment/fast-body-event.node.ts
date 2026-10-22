import { defineNode, NodeInputValidationError } from '../types.js'
import { fastBodyEventContextSchema, fastBodyEventResponseSchema } from './fast-body-event.schemas.js'

export const fastBodyEventContextNode = defineNode({
  ...fastBodyEventContextSchema,
  async execute(_inputs, context, properties) {
    const observation = context.environmentObservation
    const event = observation?.state?.bodyEvent
    if (!event) throw new Error('Fast Body Event Context requires an attributed body event')
    const kind = event.data?.kind
    const prompts: Record<string, unknown> = {
      tipped: properties?.tippedPrompt,
      rapid_movement: properties?.rapidMovementPrompt,
      servo_stall: properties?.motorStallPrompt,
    }
    const systemPrompt = prompts[kind]
    if (typeof systemPrompt !== 'string' || !systemPrompt.trim()) {
      throw new Error('Fast Body Event Context requires its reaction prompt')
    }
    return {
      event,
      eventKind: kind,
      sessionId: observation.sessionId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify({ eventKind: kind,
          ...(kind === 'servo_stall' ? {
            joints: event.data.joints,
            reason: event.data.reason,
            outputs_released: event.data.outputs_released,
          } : {}),
        }) },
      ],
      jsonSchema: {
        type: 'object', additionalProperties: false, required: ['speech'],
        properties: { speech: { type: 'string' } },
      },
    }
  },
})

export const fastBodyEventResponseNode = defineNode({
  ...fastBodyEventResponseSchema,
  async execute(inputs) {
    let response
    try { response = JSON.parse(inputs.response) }
    catch { throw new NodeInputValidationError('response', 'Body reaction must be JSON') }
    if (!response || typeof response.speech !== 'string') {
      throw new NodeInputValidationError('response', 'Body reaction requires speech')
    }
    return { speech: response.speech }
  },
})
