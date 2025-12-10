/**
 * Task Handlers
 *
 * Unified handlers for task management.
 * Uses withUserContext + existing core functions.
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, badRequestResponse, notFoundResponse } from '../types.js';
import { withUserContext } from '../../context.js';
import { createTask, listActiveTasks, listCompletedTasks, updateTask, updateTaskStatus, deleteTask } from '../../memory.js';
import { auditDataChange } from '../../audit.js';

/**
 * GET /api/tasks - List tasks with optional status filtering
 */
export async function handleListTasks(req: UnifiedRequest): Promise<UnifiedResponse> {
  // Anonymous users see empty task lists
  if (!req.user.isAuthenticated) {
    return successResponse({
      tasks: [],
      completedTasks: [],
      status: 'all',
    });
  }

  const statusFilter = (req.query?.status || 'all').toLowerCase();

  const result = await withUserContext(
    { userId: req.user.userId, username: req.user.username, role: req.user.role },
    () => {
      const activeTasks = listActiveTasks();
      const completedTasks = listCompletedTasks();

      switch (statusFilter) {
        case 'completed':
          return { tasks: completedTasks, status: 'completed' as const };
        case 'active':
          return { tasks: activeTasks, status: 'active' as const };
        case 'all':
        default:
          return {
            tasks: activeTasks,
            completedTasks,
            status: 'all' as const,
          };
      }
    }
  );

  return successResponse(result);
}

/**
 * POST /api/tasks - Create a new task
 */
export async function handleCreateTask(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { title, description, priority = 'medium', due, tags = [] } = req.body || {};

  if (!title || typeof title !== 'string') {
    return badRequestResponse('Title is required');
  }

  const filepath = await withUserContext(
    { userId: req.user.userId, username: req.user.username, role: req.user.role },
    () => createTask(title, { description, priority, due, tags })
  );

  // Audit the creation
  auditDataChange({
    type: 'create',
    resource: 'task',
    path: filepath,
    actor: req.user.username,
    details: { title },
  });

  return successResponse({
    success: true,
    filepath,
  }, 201);
}

/**
 * PUT/PATCH /api/tasks/:id - Update a task
 * Supports both URL param id and body.taskId for flexibility
 */
export async function handleUpdateTask(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { taskId: bodyTaskId, status, title, description, priority, tags, due, start, end, listId } = req.body || {};
  const taskId = req.params?.id || bodyTaskId;

  if (!taskId) {
    return badRequestResponse('Task ID is required');
  }

  // Build updates object from provided fields
  const updates: Record<string, any> = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (priority !== undefined) updates.priority = priority;
  if (tags !== undefined) updates.tags = tags;
  if (due !== undefined) updates.due = due;
  if (start !== undefined) updates.start = start;
  if (end !== undefined) updates.end = end;
  if (listId !== undefined) updates.listId = listId;

  try {
    await withUserContext(
      { userId: req.user.userId, username: req.user.username, role: req.user.role },
      () => {
        // If only status is being updated, use the optimized status-only function
        if (status && Object.keys(updates).length === 0) {
          updateTaskStatus(taskId, status);
        } else {
          // Include status in updates if provided
          if (status) updates.status = status;
          updateTask(taskId, updates);
        }
      }
    );

    // Audit the update
    auditDataChange({
      type: 'update',
      resource: 'task',
      path: taskId,
      actor: req.user.username,
      details: { ...updates, status },
    });

    return successResponse({
      success: true,
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
