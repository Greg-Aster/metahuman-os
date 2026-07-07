import { defineNode } from '../types.js';
import { getLatestEnvironmentObservation } from '../../environment-interface/index.js';

export const environmentObservationNode = defineNode({
  id: 'environment_observation',
  name: 'Environment Observation',
  category: 'environment',
  inputs: [
    { name: 'sessionId', type: 'string', optional: true, description: 'Specific environment session to read' },
  ],
  outputs: [
    { name: 'observation', type: 'object', description: 'Latest environment observation' },
    { name: 'text', type: 'array', description: 'Recent environment text events' },
    { name: 'state', type: 'object', description: 'Structured environment state' },
    { name: 'location', type: 'object', description: 'Structured location or coordinate data' },
    { name: 'map', type: 'object', description: 'Optional environment map data' },
    { name: 'visual', type: 'object', description: 'Optional visual frame metadata' },
    { name: 'visuals', type: 'array', description: 'Optional visual frame list' },
    { name: 'feedback', type: 'array', description: 'Feedback events included in the observation' },
    { name: 'capabilities', type: 'object', description: 'Available environment actions and inputs' },
    { name: 'sessionId', type: 'string', description: 'Environment session identifier' },
    { name: 'connected', type: 'boolean', description: 'Whether an observation is available' },
  ],
  description: 'Reads the latest observation from an environment bridge session.',
  async execute(inputs, context) {
    const sessionId = typeof inputs.sessionId === 'string' && inputs.sessionId
      ? inputs.sessionId
      : typeof context.sessionId === 'string'
        ? context.sessionId
        : undefined;
    const contextObservation = context.environmentObservation && typeof context.environmentObservation === 'object'
      ? context.environmentObservation as ReturnType<typeof getLatestEnvironmentObservation>
      : undefined;
    if (
      contextObservation &&
      (!sessionId || contextObservation.sessionId === sessionId)
    ) {
      return {
        observation: contextObservation,
        text: contextObservation.text ?? [],
        state: contextObservation.state ?? {},
        location: contextObservation.location ?? null,
        map: contextObservation.map ?? null,
        visual: contextObservation.visual ?? null,
        visuals: contextObservation.visuals ?? [],
        feedback: contextObservation.feedback ?? [],
        capabilities: contextObservation.capabilities ?? { actions: [] },
        sessionId: contextObservation.sessionId ?? '',
        connected: true,
      };
    }
    const observation = getLatestEnvironmentObservation(
      sessionId,
    );

    return {
      observation,
      text: observation?.text ?? [],
      state: observation?.state ?? {},
      location: observation?.location ?? null,
      map: observation?.map ?? null,
      visual: observation?.visual ?? null,
      visuals: observation?.visuals ?? [],
      feedback: observation?.feedback ?? [],
      capabilities: observation?.capabilities ?? { actions: [] },
      sessionId: observation?.sessionId ?? '',
      connected: Boolean(observation),
    };
  },
});
