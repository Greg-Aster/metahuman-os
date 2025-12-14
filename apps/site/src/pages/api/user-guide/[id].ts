/**
 * User Guide Chapter API - GET /api/user-guide/[id]
 *
 * Get a specific user guide chapter by ID.
 * Astro adapter - calls unified handler from @metahuman/core.
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const GET = astroHandler;
