import type {
  EnvironmentFeedback,
  EnvironmentObservation,
} from '@metahuman/core/environment-interface';

export function attachCorrelatedFeedback(
  observation: EnvironmentObservation,
  pending: EnvironmentFeedback,
): EnvironmentObservation {
  const existing = Array.isArray(observation.feedback)
    ? observation.feedback
    : [];
  if (existing.some(item => item.id === pending.id)) {
    return observation;
  }
  const observationActionId = (
    observation.metadata
    && typeof observation.metadata.actionId === 'string'
  )
    ? observation.metadata.actionId
    : '';
  if (!pending.actionId || observationActionId !== pending.actionId) {
    return observation;
  }
  return {
    ...observation,
    feedback: [...existing, pending],
  };
}
