import type { AutonomyMode } from '../queue/types.js'

export interface ActivationUpdate {
  operationId: string
  activation: number
  reason: string
  instruction: string
}

export interface ActivationAssessment {
  executionId: string
  assessedAt: string
  mode: AutonomyMode
  updates: ActivationUpdate[]
  levels: Record<string, ActivationUpdate & { assessedAt: string }>
  selected: ActivationUpdate[]
}

/** Apply the Installation Owner's mode rule to the model's ordered updates. */
export function selectActivatedOperations(updates: ActivationUpdate[], mode: AutonomyMode): ActivationUpdate[] {
  if (mode === 'reactive') return []
  if (mode === 'semi') return updates.filter(update => update.activation === 100)
  const highest = updates.reduce<ActivationUpdate | undefined>((best, update) => (
    !best || update.activation > best.activation ? update : best
  ), undefined)
  return highest ? [highest] : []
}
