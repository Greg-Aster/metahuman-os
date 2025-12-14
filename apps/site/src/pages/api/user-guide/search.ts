/**
 * User Guide Search API - GET /api/user-guide/search
 *
 * Search user guide chapters by query.
 * Astro adapter - calls unified handler from @metahuman/core.
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const GET = astroHandler;
