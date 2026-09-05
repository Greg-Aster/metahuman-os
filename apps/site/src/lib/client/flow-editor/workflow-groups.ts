export type WorkflowGroupId =
  | 'robot-autonomy'
  | 'desires-agency'
  | 'persona-preferences'
  | 'memory-reflection'
  | 'system-utilities'
  | 'other'

type GroupableWorkflow = {
  name: string
  title?: string
}

type WorkflowGroupDefinition = {
  id: WorkflowGroupId
  label: string
}

export type WorkflowGroup<T extends GroupableWorkflow> = WorkflowGroupDefinition & {
  workflows: T[]
}

const WORKFLOW_GROUPS: readonly WorkflowGroupDefinition[] = [
  { id: 'robot-autonomy', label: 'Robot Autonomy' },
  { id: 'desires-agency', label: 'Desires & Agency' },
  { id: 'persona-preferences', label: 'Persona & Preferences' },
  { id: 'memory-reflection', label: 'Memory, Curiosity & Reflection' },
  { id: 'system-utilities', label: 'System & Utilities' },
  { id: 'other', label: 'Other Workflows' },
]

const PERSONA_WORKFLOWS = new Set([
  'mood-review',
  'psychoanalyzer',
])

const MEMORY_REFLECTION_WORKFLOWS = new Set([
  'audio-organizer',
  'curator-mode',
  'curiosity-mode',
  'curiosity-researcher',
  'daydreamer-mode',
  'dreamer-mode',
  'inner-curiosity',
  'organizer-agent',
  'reflector-mode',
  'train-of-thought',
])

const SYSTEM_UTILITY_WORKFLOWS = new Set([
  'goal-review',
  'response-pipeline',
  'self-healing-analysis',
  'semantic-turn',
  'system-event',
])

export function workflowGroupId(name: string): WorkflowGroupId {
  const normalizedName = name.trim().toLowerCase()

  if (normalizedName.startsWith('boredom-') || normalizedName.startsWith('robot-')) {
    return 'robot-autonomy'
  }
  if (normalizedName.startsWith('desire-')) return 'desires-agency'
  if (normalizedName.startsWith('persona-') || PERSONA_WORKFLOWS.has(normalizedName)) {
    return 'persona-preferences'
  }
  if (MEMORY_REFLECTION_WORKFLOWS.has(normalizedName)) return 'memory-reflection'
  if (SYSTEM_UTILITY_WORKFLOWS.has(normalizedName)) return 'system-utilities'

  return 'other'
}

export function groupWorkflows<T extends GroupableWorkflow>(workflows: readonly T[]): WorkflowGroup<T>[] {
  const buckets = new Map<WorkflowGroupId, T[]>(
    WORKFLOW_GROUPS.map(group => [group.id, []]),
  )

  for (const workflow of workflows) {
    buckets.get(workflowGroupId(workflow.name))?.push(workflow)
  }

  return WORKFLOW_GROUPS.map(group => ({
    ...group,
    workflows: (buckets.get(group.id) || []).sort((left, right) =>
      (left.title || left.name).localeCompare(right.title || right.name),
    ),
  })).filter(group => group.workflows.length > 0)
}
