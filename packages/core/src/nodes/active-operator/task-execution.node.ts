/**
 * Task Execution Node
 *
 * Executes the chosen task via the task executor.
 * This is the output node that actually runs the decided task.
 */

import { defineNode, type NodeDefinition, type NodeExecutor } from '../types.js';
import { executeTask } from '../../active-operator/task-executor.js';
import type { QueuedTask, TaskType } from '../../active-operator/types.js';
import { audit } from '../../audit.js';

const execute: NodeExecutor = async (inputs, context) => {
  const username = context.userId || context.username || 'anonymous';
  const task = inputs.task;
  const reasoning = inputs.reasoning || 'No reasoning provided';

  if (!task) {
    console.log('[TaskExecution] No task to execute');
    return {
      executed: false,
      reason: 'No task provided',
    };
  }

  console.log(`[TaskExecution] Executing task: ${task}`);

  try {
    // Create a queued task object for the executor
    // The payload uses 'type' as the discriminant with reasoning as metadata
    const queuedTask: QueuedTask = {
      id: `graph-${Date.now()}`,
      type: task as TaskType,
      priority: 'normal',
      queuedAt: new Date().toISOString(),
      payload: { type: task, _reasoning: reasoning } as any,
      username,
    };

    // Execute the task
    const result = await executeTask(queuedTask);

    audit({
      category: 'action',
      level: 'info',
      event: 'lizard_brain_task_executed',
      actor: 'active-operator',
      details: {
        task,
        reasoning,
        success: result.success,
        durationMs: result.durationMs,
      },
    });

    console.log(`[TaskExecution] Task ${task} completed: success=${result.success}`);

    return {
      executed: true,
      success: result.success,
      result,
    };

  } catch (error) {
    console.error(`[TaskExecution] Error executing ${task}:`, error);

    audit({
      category: 'action',
      level: 'error',
      event: 'lizard_brain_task_failed',
      actor: 'active-operator',
      details: {
        task,
        reasoning,
        error: (error as Error).message,
      },
    });

    return {
      executed: false,
      success: false,
      error: (error as Error).message,
    };
  }
};

export const TaskExecutionNode: NodeDefinition = defineNode({
  id: 'task_execution',
  name: 'Task Execution',
  category: 'active-operator',
  inputs: [
    { name: 'task', type: 'string', description: 'Task type to execute' },
    { name: 'reasoning', type: 'string', description: 'Decision reasoning for audit' },
  ],
  outputs: [
    { name: 'executed', type: 'boolean', description: 'Whether task was executed' },
    { name: 'success', type: 'boolean', description: 'Whether execution succeeded' },
    { name: 'result', type: 'object', description: 'Execution result' },
  ],
  properties: {},
  description: 'Executes the chosen task via the task executor',
  execute,
});
