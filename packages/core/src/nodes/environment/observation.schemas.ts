import type { NodeDefinition } from '../types.js'

export const observationHistorySchema = {
  id: 'observation_history',
  name: 'Observation History',
  category: 'context',
  inputs: [
    { name: 'observation', type: 'object', description: 'Bridge identity of the robot whose visual history is requested' },
  ],
  outputs: [
    { name: 'observations', type: 'array', description: 'Image-linked model interpretations, oldest to newest; source times are unchanged' },
    { name: 'count', type: 'number', description: 'Number of observations loaded' },
  ],
  properties: { limit: 5 },
  propertySchemas: {
    limit: { type: 'number', label: 'Observations to load', default: 5, min: 0,
      description: 'Recent visual interpretations supplied to this graph. Zero supplies none; this does not delete evidence.' },
  },
  description: 'Loads visual interpretations for this profile and robot from retained executions. Keeps their source images available to this execution. No capture or model call.',
} satisfies Pick<NodeDefinition, 'id' | 'name' | 'category' | 'inputs' | 'outputs' | 'properties' | 'propertySchemas' | 'description'>

export const saveVisualObservationSchema = {
  id: 'save_visual_observation',
  name: 'Save Visual Observation',
  category: 'output',
  inputs: [
    { name: 'visualObservation', type: 'object', optional: true, description: 'Model interpretation separated from speech and task decisions' },
    { name: 'frames', type: 'array', optional: true, description: 'Exact source frames attached to that model call' },
    { name: 'observation', type: 'object', optional: true, description: 'Environment Bridge robot and adapter identity' },
  ],
  outputs: [
    { name: 'observation', type: 'object', description: 'Image-linked interpretation staged with this node checkpoint, or null' },
    { name: 'saved', type: 'boolean', description: 'Whether an observation was staged for the successful checkpoint' },
  ],
  properties: {},
  description: 'Saves an existing model interpretation and its source-image references in durable execution storage. Does not call a model, change a goal, or emit speech.',
} satisfies Pick<NodeDefinition, 'id' | 'name' | 'category' | 'inputs' | 'outputs' | 'properties' | 'propertySchemas' | 'description'>
