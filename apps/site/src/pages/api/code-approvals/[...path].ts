/**
 * Code Approvals API - Dynamic routes
 * GET /api/code-approvals/[id] - Get specific approval
 * POST /api/code-approvals/[id]/approve - Approve and apply
 * POST /api/code-approvals/[id]/reject - Reject
 *
 * MIGRATED: Uses unified handler via astroHandler
 */

import { astroHandler } from '@metahuman/core/api';

export const GET = astroHandler;
export const POST = astroHandler;
