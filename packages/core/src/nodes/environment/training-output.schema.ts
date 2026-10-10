export const environmentTrainingOutputSchema = {
  id: 'environment_training_output',
  name: 'Save Environment Decision',
  category: 'environment' as const,
  inputs: [
    { name: 'response', type: 'string' as const, description: 'Exact output string from the selected model call' },
    { name: 'messages', type: 'array' as const, description: 'Exact messages supplied to that model call' },
    { name: 'precomputedResponse', type: 'string' as const, optional: true, description: 'When present, this was not a model call' },
  ],
  outputs: [
    { name: 'saved', type: 'boolean' as const, description: 'Whether the decision was recorded for review' },
    { name: 'candidateId', type: 'string' as const, optional: true, description: 'Saved decision identity' },
    { name: 'error', type: 'string' as const, optional: true, description: 'Visible persistence failure' },
  ],
  properties: { specialist: 'intent', sourceNodeId: '' },
  propertySchemas: {
    specialist: { type: 'select' as const, default: 'intent', label: 'Training bank',
      options: [{ value: 'intent', label: 'Intent orchestration' }, { value: 'task', label: 'Task decision' }] },
    sourceNodeId: { type: 'string' as const, default: '', label: 'Source node ID' },
  },
  description: 'Records one model decision with its exact input messages in a separate review bank.',
}
