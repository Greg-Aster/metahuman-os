import type { APIRoute } from 'astro';
import { getAuthenticatedUser } from '@metahuman/core';
import {
  isAuditEnabled,
  setAuditEnabled,
  setAuditRetention,
  purgeOldAuditLogs
} from '@metahuman/core/audit';

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    // Only owner can view audit settings
    if (user.role !== 'owner') {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - owner only' }),
        { status: 403 }
      );
    }

    return new Response(
      JSON.stringify({
        enabled: isAuditEnabled(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 401 }
    );
  }
};

export const POST: APIRoute = async ({ cookies, request }) => {
  try {
    const user = getAuthenticatedUser(cookies);

    // Only owner can modify audit settings
    if (user.role !== 'owner') {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - owner only' }),
        { status: 403 }
      );
    }

    const body = await request.json();
    const { enabled, retentionDays, purgeOld } = body;

    if (typeof enabled === 'boolean') {
      setAuditEnabled(enabled);
    }

    if (typeof retentionDays === 'number' && retentionDays > 0) {
      setAuditRetention(retentionDays);
    }

    if (purgeOld === true) {
      purgeOldAuditLogs();
    }

    return new Response(
      JSON.stringify({
        success: true,
        enabled: isAuditEnabled(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500 }
    );
  }
};
