import type { APIRoute } from 'astro';
import { getAuthenticatedUser, audit } from '@metahuman/core';
import { getSecurityPolicy } from '@metahuman/core/security-policy';
import { loadDesire, moveDesire, type Desire } from '@metahuman/core';

const LOG_PREFIX = '[API:agency/reset]';

/**
 * POST /api/agency/desires/:id/reset
 * Reset a stuck desire back to a usable state
 *
 * Query params:
 * - target: 'planning' | 'approved' | 'pending' (default: 'planning')
 *
 * Use cases:
 * - Desire stuck in 'executing' status (timed out, crashed, etc.)
 * - Need to restart the review/execution cycle
 * - Manual recovery from failed states
 */
export const POST: APIRoute = async ({ params, cookies, url }) => {
  try {
    const user = getAuthenticatedUser(cookies);
    if (!user) {
      console.log(`${LOG_PREFIX} ❌ Authentication required`);
      return new Response(
        JSON.stringify({ error: 'Authentication required to reset desires.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Require owner role
    const policy = getSecurityPolicy({ cookies });
    try {
      policy.requireOwner();
    } catch (error) {
      console.log(`${LOG_PREFIX} ❌ Owner role required`);
      return new Response(
        JSON.stringify({ error: 'Owner role required to reset desires.' }),
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

    // Get target status from query params
    const targetStatus = (url.searchParams.get('target') || 'planning') as Desire['status'];
    const validTargets = ['nascent', 'pending', 'planning', 'reviewing', 'approved'];

    if (!validTargets.includes(targetStatus)) {
      return new Response(
        JSON.stringify({
          error: `Invalid target status: ${targetStatus}. Valid options: ${validTargets.join(', ')}`
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log(`${LOG_PREFIX} 🔄 Reset requested for: ${id} → ${targetStatus}`);
    const desire = await loadDesire(id, user.username);
    if (!desire) {
      console.log(`${LOG_PREFIX} ❌ Desire not found: ${id}`);
      return new Response(
        JSON.stringify({ error: 'Desire not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const oldStatus = desire.status;
    console.log(`${LOG_PREFIX} 📋 Desire: "${desire.title}" (status: ${oldStatus} → ${targetStatus})`);

    // Check if this is a "stuck" desire (executing for too long)
    const isStuck = desire.status === 'executing' && desire.execution?.startedAt;
    let stuckDuration = 0;
    if (isStuck) {
      const startedAt = new Date(desire.execution!.startedAt).getTime();
      stuckDuration = Math.floor((Date.now() - startedAt) / 1000 / 60); // minutes
      console.log(`${LOG_PREFIX} ⚠️ Desire has been executing for ${stuckDuration} minutes`);
    }

    // Build the reset desire
    const now = new Date().toISOString();
    const resetDesire: Desire = {
      ...desire,
      status: targetStatus,
      updatedAt: now,
      // Clear execution data if resetting from executing
      execution: desire.status === 'executing' ? {
        ...desire.execution,
        status: 'aborted',
        error: `Reset by user after ${stuckDuration} minutes`,
        completedAt: now,
      } : desire.execution,
    };

    // If going back to planning, we might want to clear the plan for a fresh start
    // But let's keep it by default - user can revise if needed

    // Move the desire
    console.log(`${LOG_PREFIX} 📦 Moving ${oldStatus} → ${targetStatus}`);
    await moveDesire(resetDesire, oldStatus, targetStatus, user.username);

    // Audit the reset
    audit({
      category: 'agent',
      level: 'warn',
      event: 'desire_reset',
      actor: user.username,
      details: {
        desireId: id,
        title: desire.title,
        oldStatus,
        newStatus: targetStatus,
        wasStuck: isStuck,
        stuckDuration: isStuck ? stuckDuration : undefined,
        reason: 'manual_reset',
      },
    });

    console.log(`${LOG_PREFIX} ✅ Reset complete: ${oldStatus} → ${targetStatus}`);

    // Build appropriate message
    let message: string;
    if (isStuck) {
      message = `🔄 Unstuck "${desire.title}" from executing (was stuck for ${stuckDuration}m). Moved to ${targetStatus}.`;
    } else {
      message = `🔄 Reset "${desire.title}" from ${oldStatus} to ${targetStatus}.`;
    }

    return new Response(JSON.stringify({
      success: true,
      desire: resetDesire,
      message,
      wasStuck: isStuck,
      stuckDuration,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`${LOG_PREFIX} ❌ Error:`, error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
