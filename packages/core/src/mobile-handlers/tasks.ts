/**
 * Mobile Task Handlers
 *
 * Uses withUserContext + existing core functions - NO DUPLICATION
 */

import { withUserContext } from '../context.js';
import { createTask, listActiveTasks, updateTask, deleteTask } from '../memory.js';
import type { MobileRequest, MobileResponse, MobileUserContext } from './types.js';
import { successResponse, errorResponse } from './types.js';

/**
 * GET /api/tasks - List active tasks
 */
export async function handleListTasks(
  request: MobileRequest,
  user: MobileUserContext
): Promise<MobileResponse> {
  if (!user.isAuthenticated) {
    return errorResponse(request.id, 401, 'Authentication required');
  }

  try {
    const tasks = await withUserContext(
      { userId: user.userId, username: user.username, role: user.role },
      () => listActiveTasks()
    );

    return successResponse(request.id, {
      success: true,
      tasks,
      count: tasks.length,
    });
  } catch (error) {
    console.error('[mobile-handlers] List tasks failed:', error);
    return errorResponse(request.id, 500, (error as Error).message);
  }
}

/**
 * POST /api/tasks - Create a new task
 */
export async function handleCreateTask(
  request: MobileRequest,
  user: MobileUserContext
): Promise<MobileResponse> {
  if (!user.isAuthenticated) {
    return errorResponse(request.id, 401, 'Authentication required');
  }

  const { title, description, priority = 'medium', due, tags = [] } = request.body || {};

  if (!title || typeof title !== 'string') {
    return errorResponse(request.id, 400, 'Title is required');
  }

  try {
    const taskId = await withUserContext(
      { userId: user.userId, username: user.username, role: user.role },
      () => createTask(title, { description, priority, due, tags })
    );

    return successResponse(request.id, {
      success: true,
      taskId,
    });
  } catch (error) {
    console.error('[mobile-handlers] Create task failed:', error);
    return errorResponse(request.id, 500, (error as Error).message);
  }
}

/**
 * PUT /api/tasks/:id - Update a task
 */
export async function handleUpdateTask(
  request: MobileRequest,
  user: MobileUserContext
): Promise<MobileResponse> {
  if (!user.isAuthenticated) {
    return errorResponse(request.id, 401, 'Authentication required');
  }

  // Extract task ID from path: /api/tasks/task-id
  const pathMatch = request.path.match(/\/api\/tasks\/([^\/]+)/);
  const taskId = pathMatch?.[1];

  if (!taskId) {
    return errorResponse(request.id, 400, 'Task ID is required');
  }

  const updates = request.body || {};

  try {
    await withUserContext(
      { userId: user.userId, username: user.username, role: user.role },
      () => updateTask(taskId, updates)
    );

    return successResponse(request.id, {
      success: true,
      taskId,
    });
  } catch (error) {
    console.error('[mobile-handlers] Update task failed:', error);
    return errorResponse(request.id, 500, (error as Error).message);
  }
}

/**
 * DELETE /api/tasks/:id - Delete a task
 */
export async function handleDeleteTask(
  request: MobileRequest,
  user: MobileUserContext
): Promise<MobileResponse> {
  if (!user.isAuthenticated) {
    return errorResponse(request.id, 401, 'Authentication required');
  }

  // Extract task ID from path
  const pathMatch = request.path.match(/\/api\/tasks\/([^\/]+)/);
  const taskId = pathMatch?.[1];

  if (!taskId) {
    return errorResponse(request.id, 400, 'Task ID is required');
  }

  try {
    const result = await withUserContext(
      { userId: user.userId, username: user.username, role: user.role },
      () => deleteTask(taskId)
    );

    return successResponse(request.id, {
      success: true,
      result,
    });
  } catch (error) {
    console.error('[mobile-handlers] Delete task failed:', error);
    return errorResponse(request.id, 500, (error as Error).message);
  }
}
