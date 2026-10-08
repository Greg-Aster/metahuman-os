export const PLANNING_DELEGATION_DESCRIPTION = 'The additional output {"delegatePlanning":true} requests planning by the configured larger model. The larger model receives the same context and returns the existing task output. This requests planning; it does not admit an action or report completion.'

export function isPlanningDelegation(value: unknown): value is { delegatePlanning: true } {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 1 && (value as Record<string, unknown>).delegatePlanning === true
}
