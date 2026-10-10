export const environmentTrainingReviewInputSchema = {
  id: 'environment_training_review_input', name: 'Load Training Review', category: 'environment' as const,
  inputs: [],
  outputs: [
    { name: 'messages', type: 'array' as const },
    { name: 'bank', type: 'string' as const },
    { name: 'candidateId', type: 'string' as const },
    { name: 'sourceDigest', type: 'string' as const },
  ],
  properties: { systemPrompt: '' },
  propertySchemas: { systemPrompt: { type: 'text_multiline' as const, default: '', label: 'Curator Instructions', rows: 12 } },
  description: 'Loads a saved decision and its attributed evidence for review.',
}

export const environmentTrainingReviewSaveSchema = {
  id: 'environment_training_review_save', name: 'Save Curator Proposal', category: 'environment' as const,
  inputs: [
    { name: 'response', type: 'string' as const },
    { name: 'bank', type: 'string' as const },
    { name: 'candidateId', type: 'string' as const },
    { name: 'sourceDigest', type: 'string' as const },
  ],
  outputs: [
    { name: 'saved', type: 'boolean' as const },
    { name: 'verdict', type: 'string' as const },
  ],
  description: 'Saves the curator proposal for human review.',
}
