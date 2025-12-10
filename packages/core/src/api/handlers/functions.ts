/**
 * Functions API Handlers
 *
 * Unified handlers for function memory listing.
 * Works for both web (Astro) and mobile (nodejs-mobile).
 */

import type { UnifiedRequest, UnifiedResponse } from '../types.js';
import { successResponse } from '../types.js';
import {
  listFunctions,
  type ListFunctionsOptions,
  type FunctionTrustLevel,
} from '../../function-memory.js';

/**
 * GET /api/functions - List functions with filtering and sorting
 */
export async function handleListFunctions(req: UnifiedRequest): Promise<UnifiedResponse> {
  const { query } = req;

  try {
    // Parse query parameters
    const trustLevel = query.trustLevel as FunctionTrustLevel | undefined;
    const usesSkill = query.usesSkill || undefined;
    const sortBy = query.sortBy as ListFunctionsOptions['sortBy'] || undefined;
    const sortOrder = query.sortOrder as 'asc' | 'desc' || undefined;
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;

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
      verified: functions.filter((f) => f.metadata.trustLevel === 'verified').length,
      drafts: functions.filter((f) => f.metadata.trustLevel === 'draft').length,
      avgQualityScore:
        functions.length > 0
          ? functions.reduce((sum, f) => sum + (f.metadata.qualityScore || 0), 0) /
            functions.length
          : 0,
    };

    return successResponse({
      functions,
      stats,
      filters: options,
    });
  } catch (error) {
    console.error('[functions] GET error:', error);
    return { status: 500, error: (error as Error).message };
  }
}
