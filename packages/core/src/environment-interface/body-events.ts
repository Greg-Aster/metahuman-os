import type { EnvironmentObservation } from './types.js'

/** Routing uses the body's reported event type, without another model decision. */
export function resolveBodyEventGraph(observation: EnvironmentObservation): 'fast-body-event' | 'body-event-trigger' {
  const event = observation.state?.bodyEvent as { data?: { kind?: unknown } } | undefined
  const kind = event?.data?.kind
  return kind === 'tipped' || kind === 'rapid_movement' || kind === 'servo_stall'
    ? 'fast-body-event' : 'body-event-trigger'
}
