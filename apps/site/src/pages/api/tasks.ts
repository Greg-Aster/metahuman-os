import type { APIRoute } from 'astro';
import { listActiveTasks, listCompletedTasks, createTask, updateTaskStatus } from '@metahuman/core/memory';
import { auditDataChange } from '@metahuman/core/audit';

export const GET: APIRoute = async ({ request }) => {
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

export const POST: APIRoute = async ({ request }) => {
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

    // Audit the creation
    auditDataChange({
      type: 'create',
      resource: 'task',
      path: filepath,
      actor: 'human',
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

export const PATCH: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { taskId, status } = body;

    if (!taskId || !status) {
      return new Response(
        JSON.stringify({ error: 'taskId and status are required' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }

    updateTaskStatus(taskId, status);

    // Audit the update
    auditDataChange({
      type: 'update',
      resource: 'task',
      path: taskId,
      actor: 'human',
      details: { status },
    });

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
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
