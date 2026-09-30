import type { EnvironmentObservation, EnvironmentVisualFrame } from './environment-interface/types.js'

export interface VisualObservationSource {
  environmentId: string
  adapter: string
  sessionId: string
  robotId: string | null
}

export function visualObservationSource(observation: EnvironmentObservation): VisualObservationSource {
  const body = observation.state?.body as Record<string, unknown> | undefined
  return { environmentId: observation.environmentId, adapter: observation.adapter, sessionId: observation.sessionId,
    robotId: typeof body?.robotId === 'string' && body.robotId.trim() ? body.robotId.trim() : null }
}

/** Model interpretation, separate from task decisions and conversational speech. */
export interface VisualObservation {
  summary: string
  frameIds: string[]
  uncertainties: string[]
  changes?: string
}

export interface VisualObservationRecord extends VisualObservation, VisualObservationSource {
  observationId: string
  executionId: string
  occurrenceId: string
  interpretedAt: string
  frames: Array<{ id: string; timestamp: string; actionId?: string }>
}

export interface ObservationHistoryQuery extends VisualObservationSource {
  limit: number
}

/** Describe the available output only when this call actually receives pixels. */
export function withVisualObservationSchema(schema: any, frames: EnvironmentVisualFrame[]): any {
  if (Array.isArray(schema.anyOf)) return { ...schema, anyOf: schema.anyOf.map((item: any) => withVisualObservationSchema(item, frames)) }
  return {
    ...schema,
    properties: {
      ...schema.properties,
      visualObservation: frames.length ? {
        description: 'Optional brief interpretation of the attached images, independent of speech or a task. Include uncertainty; changes can describe a comparison. Frame IDs identify the images examined, not narrative history.',
        anyOf: [{ type: 'null' }, {
          type: 'object', additionalProperties: false,
          required: ['summary', 'frameIds', 'uncertainties'],
          properties: {
            summary: { type: 'string', minLength: 1 },
            frameIds: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: frames.map(frame => frame.id) } },
            uncertainties: { type: 'array', items: { type: 'string' } },
            changes: { type: 'string' },
          },
        }],
      } : { type: 'null' },
    },
  }
}

export function validateVisualObservation(value: unknown, frames: EnvironmentVisualFrame[]): {
  value: VisualObservation | null; error?: string
} {
  const invalid = (error: string) => ({ value: null, error: `visualObservation ${error}` })
  if (value === undefined || value === null) return { value: null }
  if (typeof value !== 'object' || Array.isArray(value)) return invalid('must be an object or null')
  const item = value as Record<string, unknown>
  if (Object.keys(item).some(key => !['summary', 'frameIds', 'uncertainties', 'changes'].includes(key))) return invalid('contains an unknown field')
  if (typeof item.summary !== 'string' || !item.summary.trim()) return invalid('requires a summary')
  if (!Array.isArray(item.frameIds) || !item.frameIds.length
    || item.frameIds.some(id => typeof id !== 'string' || !frames.some(frame => frame.id === id))
    || new Set(item.frameIds).size !== item.frameIds.length) return invalid('must reference distinct images attached to this model call')
  if (!Array.isArray(item.uncertainties) || item.uncertainties.some(text => typeof text !== 'string')) return invalid('requires an array of uncertainties')
  if (item.changes !== undefined && typeof item.changes !== 'string') return invalid('changes must be text')
  return { value: { summary: item.summary.trim(), frameIds: item.frameIds,
    uncertainties: item.uncertainties, ...(item.changes !== undefined ? { changes: item.changes as string } : {}) } }
}
