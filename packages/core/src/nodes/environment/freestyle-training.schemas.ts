export const freestyleRequestInputSchema = {
  id: 'environment_freestyle_request_input', name: 'Freestyle Work Input', category: 'environment' as const,
  inputs: [],
  outputs: [
    { name: 'movementRequest', type: 'object' as const, description: 'Selected off-script movement request' },
    { name: 'instruction', type: 'string' as const, description: 'Original objective wording' },
    { name: 'observation', type: 'object' as const, description: 'Capability and commanded-pose evidence' },
    { name: 'sessionId', type: 'string' as const, description: 'Target body session' },
  ],
  description: 'Exposes the existing Coordinator work input to the Freestyle graph.',
}

export const freestyleTrainingOutputSchema = {
  id: 'environment_freestyle_training_output', name: 'Save Freestyle Decision', category: 'environment' as const,
  inputs: [
    { name: 'modelMessages', type: 'array' as const, description: 'Exact messages supplied to the trajectory model' },
    { name: 'rawOutput', type: 'string' as const, optional: true, description: 'Exact trajectory model output before validation' },
    { name: 'valid', type: 'boolean' as const, description: 'Whether the trajectory passed validation' },
    { name: 'error', type: 'string' as const, optional: true, description: 'Generation or validation failure' },
    { name: 'action', type: 'object' as const, optional: true, description: 'Validated action, when available' },
  ],
  outputs: [
    { name: 'saved', type: 'boolean' as const, description: 'Whether the attempt was recorded for review' },
    { name: 'candidateId', type: 'string' as const, optional: true },
    { name: 'error', type: 'string' as const, optional: true, description: 'Visible persistence failure' },
  ],
  description: 'Records the exact Freestyle model attempt in its separate review bank.',
}
