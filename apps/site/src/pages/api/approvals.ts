import type { APIRoute } from 'astro';
import {
  getPendingApprovals,
  approveSkillExecution,
  rejectSkillExecution,
} from '@metahuman/core/skills';
import { getUserContext } from '@metahuman/core/context';
import { withUserContext } from '../../middleware/userContext';
import { getSecurityPolicy } from '@metahuman/core/security-policy';

/**
 * GET /api/approvals
 * Returns all pending approval items
 */
const getHandler: APIRoute = async (context) => {
  try {
    const ctx = getUserContext();
    if (!ctx || ctx.role === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required to view approvals.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const pending = getPendingApprovals();
    return new Response(JSON.stringify({ approvals: pending }), {
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
 * POST /api/approvals
 * Approve or reject a skill execution
 * Body: { id: string, action: 'approve' | 'reject' }
 */
const postHandler: APIRoute = async (context) => {
  try {
    const ctx = getUserContext();
    if (!ctx || ctx.role === 'anonymous') {
      return new Response(
        JSON.stringify({ error: 'Authentication required to modify approvals.' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const policy = getSecurityPolicy(context);
    try {
      policy.requireOwner();
    } catch (error) {
      return new Response(
        JSON.stringify({ error: 'Owner role required to modify approvals.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await context.request.json();
    const { id, action } = body;

    if (!id || !action) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: id, action' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (action !== 'approve' && action !== 'reject') {
      return new Response(
        JSON.stringify({ error: 'Invalid action. Must be "approve" or "reject"' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let result;
    if (action === 'approve') {
      result = await approveSkillExecution(id, 'web-user');
      return new Response(
        JSON.stringify({ success: result.success, result }),
        {
          status: result.success ? 200 : 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } else {
      result = rejectSkillExecution(id, 'web-user');
      return new Response(
        JSON.stringify({ success: result.success, error: result.error }),
        {
          status: result.success ? 200 : 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const GET = withUserContext(getHandler);
export const POST = withUserContext(postHandler);
