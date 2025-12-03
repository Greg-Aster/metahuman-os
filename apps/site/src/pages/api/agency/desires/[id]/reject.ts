import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import { loadDesire, moveDesire } from '@metahuman/core';

/**
 * POST /api/agency/desires/:id/reject
 * Reject a desire
 * Body: { reason?: string }
 */
export const POST: APIRoute = async ({ params, cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Authentication required to reject desires.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Require owner role for rejections
    const policy = getSecurityPolicy({ cookies });
    try {
      policy.requireOwner();
    } catch (error) {
      return new Response(
        JSON.stringify({ error: 'Owner role required to reject desires.' }),
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

    const desire = await loadDesire(id, user.username);
    if (!desire) {
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Allow rejecting from multiple statuses
    const rejectableStatuses = ['reviewing', 'approved', 'pending', 'evaluating', 'planning'];
    if (!rejectableStatuses.includes(desire.status)) {
      return new Response(
        JSON.stringify({ error: `Cannot reject desire in '${desire.status}' status.` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let reason = 'User rejected';
    try {
      const body = await request.json();
      if (body.reason) {
        reason = body.reason;
      }
    } catch {
      // No body is fine
    }

    const now = new Date().toISOString();
    const updatedDesire = {
      ...desire,
      status: 'rejected' as const,
      updatedAt: now,
      completedAt: now,
      rejectionHistory: [
        ...(desire.rejectionHistory || []),
        {
          rejectedAt: now,
          rejectedBy: 'user' as const,
          reason,
          canRetry: true,
        },
      ],
    };

    await moveDesire(updatedDesire, desire.status, 'rejected', user.username);

    audit({
      category: 'agent',
      level: 'info',
      event: 'desire_rejected',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        rejectedBy: user.username,
        reason,
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
