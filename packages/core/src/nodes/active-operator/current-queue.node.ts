/**
 * Current Queue Node
 *
 * Context node that provides current task queue state for the unified decision.
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { getQueueManager } from '../../queue/index.js';

const execute: NodeExecutor = async (inputs, context) => {
  const queueManager = getQueueManager();
  const allTasks = queueManager.getAllTasks();
  const stats = queueManager.getStats();

  // Convert to queue task format
  const queuedTasks = allTasks.map(t => ({
    id: t.id,
    type: t.type,
    priority: t.priority,
    queuedAt: t.queuedAt,
    username: t.username,
  }));

  // Check for critical priority tasks
  const hasCritical = queuedTasks.some(t => t.priority === 'critical');

  console.log(`[CurrentQueue] Queue has ${queuedTasks.length} tasks, hasCritical: ${hasCritical}`);

  return {
    queuedTasks,
    queueLength: queuedTasks.length,
    hasCritical,
    stats,
  };
};

export const CurrentQueueNode: NodeDefinition = defineNode({
  id: 'current_queue',
  name: 'Current Queue',
  category: 'active-operator',
  inputs: [],
  outputs: [
    { name: 'queuedTasks', type: 'array', description: 'Tasks currently waiting in the queue' },
    { name: 'queueLength', type: 'number', description: 'Number of tasks in queue' },
    { name: 'hasCritical', type: 'boolean', description: 'Whether queue has critical priority tasks' },
  ],
  properties: {},
  description: 'Provides current task queue state for the unified decision',
  execute,
});
