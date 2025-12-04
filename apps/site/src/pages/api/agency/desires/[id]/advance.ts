import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import { loadDesire, moveDesire, saveDesire, type DesireStatus } from '@metahuman/core';

// Valid stage transitions
const VALID_TRANSITIONS: Record<string, string[]> = {
  nascent: ['pending', 'planning', 'reviewing', 'approved'],
  pending: ['planning', 'reviewing', 'approved'],
  evaluating: ['planning', 'reviewing', 'approved'],
  planning: ['reviewing', 'approved'],
  reviewing: ['approved'],
  approved: ['executing'],
  awaiting_approval: ['approved'],
};

/**
 * POST /api/agency/desires/:id/advance
 * Advance a desire to the next stage
 * Body: { newStatus: string }
 */
export const POST: APIRoute = async ({ params, cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required to advance desires.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Require owner role
    const policy = getSecurityPolicy({ cookies });
    try {
      policy.requireOwner();
    } catch (error) {
      return new Response(
        JSON.stringify({ error: 'Owner role required to advance desires.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { id } = params;
    if (!id) {
      return new Response(
        JSON.stringify({ error: 'Desire ID is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const { newStatus } = body;

    if (!newStatus) {
      return new Response(
        JSON.stringify({ error: 'newStatus is required' }),
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

    // Check if transition is valid
    const allowedTransitions = VALID_TRANSITIONS[desire.status] || [];
    if (!allowedTransitions.includes(newStatus)) {
      return new Response(
        JSON.stringify({
          error: `Cannot transition from '${desire.status}' to '${newStatus}'. Allowed: ${allowedTransitions.join(', ') || 'none'}`
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const now = new Date().toISOString();
    const oldStatus = desire.status;
    const updatedDesire = {
      ...desire,
      status: newStatus as DesireStatus,
      updatedAt: now,
      activatedAt: desire.activatedAt || now,
    };

    await moveDesire(updatedDesire, oldStatus, newStatus, user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_advanced',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        fromStatus: oldStatus,
        toStatus: newStatus,
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
