/**
 * Task Handlers
 *
 * Unified handlers for task management.
 * Uses withUserContext + existing core functions.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, badRequestResponse, notFoundResponse } from '../types.js';
import { withUserContext } from '../../context.js';
import { createTask, listActiveTasks, updateTask, deleteTask } from '../../memory.js';

/**
 * GET /api/tasks - List active tasks
 */
export async function handleListTasks(req: UnifiedRequest): Promise<UnifiedResponse> {
  const tasks = await withUserContext(
    { userId: req.user.userId, username: req.user.username, role: req.user.role },
    () => listActiveTasks()
  );

  return successResponse({
    success: true,
    tasks,
    count: tasks.length,
  });
}

/**
 * POST /api/tasks - Create a new task
 */
export async function handleCreateTask(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { title, description, priority = 'medium', due, tags = [] } = req.body || {};

  if (!title || typeof title !== 'string') {
    return badRequestResponse('Title is required');
  }

  const taskId = await withUserContext(
    { userId: req.user.userId, username: req.user.username, role: req.user.role },
    () => createTask(title, { description, priority, due, tags })
  );

  return successResponse({
    success: true,
    taskId,
  });
}

/**
 * PUT/PATCH /api/tasks/:id - Update a task
 */
export async function handleUpdateTask(req: UnifiedRequest): Promise<UnifiedResponse> {
  const taskId = req.params?.id;

  if (!taskId) {
    return badRequestResponse('Task ID is required');
  }

  const updates = req.body || {};

  try {
    await withUserContext(
      { userId: req.user.userId, username: req.user.username, role: req.user.role },
      () => updateTask(taskId, updates)
    );

    return successResponse({
      success: true,
      taskId,
    });
  } catch (error) {
    if ((error as Error).message?.includes('not found')) {
      return notFoundResponse('Task not found');
    }
    throw error;
  }
}

/**
 * DELETE /api/tasks/:id - Delete a task
 */
export async function handleDeleteTask(req: UnifiedRequest): Promise<UnifiedResponse> {
  const taskId = req.params?.id;

  if (!taskId) {
    return badRequestResponse('Task ID is required');
  }

  try {
    const result = await withUserContext(
      { userId: req.user.userId, username: req.user.username, role: req.user.role },
      () => deleteTask(taskId)
    );

    return successResponse({
      success: true,
      result,
    });
  } catch (error) {
    if ((error as Error).message?.includes('not found')) {
      return notFoundResponse('Task not found');
    }
    throw error;
  }
}
