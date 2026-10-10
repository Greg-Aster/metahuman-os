/** Shared role names for profile assignments and graph model selectors. Browser-safe. */
export const MODEL_ROLE_OPTIONS = [
  { value: 'orchestrator', label: 'Orchestrator' },
  { value: 'environmentIntent', label: 'Environment intent' },
  { value: 'persona', label: 'Persona' },
  { value: 'environmentActionSelector', label: 'Task decisions' },
  { value: 'curator', label: 'Curator' },
  { value: 'coder', label: 'Coder' },
  { value: 'planner', label: 'Planner' },
  { value: 'summarizer', label: 'Summarizer' },
  { value: 'psychotherapist', label: 'Human insight' },
  { value: 'embedder', label: 'Embedder' },
] as const;

export type ModelRole = (typeof MODEL_ROLE_OPTIONS)[number]['value'];
export const MODEL_ROLES: readonly ModelRole[] = MODEL_ROLE_OPTIONS.map(option => option.value);

export function isModelRole(value: unknown): value is ModelRole {
  return typeof value === 'string' && (MODEL_ROLES as readonly string[]).includes(value);
}

export function normalizeModelRole(value: unknown, fallback: ModelRole): ModelRole {
  return isModelRole(value) ? value : fallback;
}
