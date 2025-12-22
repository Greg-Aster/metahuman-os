/**
 * Project Management API Handlers
 *
 * Endpoints for managing projects (task containers with goals).
 * Part of Phase 4: Task Graph + Projects
 *
 * POST /api/projects - Create a new project
 * GET /api/projects - List all projects
 * GET /api/projects/:id - Get project details with tasks
 * PUT /api/projects/:id - Update a project
 * DELETE /api/projects/:id - Archive a project
 * POST /api/projects/:id/tasks - Assign tasks to project
 * GET /api/projects/:id/graph - Get dependency graph for project tasks
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse, errorResponse, badRequestResponse } from '../types.js';
import {
  createProject,
  getProject,
  updateProject,
  deleteProject,
  listProjects,
  getProjectTasks,
  assignTaskToProject,
  areDependenciesMet,
  getBlockingDependencies,
  getDependentTasks,
  addTaskDependency,
  removeTaskDependency,
  getActionableTasks,
  getBlockedTasks,
  type Project,
} from '../../memory.js';
import { audit } from '../../audit.js';

/**
 * POST /api/projects
 * Create a new project
 */
export async function handleCreateProject(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const body = req.body as {
      title: string;
      description?: string;
      priority?: string;
      targetDate?: string;
      tags?: string[];
      source?: string;
      sourceId?: string;
    };

    if (!body.title) {
      return badRequestResponse('title is required');
    }

    const projectId = createProject(body.title, {
      description: body.description,
      priority: body.priority,
      targetDate: body.targetDate,
      tags: body.tags,
      source: body.source,
      sourceId: body.sourceId,
    });

    audit({
      category: 'data_change',
      level: 'info',
      event: 'project_created',
      actor: req.user.username,
      details: {
        projectId,
        title: body.title,
        source: body.source,
      },
    });

    const project = getProject(projectId);

    return successResponse({
      success: true,
      project,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/projects
 * List all projects
 */
export async function handleListProjects(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const includeArchived = req.query?.includeArchived === 'true';
    const projects = listProjects(includeArchived);

    return successResponse({
      success: true,
      projects,
      count: projects.length,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/projects/:id
 * Get project details with tasks
 */
export async function handleGetProject(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const projectId = req.params?.id;
    if (!projectId) {
      return badRequestResponse('project ID is required');
    }

    const project = getProject(projectId);
    if (!project) {
      return errorResponse('Project not found', 404);
    }

    const tasks = getProjectTasks(projectId);

    // Calculate task statistics
    const stats = {
      total: tasks.length,
      todo: tasks.filter((t) => t.status === 'todo').length,
      inProgress: tasks.filter((t) => t.status === 'in_progress').length,
      blocked: tasks.filter((t) => t.status === 'blocked').length,
      done: tasks.filter((t) => t.status === 'done').length,
      cancelled: tasks.filter((t) => t.status === 'cancelled').length,
    };

    return successResponse({
      success: true,
      project,
      tasks,
      stats,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * PUT /api/projects/:id
 * Update a project
 */
export async function handleUpdateProject(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const projectId = req.params?.id;
    if (!projectId) {
      return badRequestResponse('project ID is required');
    }

    const body = req.body as Partial<Project>;

    const updated = updateProject(projectId, body);
    if (!updated) {
      return errorResponse('Project not found', 404);
    }

    audit({
      category: 'data_change',
      level: 'info',
      event: 'project_updated',
      actor: req.user.username,
      details: {
        projectId,
        updates: Object.keys(body),
      },
    });

    return successResponse({
      success: true,
      project: updated,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * DELETE /api/projects/:id
 * Archive a project
 */
export async function handleDeleteProject(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const projectId = req.params?.id;
    if (!projectId) {
      return badRequestResponse('project ID is required');
    }

    const success = deleteProject(projectId);
    if (!success) {
      return errorResponse('Project not found', 404);
    }

    audit({
      category: 'data_change',
      level: 'info',
      event: 'project_archived',
      actor: req.user.username,
      details: { projectId },
    });

    return successResponse({ success: true });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * POST /api/projects/:id/tasks
 * Assign tasks to a project
 */
export async function handleAssignTasksToProject(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const projectId = req.params?.id;
    if (!projectId) {
      return badRequestResponse('project ID is required');
    }

    const body = req.body as { taskIds: string[] };
    if (!body.taskIds || !Array.isArray(body.taskIds)) {
      return badRequestResponse('taskIds array is required');
    }

    const results: { taskId: string; success: boolean }[] = [];

    for (const taskId of body.taskIds) {
      const success = assignTaskToProject(taskId, projectId);
      results.push({ taskId, success });
    }

    const successCount = results.filter((r) => r.success).length;

    audit({
      category: 'data_change',
      level: 'info',
      event: 'tasks_assigned_to_project',
      actor: req.user.username,
      details: {
        projectId,
        taskCount: body.taskIds.length,
        successCount,
      },
    });

    return successResponse({
      success: true,
      results,
      assigned: successCount,
      failed: results.length - successCount,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/projects/:id/graph
 * Get dependency graph for project tasks
 */
export async function handleGetProjectGraph(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const projectId = req.params?.id;
    if (!projectId) {
      return badRequestResponse('project ID is required');
    }

    const project = getProject(projectId);
    if (!project) {
      return errorResponse('Project not found', 404);
    }

    const tasks = getProjectTasks(projectId);

    // Build graph nodes and edges
    const nodes = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      blocked: !areDependenciesMet(t),
    }));

    const edges: { from: string; to: string }[] = [];
    for (const task of tasks) {
      if (task.dependencies) {
        for (const depId of task.dependencies) {
          // Only include edges within this project
          if (tasks.some((t) => t.id === depId)) {
            edges.push({ from: depId, to: task.id });
          }
        }
      }
    }

    // Find critical path (longest chain of dependencies)
    const criticalPath = findCriticalPath(tasks);

    return successResponse({
      success: true,
      projectId,
      graph: {
        nodes,
        edges,
        criticalPath,
      },
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * Find the critical path (longest dependency chain) in tasks.
 */
function findCriticalPath(
  tasks: { id: string; dependencies?: string[]; status: string }[]
): string[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const memo = new Map<string, string[]>();

  function longestPath(taskId: string): string[] {
    if (memo.has(taskId)) return memo.get(taskId)!;

    const task = taskMap.get(taskId);
    if (!task || task.status === 'done') {
      memo.set(taskId, [taskId]);
      return [taskId];
    }

    let longest: string[] = [];
    if (task.dependencies) {
      for (const depId of task.dependencies) {
        if (taskMap.has(depId)) {
          const path = longestPath(depId);
          if (path.length > longest.length) {
            longest = path;
          }
        }
      }
    }

    const result = [...longest, taskId];
    memo.set(taskId, result);
    return result;
  }

  let criticalPath: string[] = [];
  for (const task of tasks) {
    if (task.status !== 'done') {
      const path = longestPath(task.id);
      if (path.length > criticalPath.length) {
        criticalPath = path;
      }
    }
  }

  return criticalPath;
}

// ============================================================================
// Task Dependency Handlers
// ============================================================================

/**
 * POST /api/tasks/:id/dependencies
 * Add a dependency to a task
 */
export async function handleAddDependency(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const taskId = req.params?.id;
    if (!taskId) {
      return badRequestResponse('task ID is required');
    }

    const body = req.body as { dependsOn: string };
    if (!body.dependsOn) {
      return badRequestResponse('dependsOn task ID is required');
    }

    const success = addTaskDependency(taskId, body.dependsOn);
    if (!success) {
      return errorResponse('Failed to add dependency (task not found or would create cycle)', 400);
    }

    audit({
      category: 'data_change',
      level: 'info',
      event: 'task_dependency_added',
      actor: req.user.username,
      details: { taskId, dependsOn: body.dependsOn },
    });

    return successResponse({ success: true });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * DELETE /api/tasks/:id/dependencies/:depId
 * Remove a dependency from a task
 */
export async function handleRemoveDependency(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const taskId = req.params?.id;
    const depId = req.params?.depId;

    if (!taskId || !depId) {
      return badRequestResponse('task ID and dependency ID are required');
    }

    const success = removeTaskDependency(taskId, depId);
    if (!success) {
      return errorResponse('Task not found', 404);
    }

    audit({
      category: 'data_change',
      level: 'info',
      event: 'task_dependency_removed',
      actor: req.user.username,
      details: { taskId, dependsOn: depId },
    });

    return successResponse({ success: true });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/tasks/actionable
 * Get tasks that are ready to work on (no blocking dependencies)
 */
export async function handleGetActionableTasks(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const tasks = getActionableTasks();

    return successResponse({
      success: true,
      tasks,
      count: tasks.length,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/tasks/blocked
 * Get tasks that are blocked by dependencies
 */
export async function handleGetBlockedTasks(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const blocked = getBlockedTasks();

    // Include blocking dependency info
    const tasksWithBlockers = blocked.map((task) => ({
      ...task,
      blockedBy: getBlockingDependencies(task).map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
      })),
    }));

    return successResponse({
      success: true,
      tasks: tasksWithBlockers,
      count: tasksWithBlockers.length,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}

/**
 * GET /api/tasks/:id/dependents
 * Get tasks that depend on a given task
 */
export async function handleGetDependents(req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const taskId = req.params?.id;
    if (!taskId) {
      return badRequestResponse('task ID is required');
    }

    const dependents = getDependentTasks(taskId);

    return successResponse({
      success: true,
      taskId,
      dependents: dependents.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
      })),
      count: dependents.length,
    });
  } catch (error) {
    return errorResponse((error as Error).message, 500);
  }
}
