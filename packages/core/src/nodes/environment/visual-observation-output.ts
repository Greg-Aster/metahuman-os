import { validateVisualObservation } from '../../visual-observation.js'
import type { EnvironmentVisualFrame } from '../../environment-interface/types.js'
import { NodeInputValidationError } from '../types.js'

/** Keep invalid model output on the existing model/consumer correction path. */
export function visualObservationOutput(value: unknown, frames: EnvironmentVisualFrame[] = []) {
  const result = validateVisualObservation(value, frames)
  if (result.error) throw new NodeInputValidationError('response', result.error)
  return result.value
}
