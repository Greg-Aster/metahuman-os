/**
 * Unified Queue API
 *
 * GET: Get current queue status across all lanes
 * POST: Enqueue a new task
 */

import type { APIRoute } from 'astro';
import { getAuthenticatedUser } from '@metahuman/core';
import { getQueueSystem, getQueueManager } from '@metahuman/core';

export const GET: APIRoute = async () => {
  try {
    // Public read - system-level status, no auth required
    const queueSystem = getQueueSystem();
    const state = queueSystem.getState();

    // Get tasks by lane for detailed view
    const queueManager = getQueueManager();
    const tasksByLane = {
      'local-llm': queueManager.getLaneTasks('local-llm'),
      'vector-index': queueManager.getLaneTasks('vector-index'),
      'remote-llm': queueManager.getLaneTasks('remote-llm'),
    };

    return new Response(
      JSON.stringify({
        success: true,
        running: state.running,
        paused: state.paused,
        stats: state.stats,
        lanes: state.lanes,
        tasksByLane,
        inFlightRemote: state.inFlightRemote,
        nextTriggers: state.nextTriggers,
        lastActivity: state.lastActivity,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[unified-queue] GET error:', error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    const body = await request.json();

    if (!body.type) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing task type' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const queueSystem = getQueueSystem();
    const task = queueSystem.enqueue({
      type: body.type,
      payload: body.payload || {},
      username: user.username,
      priority: body.priority || 'normal',
    });

    return new Response(
      JSON.stringify({
        success: true,
        task: {
          id: task.id,
          type: task.type,
          priority: task.priority,
          lane: task.resourceLane,
          queuedAt: task.queuedAt,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[unified-queue] POST error:', error);
    const status = (error as Error).message.includes('401') ? 401 : 500;
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
