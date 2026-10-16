/**
 * Vector Index API
 * GET /api/index - Get index status
 * POST /api/index - Build or rebuild index
 *
 * MIGRATED: Uses unified handler via astroHandler
 */

import { astroHandler } from '@metahuman/core/api';

export const GET = astroHandler;
export const POST = astroHandler;
