import type { APIRoute } from 'astro';
import {
  getAuthenticatedUser,
  getUserOrAnonymous,
  audit,
} from '@metahuman/core';
import {
  loadDesire,
  saveDesire,
  deleteDesire,
  moveDesire,
  type DesireStatus,
} from '@metahuman/core';

/**
 * GET /api/agency/desires/:id
 * Get a single desire by ID
 */
export const GET: APIRoute = async ({ params, cookies }) => {
  try {
    const user = getUserOrAnonymous(cookies);
    if (user.role === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required to view desire.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { id } = params;
    if (!id) {
      return new Response(
        JSON.stringify({ error: 'Desire ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ desire }), {
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
 * PUT /api/agency/desires/:id
 * Update a desire
 * Body: Partial desire fields
 */
export const PUT: APIRoute = async ({ params, cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required to update desire.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { id } = params;
    if (!id) {
      return new Response(
        JSON.stringify({ error: 'Desire ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const updates = body as Partial<typeof desire>;

    const now = new Date().toISOString();
    const oldStatus = desire.status;
    const updatedDesire = {
      ...desire,
      ...updates,
      id: desire.id, // Don't allow changing ID
      updatedAt: now,
    };

    // If status changed, use moveDesire
    if (updates.status && updates.status !== oldStatus) {
      await moveDesire(updatedDesire, oldStatus, updates.status as DesireStatus, user.username);
    } else {
      await saveDesire(updatedDesire, user.username);
    }

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_updated',
      actor: user.username,
      details: {
        desireId: id,
        updates: Object.keys(updates),
      },
    });

    return new Response(JSON.stringify({ desire: updatedDesire, success: true }), {
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
 * DELETE /api/agency/desires/:id
 * Delete a desire (only allowed for certain statuses)
 */
export const DELETE: APIRoute = async ({ params, cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required to delete desire.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { id } = params;
    if (!id) {
      return new Response(
        JSON.stringify({ error: 'Desire ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Only allow deletion of certain statuses
    const deletableStatuses: DesireStatus[] = ['nascent', 'pending', 'rejected', 'abandoned', 'failed', 'completed'];
    if (!deletableStatuses.includes(desire.status)) {
      return new Response(
        JSON.stringify({ error: `Cannot delete desire in '${desire.status}' status` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await deleteDesire(desire, user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_deleted',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        status: desire.status,
      },
    });

    return new Response(JSON.stringify({ success: true }), {
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
