import type { APIRoute } from 'astro';
import { updateActivity } from '../../../../../brain/agents/sleep-service'; // Adjust import path

export const POST: APIRoute = async ({ request }) => {
  try {
    updateActivity(); // Call the function to update the timestamp
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