import type { APIRoute } from 'astro';
import { updateActivity } from '@brain/agents/sleep-service.js';
import { scheduler, getUserOrAnonymous } from '@metahuman/core';

export const POST: APIRoute = async ({ cookies }) => {
  try {
    // Get username for activity tracking (enables user-specific agent triggers)
    const user = getUserOrAnonymous(cookies);
    const username = user.role !== 'anonymous' ? user.username : undefined;

    updateActivity(); // Call the function to update the timestamp
    try {
      scheduler.recordActivity(username);
    } catch (err) {
      console.warn('[activity-ping] Failed to record scheduler activity:', err);
    }
    return new Response(JSON.stringify({ message: 'Activity updated' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Failed to update activity:', error);
    return new Response(JSON.stringify({ error: 'Failed to update activity' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
