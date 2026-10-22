/** Shared role names for profile assignments and graph model selectors. Browser-safe. */
export const MODEL_ROLE_OPTIONS = [
  { value: 'orchestrator', label: 'Orchestrator', description: 'Interprets incoming requests and events, and selects the required workflows, tools and context.' },
  { value: 'environmentVision', label: 'Vision', description: 'Interprets visual evidence and supports visually grounded planning.' },
  { value: 'persona', label: 'Persona', description: "Expresses the robot's identity, personality, conversation and self-directed intentions." },
  { value: 'autonomy', label: 'Autonomy', description: 'Selects self-directed activities and develops autonomous intentions.' },
  { value: 'environmentActionSelector', label: 'Task Decisions', description: 'Selects concrete supported actions and task controls for a routed request.' },
  { value: 'lightweight', label: 'Lightweight', description: 'Produces brief responses and simple decisions for time-sensitive events.' },
  { value: 'curator', label: 'Curator', description: 'Reviews, attributes and prepares saved records for memory and training.' },
  { value: 'coder', label: 'Coder', description: 'Generates and analyzes code and technical solutions.' },
  { value: 'planner', label: 'Planner', description: 'Develops and revises plans for complex or multi-step tasks.' },
  { value: 'summarizer', label: 'Summarizer', description: 'Condenses supplied information while preserving its meaning and attribution.' },
  { value: 'psychotherapist', label: 'Psychotherapist', description: 'Independently analyzes attributed experience, behavior and outcomes, including persona and desire review.' },
  { value: 'embedder', label: 'Embedder', description: 'Produces vector representations for retrieval and similarity.' },
] as const;

export type ModelRole = (typeof MODEL_ROLE_OPTIONS)[number]['value'];
export const MODEL_ROLES: readonly ModelRole[] = MODEL_ROLE_OPTIONS.map(option => option.value);

export function isModelRole(value: unknown): value is ModelRole {
  return typeof value === 'string' && (MODEL_ROLES as readonly string[]).includes(value);
}

export function normalizeModelRole(value: unknown, fallback: ModelRole): ModelRole {
  return isModelRole(value) ? value : fallback;
}
