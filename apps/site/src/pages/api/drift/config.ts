import type { APIRoute } from 'astro';
import { getUserOrAnonymous, getAuthenticatedUser } from '@metahuman/core';
import { loadDriftConfig, saveDriftConfig } from '@metahuman/core';

/**
 * GET /api/drift/config
 * Returns drift configuration for the authenticated user
 */
export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getUserOrAnonymous(cookies);
    if (user.role === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required to view drift config.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const config = await loadDriftConfig(user.username);

    return new Response(JSON.stringify(config), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

/**
 * PUT /api/drift/config
 * Updates drift configuration for the authenticated user
 */
export const PUT: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    const updates = await request.json();

    // Validate updates
    if (typeof updates !== 'object' || updates === null) {
      return new Response(
        JSON.stringify({ error: 'Invalid configuration object' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await saveDriftConfig(user.username, updates);

    const config = await loadDriftConfig(user.username);

    return new Response(JSON.stringify({
      success: true,
      config,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if ((error as Error).message.includes('Authentication')) {
      return new Response(
        JSON.stringify({ error: 'Authentication required to update drift config.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
