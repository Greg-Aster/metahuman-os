import type { APIRoute } from 'astro';
import { validateSession } from '@metahuman/core/sessions';
import { getUser } from '@metahuman/core/users';
import { getRemainingCodes, generateRecoveryCodes, saveRecoveryCodes } from '@metahuman/core/recovery-codes';
import { auditSecurity } from '@metahuman/core/audit';

/**
 * GET /api/recovery-codes
 * View remaining (unused) recovery codes
 *
 * POST /api/recovery-codes
 * Regenerate all recovery codes (invalidates old ones)
 */

export const GET: APIRoute = async (context) => {
  try {
    // Check authentication
    const sessionCookie = context.cookies.get('mh_session');
    if (!sessionCookie) {
      return new Response(
        JSON.stringify({ success: false, error: 'Not authenticated' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const session = validateSession(sessionCookie.value);
    if (!session) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid session' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const user = getUser(session.userId);
    if (!user) {
      return new Response(
        JSON.stringify({ success: false, error: 'User not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get remaining recovery codes
    const remaining = getRemainingCodes(user.username);

    return new Response(
      JSON.stringify({
        success: true,
        codes: remaining,
        total: remaining.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[recovery-codes GET] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch recovery codes',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST: APIRoute = async (context) => {
  try {
    // Check authentication
    const sessionCookie = context.cookies.get('mh_session');
    if (!sessionCookie) {
      return new Response(
        JSON.stringify({ success: false, error: 'Not authenticated' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const session = validateSession(sessionCookie.value);
    if (!session) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid session' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const user = getUser(session.userId);
    if (!user) {
      return new Response(
        JSON.stringify({ success: false, error: 'User not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Generate new recovery codes
    const newCodes = generateRecoveryCodes();
    saveRecoveryCodes(user.username, newCodes);

    // Audit the regeneration
    auditSecurity({
      actor: user.username,
      event: 'recovery_codes_regenerated',
      details: { userId: user.id },
    });

    return new Response(
      JSON.stringify({
        success: true,
        codes: newCodes,
        message: 'Recovery codes regenerated successfully',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[recovery-codes POST] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to regenerate recovery codes',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
