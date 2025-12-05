/**
 * Profile Sync - Tasks API
 *
 * GET: Download active tasks
 * POST: Upload tasks from mobile
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser, getProfilePaths, audit } from '@metahuman/core';
import fs from 'fs';
import path from 'path';

interface TaskFile {
  id: string;
  title: string;
  status: 'pending' | 'active' | 'completed' | 'cancelled';
  priority: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

function getTasksFromDir(dir: string): TaskFile[] {
  const tasks: TaskFile[] = [];

  if (!fs.existsSync(dir)) return tasks;

  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      const data = JSON.parse(content);
      tasks.push({
        id: data.id || path.basename(file, '.json'),
        title: data.title || data.content || '',
        status: data.status || 'pending',
        priority: data.priority || 0,
        tags: data.tags || [],
        createdAt: data.createdAt || '',
        updatedAt: data.updatedAt || data.createdAt || '',
      });
    } catch {
      // Skip invalid files
    }
  }

  return tasks;
}

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const profilePaths = getProfilePaths(user.username);

    // Get tasks from both active and completed directories
    const activeDir = path.join(profilePaths.tasks, 'active');
    const completedDir = path.join(profilePaths.tasks, 'completed');

    const activeTasks = getTasksFromDir(activeDir);
    const completedTasks = getTasksFromDir(completedDir);

    // Return active tasks primarily, with recent completed (last 50)
    const recentCompleted = completedTasks
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 50);

    const allTasks = [...activeTasks, ...recentCompleted];

    await audit({
      event: 'profile_sync_tasks_download',
      actor: user.username,
      details: {
        activeCount: activeTasks.length,
        completedCount: recentCompleted.length,
      },
    });

    return new Response(JSON.stringify({
      tasks: allTasks,
      timestamp: new Date().toISOString(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if ((error as any)?.message?.includes('Authentication required')) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.error('[profile-sync/tasks] GET Error:', error);
    return new Response(JSON.stringify({ error: 'Failed to get tasks' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const profilePaths = getProfilePaths(user.username);

    const body = await request.json();
    const tasks: TaskFile[] = body.tasks || [];

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return new Response(JSON.stringify({ error: 'No tasks provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let saved = 0;
    const errors: string[] = [];

    for (const task of tasks) {
      try {
        // Determine directory based on status
        const isCompleted = task.status === 'completed' || task.status === 'cancelled';
        const subDir = isCompleted ? 'completed' : 'active';
        const targetDir = path.join(profilePaths.tasks, subDir);

        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        const filename = `${task.id}.json`;
        const filePath = path.join(targetDir, filename);

        // Prepare task data
        const taskData = {
          ...task,
          syncedFromMobile: true,
          syncedAt: new Date().toISOString(),
        };

        fs.writeFileSync(filePath, JSON.stringify(taskData, null, 2));
        saved++;

        // If status changed, remove from other directory
        const otherDir = path.join(profilePaths.tasks, isCompleted ? 'active' : 'completed');
        const otherPath = path.join(otherDir, filename);
        if (fs.existsSync(otherPath)) {
          fs.unlinkSync(otherPath);
        }
      } catch (e) {
        errors.push(`Failed to save task ${task.id}: ${e instanceof Error ? e.message : 'Unknown'}`);
      }
    }

    await audit({
      event: 'profile_sync_tasks_upload',
      actor: user.username,
      details: {
        attempted: tasks.length,
        saved,
        errors: errors.length,
      },
    });

    return new Response(JSON.stringify({
      saved,
      errors,
      timestamp: new Date().toISOString(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if ((error as any)?.message?.includes('Authentication required')) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    console.error('[profile-sync/tasks] POST Error:', error);
    return new Response(JSON.stringify({ error: 'Failed to upload tasks' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
