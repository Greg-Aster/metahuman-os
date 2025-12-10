/**
 * Memories All API
 * GET /api/memories_all - Get all memory types for browser
 *
 * MIGRATED: Uses unified handler via astroHandler
 */

import { astroHandler } from '@metahuman/core/api';

export const GET = astroHandler;
