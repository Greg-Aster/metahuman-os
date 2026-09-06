import { AGENT_CATALOG_DEFINITIONS } from '../../agent-catalog-definitions.js'

export const ROBOT_AUTONOMY_EXECUTOR_TASK_ID = 'robot-autonomy-executor'
export const ROBOT_AUTONOMY_NO_TASK_ID = 'none'
export const ROBOT_AUTONOMY_LIFECYCLE_TASK_IDS = new Set([
  'robot-autonomy-controller',
  'robot-status',
  'robot-goal-review',
])

export const DEFAULT_ROBOT_AUTONOMY_TASK_IDS = [
  ROBOT_AUTONOMY_EXECUTOR_TASK_ID,
  'boredom-observer',
  'boredom-movement',
  'boredom-reflection',
  'reflector',
  'daydreamer',
  'curiosity',
  'curiosity-researcher',
  'inner-curiosity',
  'train-of-thought',
  'desire-agent',
  'mood',
] as const

export const ROBOT_AUTONOMY_TASK_OPTIONS = [
  {
    value: ROBOT_AUTONOMY_EXECUTOR_TASK_ID,
    label: 'Robot Autonomy Executor',
  },
  ...Object.values(AGENT_CATALOG_DEFINITIONS)
    .filter(definition => (
      definition.lifecycle !== 'service'
      && !definition.internalOwner
      && !ROBOT_AUTONOMY_LIFECYCLE_TASK_IDS.has(definition.id)
    ))
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .map(definition => ({ value: definition.id, label: definition.displayName })),
]

export interface RobotAutonomyTaskDescriptor {
  id: string
  name: string
  description: string
  kind: 'agent' | 'environment-executor'
  handler: string
  taskType: string
  priority: 'low' | 'normal' | 'high'
  tags: string[]
}
