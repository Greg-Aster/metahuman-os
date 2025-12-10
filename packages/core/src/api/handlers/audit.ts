/**
 * Audit API Handlers
 *
 * Unified handlers for reading audit logs.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import { readAuditLog, securityCheck } from '../../audit.js';

/**
 * GET /api/audit - Read audit log for a date or run security check
 */
export async function handleGetAudit(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { query } = req;

  try {
    const date = query.date || new Date().toISOString().slice(0, 10);
    const checkSecurity = query.security === 'true';

    if (checkSecurity) {
      const { issues, warnings } = securityCheck();
      return successResponse({ issues, warnings });
    }

    const entries = readAuditLog(date);

    return successResponse({
      date,
      entries,
      summary: {
        total: entries.length,
        byLevel: {
          info: entries.filter((e: { level: string }) => e.level === 'info').length,
          warn: entries.filter((e: { level: string }) => e.level === 'warn').length,
          error: entries.filter((e: { level: string }) => e.level === 'error').length,
          critical: entries.filter((e: { level: string }) => e.level === 'critical').length,
        },
        byCategory: {
          system: entries.filter((e: { category: string }) => e.category === 'system').length,
          decision: entries.filter((e: { category: string }) => e.category === 'decision').length,
          action: entries.filter((e: { category: string }) => e.category === 'action').length,
          security: entries.filter((e: { category: string }) => e.category === 'security').length,
          data: entries.filter((e: { category: string }) => e.category === 'data').length,
        },
      },
    });
  } catch (error) {
    console.error('[audit] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}
