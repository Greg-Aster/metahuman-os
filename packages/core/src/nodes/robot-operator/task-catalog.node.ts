import { getAgentCatalogSnapshot } from '../../agent-catalog.js'
import { agentTaskType } from '../../queue/agent-work-catalog.js'
import { defineNode } from '../types.js'
import {
  DEFAULT_ROBOT_AUTONOMY_TASK_IDS,
  ROBOT_AUTONOMY_EXECUTOR_TASK_ID,
  ROBOT_AUTONOMY_TASK_OPTIONS,
  type RobotAutonomyTaskDescriptor,
} from './autonomy-task-options.js'

function configuredTaskIds(value: unknown): string[] {
  const source = Array.isArray(value) ? value : DEFAULT_ROBOT_AUTONOMY_TASK_IDS
  return [...new Set(source
    .filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.trim())
    .filter(Boolean))]
}

export const robotAutonomyTaskCatalogNode = defineNode({
  id: 'robot_autonomy_task_catalog',
  name: 'Available Autonomy Tasks',
  category: 'operator',
  inputs: [],
  outputs: [
    { name: 'tasks', type: 'array', description: 'Configured tasks that are currently executable, with their Agent Catalog descriptions' },
    { name: 'taskIds', type: 'array', description: 'Identifiers of the currently available tasks' },
    { name: 'unavailableTaskIds', type: 'array', description: 'Configured tasks that are missing, disabled, or not executable' },
    { name: 'count', type: 'number', description: 'Number of tasks currently available to the controller' },
  ],
  properties: {
    taskIds: [...DEFAULT_ROBOT_AUTONOMY_TASK_IDS],
  },
  propertySchemas: {
    taskIds: {
      type: 'multiselect',
      default: [...DEFAULT_ROBOT_AUTONOMY_TASK_IDS],
      label: 'Available Tasks',
      description: 'Tasks the Full-mode LLM may choose. Names, descriptions, handlers, and current availability come from the canonical Agent Catalog.',
      options: ROBOT_AUTONOMY_TASK_OPTIONS,
    },
  },
  description: 'Loads the configured Full-mode choices from the canonical Agent Catalog. It advertises capabilities to the LLM but does not choose or start a task.',
  async execute(_inputs, _context, properties) {
    const selectedIds = configuredTaskIds(properties?.taskIds)
    const catalog = getAgentCatalogSnapshot()
    const catalogById = new Map(catalog.agents.map(agent => [agent.id, agent]))
    const tasks: RobotAutonomyTaskDescriptor[] = []
    const unavailableTaskIds: string[] = []

    for (const id of selectedIds) {
      if (id === ROBOT_AUTONOMY_EXECUTOR_TASK_ID) {
        tasks.push({
          id,
          name: 'Robot Autonomy Executor',
          description: 'Carries one high-level self-directed embodied intention into the robot action workflow, which may converse, use an advertised motion, or generate an off-script movement.',
          kind: 'environment-executor',
          handler: 'environment.observation',
          taskType: 'environment_observation',
          priority: 'low',
          tags: ['robot', 'environment', 'embodied-action'],
        })
        continue
      }

      const agent = catalogById.get(id)
      if (!agent || agent.lifecycle === 'service' || !agent.canRun || id === 'robot-autonomy-controller') {
        unavailableTaskIds.push(id)
        continue
      }
      tasks.push({
        id: agent.id,
        name: agent.displayName,
        description: agent.description,
        kind: 'agent',
        handler: agent.handler,
        taskType: agentTaskType(agent.id),
        priority: agent.priority,
        tags: agent.tags,
      })
    }

    return {
      tasks,
      taskIds: tasks.map(task => task.id),
      unavailableTaskIds,
      count: tasks.length,
    }
  },
})
