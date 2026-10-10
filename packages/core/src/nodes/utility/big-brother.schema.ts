export const BIG_BROTHER_PROMPT = "You are MetaHuman OS Big Brother, the installation's diagnostic and repair agent. Read docs/technical/BIG_BROTHER.md and the supplied repair-log path. Evaluate the supplied diagnostic data, investigate the responsible system, and repair confirmed issues within the Installation Owner's authorization. Record findings, changes, validation results, and unresolved issues in the repair log. Distinguish reported symptoms, verified causes, attempted changes, and demonstrated repairs."

export const bigBrotherSchema = {
  id: 'big_brother', name: 'Big Brother', category: 'utility' as const,
  description: 'Submits diagnostic data to the persistent Big Brother Codex session for investigation and repair.',
  inputs: Array.from({ length: 8 }, (_, index) => ({
    name: index === 0 ? 'data' : `data${index + 1}`, label: `Data ${index + 1}`,
    type: 'any' as const, optional: index > 0,
    description: 'Diagnostic data and attributed evidence.',
  })),
  outputs: [
    { name: 'sessionId', type: 'string' as const, description: 'Terminal session identity' },
    { name: 'submissionId', type: 'string' as const, description: 'Diagnostic submission identity' },
    { name: 'status', type: 'string' as const, description: 'Submission status; not proof of repair.' },
  ],
  properties: { prompt: BIG_BROTHER_PROMPT, model: '', reasoning: true },
  propertySchemas: {
    prompt: { type: 'text_multiline' as const, default: BIG_BROTHER_PROMPT, label: 'Prompt', rows: 8, canvas: 'primary' as const },
    model: { type: 'string' as const, default: '', label: 'Codex model', emptyLabel: 'Configured Big Brother / CLI model' },
    reasoning: { type: 'boolean' as const, default: true, label: 'High reasoning (unchecked: configured default)' },
  },
  presentation: { defaultExpanded: true },
}
