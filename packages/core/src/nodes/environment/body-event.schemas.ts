import type { NodeSchema } from '../schemas.js'

export const bodyEventContextSchema: Omit<NodeSchema, "color" | "bgColor"> = {
  id: 'body_event_context', name: 'Body Event Context', category: 'environment',
  description: 'Builds event evidence and Robot Status for the editable event prompt.',
  inputs: [],
  outputs: [{ name: 'messages', type: 'array', description: 'Approved event prompt and attributed event evidence for the model.' }, { name: 'event', type: 'object', description: 'Original body event with its identity and measurements.' }],
  properties: { systemPrompt: '' },
  propertySchemas: { systemPrompt: { type: 'text_multiline', default: '', label: 'Event Trigger Prompt', description: 'Instructions for the event-analysis model.', rows: 18 } },
}

export const bodyEventDecisionSchema: Omit<NodeSchema, "color" | "bgColor"> = {
  id: 'body_event_decision', name: 'Event Decision to Environment', category: 'environment',
  description: 'Carries the model-authored event decision into the existing Environment Mode child workflow.',
  inputs: [{ name: 'response', type: 'string', description: 'JSON decision returned by the event model.' }],
  outputs: [{ name: 'delegate', type: 'boolean', description: 'Whether the model selected Environment Mode delegation.' }, { name: 'decision', type: 'object', description: 'The unchanged model-authored decision, intention and reason.' },
    { name: 'invocation', type: 'object', description: 'Environment Mode child-workflow context, or null for no action.' }],
  properties: {},
}

export const environmentEventRequestSchema: Omit<NodeSchema, "color" | "bgColor"> = {
  id: 'environment_event_request', name: 'Environment Request', category: 'environment',
  description: 'Joins human input and attributed autonomous intentions for the shared execution workflow. A new human turn replaces the previous turn source.',
  inputs: [{ name: 'message', type: 'string', optional: true, description: 'Current human request.' },
    { name: 'plannerDecision', type: 'object', optional: true, description: 'Intention supplied by Autonomy Input.' },
    { name: 'robotObserver', type: 'object', optional: true, description: 'Originating planner cycle.' },
    { name: 'memories', type: 'array', optional: true, description: 'Planner-delegated memories.' },
    { name: 'sourceObservationAt', type: 'string', optional: true, description: 'Original observation time.' },
    { name: 'responseMetadata', type: 'object', optional: true, description: 'Autonomous speech provenance.' }],
  outputs: [{ name: 'message', type: 'string', description: 'Selected request or intention, unchanged.' },
    { name: 'plannerDecision', type: 'object', description: 'Selected intention, separate from human conversation.' },
    { name: 'autonomy', type: 'boolean', description: 'Whether the selected input came from Autonomy Input.' },
    { name: 'robotObserver', type: 'object', description: 'Selected planner cycle.' },
    { name: 'memories', type: 'array', description: 'Selected planner memories.' },
    { name: 'sourceObservationAt', type: 'string', description: 'Selected planner observation time.' },
    { name: 'responseMetadata', type: 'object', description: 'Speech provenance for this input.' }],
  properties: {},
}
