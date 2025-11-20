import type { APIRoute } from 'astro';
import {
  listFunctions,
  type ListFunctionsOptions,
  type FunctionTrustLevel,
} from '@metahuman/core/function-memory';
import { auditAction } from '@metahuman/core/audit';

/**
 * GET /api/functions
 *
 * List functions with optional filtering and sorting
 *
 * Query parameters:
 * - trustLevel: 'draft' | 'verified' (default: both)
 * - usesSkill: Filter by skill name
 * - sortBy: 'title' | 'createdAt' | 'usageCount' | 'successRate' | 'qualityScore'
 * - sortOrder: 'asc' | 'desc'
 * - limit: Max results (default: no limit)
 */
const getHandler: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);

    // Parse query parameters
    const trustLevel = url.searchParams.get('trustLevel') as FunctionTrustLevel | null;
    const usesSkill = url.searchParams.get('usesSkill') || undefined;
    const sortBy = url.searchParams.get('sortBy') as ListFunctionsOptions['sortBy'] || undefined;
    const sortOrder = url.searchParams.get('sortOrder') as 'asc' | 'desc' || undefined;
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    // Build options
    const options: ListFunctionsOptions = {
      trustLevel: trustLevel || undefined,
      usesSkill,
      sortBy,
      sortOrder,
      limit,
    };

    // Get functions
    const functions = await listFunctions(options);

    // Calculate summary stats
    const stats = {
      total: functions.length,
      verified: functions.filter(f => f.metadata.trustLevel === 'verified').length,
      drafts: functions.filter(f => f.metadata.trustLevel === 'draft').length,
      avgQualityScore: functions.length > 0
        ? functions.reduce((sum, f) => sum + (f.metadata.qualityScore || 0), 0) / functions.length
        : 0,
    };

    return new Response(
      JSON.stringify({
        functions,
        stats,
        filters: options,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('[API /api/functions] Error listing functions:', error);
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

// Wrap with user context middleware
// MIGRATED: 2025-11-20 - Explicit authentication pattern
export const GET = getHandler;
