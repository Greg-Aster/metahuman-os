import type { APIRoute } from 'astro';
import { readAuditLog, securityCheck } from '@metahuman/core/audit';

export const GET: APIRoute = async ({ url }) => {
  try {
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const checkSecurity = url.searchParams.get('security') === 'true';

    if (checkSecurity) {
      const { issues, warnings } = securityCheck();
      return new Response(
        JSON.stringify({ issues, warnings }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }

    const entries = readAuditLog(date);

    return new Response(
      JSON.stringify({
        date,
        entries,
        summary: {
          total: entries.length,
          byLevel: {
            info: entries.filter(e => e.level === 'info').length,
            warn: entries.filter(e => e.level === 'warn').length,
            error: entries.filter(e => e.level === 'error').length,
            critical: entries.filter(e => e.level === 'critical').length,
          },
          byCategory: {
            system: entries.filter(e => e.category === 'system').length,
            decision: entries.filter(e => e.category === 'decision').length,
            action: entries.filter(e => e.category === 'action').length,
            security: entries.filter(e => e.category === 'security').length,
            data: entries.filter(e => e.category === 'data').length,
          },
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
};
