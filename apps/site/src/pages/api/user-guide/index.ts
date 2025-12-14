/**
 * User Guide API - GET /api/user-guide
 *
 * Lists all user guide chapters grouped by category.
 * Astro adapter - calls unified handler from @metahuman/core.
 */
import { astroHandler } from '@metahuman/core/api/adapters/astro';

export const GET = astroHandler;
