/**
 * Code Approvals API - List Endpoint
 * GET /api/code-approvals - List all pending code approvals
 *
 * MIGRATED: Uses unified handler via astroHandler
 */

import { astroHandler } from '@metahuman/core/api';

export const GET = astroHandler;
