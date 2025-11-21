/**
 * Tasks API - Manage tasks
 * MIGRATED: 2025-11-20 - Explicit authentication pattern
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, getUserOrAnonymous } from '@metahuman/core';
import { listActiveTasks, listCompletedTasks, createTask, updateTaskStatus, updateTask } from '@metahuman/core/memory';
import { auditDataChange } from '@metahuman/core/audit';
import { requireWriteMode } from '../../middleware/cognitiveModeGuard';

const getHandler: APIRoute = async ({ cookies, request }) => {
  // Explicit auth - allow anonymous to see empty task list
  const user = getUserOrAnonymous(cookies);

  // Anonymous users see empty task lists
  if (user.role === 'anonymous') {
    return new Response(
      JSON.stringify({ tasks: [], completedTasks: [], status: 'all' as const }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    const activeTasks = listActiveTasks();
    const completedTasks = listCompletedTasks();

    const payload = (() => {
      switch ((status || '').toLowerCase()) {
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
    })();

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
};

const postHandler: APIRoute = async ({ cookies, request }) => {
  // Explicit auth - require authentication for writes
  const user = getAuthenticatedUser(cookies);

  try {
    const body = await request.json();
    const { title, description, priority, tags } = body;

    if (!title) {
      return new Response(
        JSON.stringify({ error: 'Title is required' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }

    const filepath = createTask(title, { description, priority, tags });

    // Audit the creation with actual username
    auditDataChange({
      type: 'create',
      resource: 'task',
      path: filepath,
      actor: user.username,
      details: { title },
    });

    return new Response(
      JSON.stringify({ success: true, filepath }),
      {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
};

const patchHandler: APIRoute = async ({ cookies, request }) => {
  // Explicit auth - require authentication for writes
  const user = getAuthenticatedUser(cookies);

  try {
    const body = await request.json();
    const { taskId, status, title, description, priority, tags, due, start, end, listId } = body;

    if (!taskId) {
      return new Response(
        JSON.stringify({ error: 'taskId is required' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
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

    // If only status is being updated, use the optimized status-only function
    if (status && Object.keys(updates).length === 0) {
      updateTaskStatus(taskId, status);
    } else {
      // Include status in updates if provided
      if (status) updates.status = status;
      updateTask(taskId, updates);
    }

    // Audit the update with actual username
    auditDataChange({
      type: 'update',
      resource: 'task',
      path: taskId,
      actor: user.username,
      details: { ...updates, status },
    });

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

// Export handlers - no withUserContext wrapper needed
// Security policy guards still enforced on POST and PATCH
export const GET = getHandler;
export const POST = requireWriteMode(postHandler);
export const PATCH = requireWriteMode(patchHandler);
